import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DialogService, ConfigurationLoader, DependencyGraphService, Logger, PackageManagerDetector, RootConfigService, TerminalPort } from './ports';
import { ExplorerStore } from '../features/explorer/explorerStore';
import { Remote, RemotesFolder, RootFolder, UnifiedRootConfig } from '../types';
import { DependencyGraphManager } from '../dependencyGraph';
import { ConfigurationService } from '../configurationService';
import { DialogUtils } from '../dialogUtils';
import { detectPackageManagerAndStartCommand } from '../packageManager';
import { PathResolver } from '../pathResolver';
import { RemoteConfigurationService } from '../features/remotes/remoteConfigurationService';
import { RemoteWorkflow } from '../features/remotes/remoteWorkflow';
import { RootAppController } from '../features/roots/rootAppWorkflow';
import { RootConfigManager } from '../features/roots/rootConfigManager';
import { normalizePath } from '../features/roots/pathUtils';
import { TerminalManager } from '../terminalManager';
import { outputChannel } from '../outputChannel';
import { trackSuccessAndPrompt } from '../ratingPrompt';

export interface ExplorerApplicationServices {
  rootConfigManager: RootConfigService;
  configurationService: ConfigurationLoader;
  dependencyGraphManager: DependencyGraphService;
  terminalManager: TerminalPort;
  pathResolver: PathResolver;
  dialogs: DialogService;
  detectPackageManager: PackageManagerDetector;
  logger: Logger;
}

/** Coordinates explorer workflows while keeping the tree provider focused on rendering. */
export class ExplorerApplication {
  private readonly remoteConfigurationService: RemoteConfigurationService;
  private readonly remoteWorkflow: RemoteWorkflow;
  private readonly rootAppController: RootAppController;
  private reloadQueued = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly workspaceRoot: string | undefined,
    private readonly store: ExplorerStore,
    private readonly services: ExplorerApplicationServices
  ) {
    this.remoteConfigurationService = new RemoteConfigurationService({
      rootConfigurationStore: this.services.rootConfigManager,
      getRootConfigs: () => this.store.getConfigs(),
      workspaceRoot,
      log: message => this.log(message),
      logError: (message, error) => this.logError(message, error)
    });

    this.remoteWorkflow = new RemoteWorkflow({
      workspaceRoot,
      dialogs: this.services.dialogs,
      detectPackageManager: this.services.detectPackageManager,
      getRootConfigs: () => this.store.getConfigs(),
      remoteConfigurationService: this.remoteConfigurationService,
      refresh: () => this.refresh(),
      log: message => this.log(message),
      logError: (message, error) => this.logError(message, error)
    });

    this.rootAppController = new RootAppController({
      workspaceRoot,
      rootConfigManager: this.services.rootConfigManager,
      terminalManager: this.services.terminalManager,
      dialogs: this.services.dialogs,
      detectPackageManager: this.services.detectPackageManager,
      getRootConfigs: () => this.store.getConfigs(),
      refresh: () => this.refresh(),
      reloadConfigurations: () => this.reloadConfigurations(),
      replaceRootPath: (oldPath, newPath) => {
        const configs = this.store.getConfigs().get(oldPath);
        if (!configs) return;
        this.store.getConfigs().delete(oldPath);
        this.store.getConfigs().set(newPath, configs);
        this.refresh();
      },
      removeRootFromMemory: rootPath => {
        this.store.getConfigs().delete(rootPath);
        void vscode.commands.executeCommand('setContext', 'moduleFederation.hasRoots', this.store.getConfigs().size > 0);
        this.refresh();
      },
      addExternalRemoteToHost: (remotesFolder, targetRootPath) =>
        this.remoteWorkflow.addExternalRemoteToHost(remotesFolder, targetRootPath),
      log: message => this.log(message),
      logError: (message, error) => this.logError(message, error)
    });
  }

  getStore(): ExplorerStore {
    return this.store;
  }

  getWorkspaceRoot(): string | undefined {
    return this.workspaceRoot;
  }

  async initialize(): Promise<void> {
    this.log('Initializing Module Federation Explorer application...');
    if (await this.services.rootConfigManager.hasConfiguredRoots()) {
      await this.loadConfigurations();
      return;
    }

    void vscode.commands.executeCommand('setContext', 'moduleFederation.hasRoots', false);
    this.log('No host directories configured yet. Waiting for user to set up configuration.');
  }

  async hasConfiguredRoots(): Promise<boolean> {
    return this.services.rootConfigManager.hasConfiguredRoots();
  }

  async loadRootConfig(): Promise<UnifiedRootConfig | null> {
    return this.services.rootConfigManager.loadRootConfig();
  }

  getConfigPath(): string | undefined {
    return this.services.rootConfigManager.getConfigPath();
  }

  async setConfigPath(configPath: string): Promise<void> {
    await this.services.rootConfigManager.setConfigPath(configPath);
  }

  async saveRootConfig(config: UnifiedRootConfig): Promise<void> {
    await this.services.rootConfigManager.saveRootConfig(config);
  }

  async reloadConfigurations(): Promise<void> {
    if (this.store.getSnapshot().isLoading) {
      this.reloadQueued = true;
      return;
    }

    await this.loadConfigurations();
  }

  refresh(): void {
    void this.updateRootFolders();
  }

  log(message: string): void {
    this.services.logger.log(message);
  }

  logError(message: string, error: unknown): void {
    this.services.logger.logError(message, error);
    void this.services.dialogs.showError(message, {
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  private async loadConfigurations(): Promise<void> {
    if (this.store.getSnapshot().isLoading) {
      this.reloadQueued = true;
      return;
    }

    this.store.setLoading(true);
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Module Federation Explorer',
          cancellable: false
        },
        async progress => {
          progress.report({ message: 'Loading configurations...' });
          const rootConfig = await this.services.rootConfigManager.loadRootConfig();
          if (!rootConfig) {
            this.store.clear();
            this.log('Failed to load root configuration');
            return;
          }

          if (rootConfig.roots.length === 0) {
            this.store.clear();
            this.log('No Host directories configured. Configure at least one Host directory.');
            void vscode.commands.executeCommand('setContext', 'moduleFederation.hasRoots', false);
            setTimeout(() => {
              void this.services.dialogs.showInfo('No Host directories are configured.', {
                detail: 'Use the Add Host button in the toolbar to configure your first Host, then add more Hosts.',
                actions: [
                  { title: 'Add Host' },
                  { title: 'Later', isCloseAffordance: true }
                ]
              }).then(selection => {
                if (selection === 'Add Host') void vscode.commands.executeCommand('moduleFederation.addRoot');
              });
            }, 1000);
            return;
          }

          this.log(`Found ${rootConfig.roots.length} configured roots`);
          progress.report({ message: 'Scanning federation configuration files...' });
          const snapshot = await this.services.configurationService.load(rootConfig.roots);
          this.store.replace(snapshot.configs);
          for (const loadError of snapshot.errors) {
            this.log(`Failed to parse configuration file ${loadError.filePath}: ${String(loadError.error)}`);
          }

          progress.report({ message: 'Loading host configurations...' });
          await this.rootAppController.loadRootFolderConfigs();
          progress.report({ message: 'Loading remote configurations...' });
          const hydratedConfigs = await this.remoteConfigurationService.hydrateRemoteConfigurations(this.store.getConfigs());
          this.store.replace(hydratedConfigs);
          await this.updateRootFolders();
          void vscode.commands.executeCommand('setContext', 'moduleFederation.hasRoots', this.store.getConfigs().size > 0);
          this.log('Finished loading configurations from all roots');
        }
      );

      this.services.dependencyGraphManager.refreshDependencyGraph(this.store.getConfigs());
    } catch (error) {
      this.logError('Failed to load Module Federation configurations', error);
      void vscode.window.showErrorMessage('Failed to load Module Federation configurations. See output panel for details.');
    } finally {
      this.store.setLoading(false);
      if (this.reloadQueued) {
        this.reloadQueued = false;
        void this.loadConfigurations();
      }
    }
  }

  private async updateRootFolders(): Promise<void> {
    const config = await this.services.rootConfigManager.loadRootConfig();
    if (!config) {
      this.store.setRootFolders([]);
      return;
    }

    const rootFolders: RootFolder[] = Array.from(this.store.getConfigs().entries()).map(([rootPath, configs]) => {
      const configuredRootPath = Object.keys(config.rootConfigs || {}).find(candidate => normalizePath(candidate) === normalizePath(rootPath));
      const configuredRoot = configuredRootPath
        ? config.rootConfigs?.[configuredRootPath]
        : Object.keys(config.rootConfigs || {}).length === 1
          ? Object.values(config.rootConfigs || {})[0]
          : undefined;
      return {
      type: 'rootFolder',
      path: rootPath,
      name: path.basename(rootPath),
      configs,
      startCommand: configuredRoot?.startCommand,
      isRunning: this.services.terminalManager.isRootAppRunning(rootPath)
      };
    });

    this.store.setRootFolders(rootFolders);
    void vscode.commands.executeCommand('setContext', 'moduleFederation.hasRoots', rootFolders.length > 0);
  }

  async startRemote(remote: Remote): Promise<void> {
    try {
      this.log(`Starting remote ${remote.name}`);
      const isUserConfigured = !!(remote.folder && remote.startCommand);
      let folder: string;

      if (!isUserConfigured) {
        const proceed = await this.services.dialogs.showInfo(
          `Remote "${remote.name}" needs a project folder to be configured.`,
          {
            modal: true,
            detail: 'This should be the folder containing the package.json file for this remote application.',
            actions: [
              { title: 'Browse for Folder' },
              { title: 'Cancel', isCloseAffordance: true }
            ]
          }
        );
        if (proceed !== 'Browse for Folder') return;

        const defaultUri = this.workspaceRoot
          ? vscode.Uri.file(path.dirname(this.workspaceRoot))
          : undefined;
        const selectedFolder = await this.services.dialogs.showFolderPicker({
          title: `Select Project Folder for Remote "${remote.name}"`,
          openLabel: `Select "${remote.name}" Project Folder`,
          defaultUri,
          validateFolder: async folderPath => {
            if (!fs.existsSync(path.join(folderPath, 'package.json'))) {
              const continueAnyway = await this.services.dialogs.showConfirmation(
                'The selected folder doesn\'t contain a package.json file.',
                {
                  detail: `Folder: ${folderPath}\n\nThis might not be a valid Node.js project folder. Do you want to continue anyway?`,
                  confirmText: 'Continue Anyway',
                  cancelText: 'Select Different Folder'
                }
              );
              return { valid: continueAnyway, message: 'Invalid Node.js project folder' };
            }
            return { valid: true };
          }
        });

        if (!selectedFolder) {
          await this.services.dialogs.showWarning(`No folder selected for remote "${remote.name}".`);
          return;
        }

        folder = selectedFolder;
        remote.folder = folder;
        await this.saveRemoteConfiguration(remote);
        this.refresh();
      } else {
        const resolvedFolderPath = this.resolveRemoteFolderPath(remote);
        if (!resolvedFolderPath || !fs.existsSync(resolvedFolderPath)) {
          const newFolder = await this.services.dialogs.showFolderPicker({
            title: `Select New Project Folder for Remote "${remote.name}"`,
            openLabel: `Select "${remote.name}" Project Folder`,
            defaultUri: this.workspaceRoot
              ? vscode.Uri.file(path.dirname(this.workspaceRoot))
              : undefined,
            validateFolder: async folderPath => {
              if (!fs.existsSync(path.join(folderPath, 'package.json'))) {
                const continueAnyway = await this.services.dialogs.showConfirmation(
                  'The selected folder doesn\'t contain a package.json file.',
                  {
                    detail: `Folder: ${folderPath}\n\nThis might not be a valid Node.js project folder. Do you want to continue anyway?`,
                    confirmText: 'Continue Anyway',
                    cancelText: 'Select Different Folder'
                  }
                );
                return { valid: continueAnyway, message: 'Invalid Node.js project folder' };
              }
              return { valid: true };
            }
          });
          if (!newFolder) {
            await this.services.dialogs.showWarning(`No folder selected for remote "${remote.name}".`);
            return;
          }
          folder = newFolder;
          remote.folder = folder;
          await this.saveRemoteConfiguration(remote);
          this.refresh();
        } else {
          folder = resolvedFolderPath;
        }
      }

      if (!remote.buildCommand || !remote.startCommand) {
        let packageManager = remote.packageManager;
        if (!packageManager) {
          const configType = remote.configType === 'vite' || remote.configType === 'rsbuild'
            ? remote.configType
            : 'webpack';
          ({ packageManager } = await this.services.detectPackageManager(folder, configType));
          remote.packageManager = packageManager;
        }

        const buildCommand = await this.services.dialogs.showCommandConfig({
          title: `Configure Build Command for ${remote.name}`,
          commandType: 'build',
          currentCommand: remote.buildCommand,
          packageManager,
          projectPath: folder,
          configType: remote.configType
        });
        if (!buildCommand) return;

        const startCommand = await this.services.dialogs.showCommandConfig({
          title: `Configure Preview Build Command for ${remote.name}`,
          commandType: 'preview',
          currentCommand: remote.startCommand,
          packageManager,
          projectPath: folder,
          configType: remote.configType
        });
        if (!startCommand) return;

        remote.buildCommand = buildCommand;
        remote.startCommand = startCommand;
        await this.saveRemoteConfiguration(remote);
        this.refresh();
      }

      const remoteKey = `remote-${remote.name}`;
      const existingTerminal = this.getRunningRemoteTerminal(remoteKey);
      if (existingTerminal) {
        existingTerminal.show();
        await this.services.dialogs.showInfo(`Remote ${remote.name} is already running`);
        return;
      }

      const buildTerminal = vscode.window.createTerminal(`Build: ${remote.name} - Remote`);
      const startTerminal = vscode.window.createTerminal({
        name: `Preview: ${remote.name} - Remote`,
        location: { parentTerminal: buildTerminal }
      });
      buildTerminal.show();
      buildTerminal.sendText(`cd "${folder}" && ${remote.buildCommand}`);
      startTerminal.show();
      startTerminal.sendText(`cd "${folder}" && ${remote.startCommand}`);
      this.services.terminalManager.setRunningRemote(remoteKey, startTerminal, buildTerminal);
      this.refresh();
      await this.services.dialogs.showSuccess(`Started remote ${remote.name}`);
      await trackSuccessAndPrompt(this.context, 'remote-started');
    } catch (error) {
      await this.services.dialogs.showError(`Failed to start remote ${remote.name}`, {
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async stopRemote(remote: Remote): Promise<void> {
    try {
      this.services.terminalManager.stopRemote(`remote-${remote.name}`);
      this.refresh();
      await this.services.dialogs.showSuccess(`Stopped remote ${remote.name}`);
    } catch (error) {
      await this.services.dialogs.showError(`Failed to stop remote ${remote.name}`, {
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async addRoot(): Promise<void> { await this.rootAppController.addRoot(); }
  async removeRoot(rootFolder: RootFolder): Promise<void> { await this.rootAppController.removeRoot(rootFolder); }
  async changeConfigFile(): Promise<void> { await this.rootAppController.changeConfigFile(); }
  async startRootApp(rootFolder: RootFolder): Promise<void> { await this.rootAppController.startRootApp(rootFolder); }
  async editRootAppCommands(rootFolder: RootFolder): Promise<void> { await this.rootAppController.editRootAppCommands(rootFolder); }
  async stopRootApp(rootFolder: RootFolder): Promise<void> { await this.rootAppController.stopRootApp(rootFolder); }
  async configureRootAppStartCommand(rootFolder: RootFolder): Promise<string | undefined> {
    return this.rootAppController.configureRootAppStartCommand(rootFolder);
  }

  editRemoteCommands(remote: Remote): Promise<void> { return this.remoteWorkflow.editRemoteCommands(remote); }
  addExternalRemote(remotesFolder: RemotesFolder): Promise<void> { return this.remoteWorkflow.addExternalRemote(remotesFolder); }
  removeExternalRemote(remote: Remote): Promise<void> { return this.remoteWorkflow.removeExternalRemote(remote); }
  addExternalRemoteToHost(remotesFolder: RemotesFolder, targetRootPath: string): Promise<void> {
    return this.remoteWorkflow.addExternalRemoteToHost(remotesFolder, targetRootPath);
  }

  getRunningRemoteTerminal(remoteKey: string): vscode.Terminal | undefined {
    return this.services.terminalManager.getRunningRemoteTerminal(remoteKey) as vscode.Terminal | undefined;
  }

  resolveRemoteFolderPath(remote: Remote): string {
    return this.remoteConfigurationService.resolveRemoteFolderPath(remote);
  }

  saveRemoteConfiguration(remote: Remote): Promise<void> {
    return this.remoteConfigurationService.saveRemoteConfiguration(remote);
  }

  clearAllRunningApps(): void { this.services.terminalManager.clearAllRunningApps(); }

  cleanupDisposedTerminals(): void {
    const cleanup = this.services.terminalManager.cleanupDisposedTerminals();
    if (cleanup.remotes > 0 || cleanup.rootApps > 0) {
      this.log(`Cleaned up ${cleanup.remotes} remotes and ${cleanup.rootApps} root apps`);
      this.refresh();
    }
  }

  handleTerminalClosed(closedTerminal: vscode.Terminal): void {
    if (this.services.terminalManager.handleTerminalClosed(closedTerminal)) {
      this.refresh();
    }
  }

  async showDependencyGraph(): Promise<void> {
    try {
      if (this.store.getConfigs().size === 0) {
        await this.services.dialogs.showInfo('No Module Federation configurations found. Please add a Host folder first.');
        return;
      }

      const graph = this.services.dependencyGraphManager.generateDependencyGraph(this.store.getConfigs());
      this.services.dependencyGraphManager.showDependencyGraph(graph);
    } catch (error) {
      this.logError('Failed to generate dependency graph', error);
    }
  }

  resolveFileExtensionForPath(basePath: string): string {
    return this.services.pathResolver.resolveFileExtensionForPath(basePath);
  }

  async reorderRoots(draggedRoot: RootFolder, targetRoot?: RootFolder): Promise<void> {
    try {
      this.log(`Reordering root folder ${draggedRoot.name}`);
      const rootConfig = await this.services.rootConfigManager.loadRootConfig();
      if (!rootConfig) {
        this.logError('Failed to load root configuration for reordering', 'Configuration not found');
        return;
      }

      const rootPaths = [...rootConfig.roots];
      const sourceIndex = rootPaths.findIndex(rootPath => rootPath === draggedRoot.path);
      if (sourceIndex === -1) return;

      let targetIndex = rootPaths.length - 1;
      if (targetRoot) {
        const newTargetIndex = rootPaths.findIndex(rootPath => rootPath === targetRoot.path);
        if (newTargetIndex !== -1) targetIndex = newTargetIndex;
      }

      const [removedItem] = rootPaths.splice(sourceIndex, 1);
      if (sourceIndex < targetIndex) targetIndex--;
      rootPaths.splice(targetIndex + 1, 0, removedItem);
      rootConfig.roots = rootPaths;
      await this.services.rootConfigManager.saveRootConfig(rootConfig);
      await this.reloadConfigurations();
    } catch (error) {
      this.logError('Failed to reorder root folders', error);
    }
  }
}

export function createDefaultExplorerApplicationServices(
  context: vscode.ExtensionContext
): ExplorerApplicationServices {
  return {
    rootConfigManager: new RootConfigManager(context),
    configurationService: new ConfigurationService(),
    dependencyGraphManager: new DependencyGraphManager(context),
    terminalManager: new TerminalManager(),
    pathResolver: new PathResolver(),
    dialogs: DialogUtils,
    detectPackageManager: detectPackageManagerAndStartCommand,
    logger: {
      log: message => outputChannel.appendLine(message),
      logError: (message, error) => outputChannel.appendLine(`${message}: ${String(error)}`)
    }
  };
}
