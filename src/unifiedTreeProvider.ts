import * as path from 'path';
import * as vscode from 'vscode';
import {
  ModuleFederationConfig,
  Remote,
  RemotesFolder,
  RootFolder,
  UnifiedRootConfig
} from './types';
import { ConfigurationService } from './configurationService';
import { DependencyGraphManager } from './dependencyGraph';
import { DialogUtils } from './dialogUtils';
import { detectPackageManagerAndStartCommand } from './packageManager';
import { PathResolver } from './pathResolver';
import { RemoteConfigurationService } from './remoteConfigurationService';
import { RemoteWorkflow } from './remoteWorkflow';
import {
  ConfigurationLoader,
  DependencyGraphService,
  DialogService,
  RootConfigService,
  UnifiedModuleFederationProviderDependencies
} from './providerDependencies';
import { RootAppController } from './rootAppController';
import { RootConfigManager } from './rootConfigManager';
import { outputChannel } from './outputChannel';
import { TerminalManager } from './terminalManager';
import {
  LoadingPlaceholder,
  TreeElement,
  createTreeItem,
  isExposedModule,
  isExposesFolder,
  isRemotesFolder,
  isRemote,
  isRootFolder
} from './treeItemFactory';
import { getRemoteExposedModules, getRootFolderChildren } from './treeModel';

export class UnifiedModuleFederationProvider implements vscode.TreeDataProvider<TreeElement>,
  vscode.TreeDragAndDropController<TreeElement> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined>();

  readonly onDidChangeTreeData: vscode.Event<TreeElement | undefined> = this._onDidChangeTreeData.event;
  readonly dragMimeTypes = ['application/vnd.code.tree.moduleFederation'];
  readonly dropMimeTypes = ['application/vnd.code.tree.moduleFederation'];

  private rootConfigs = new Map<string, ModuleFederationConfig[]>();
  private readonly rootConfigManager: RootConfigService;
  private readonly configurationService: ConfigurationLoader;
  private readonly dependencyGraphManager: DependencyGraphService;
  private readonly terminalManager: TerminalManager;
  private readonly pathResolver: PathResolver;
  private readonly dialogs: DialogService;
  private readonly remoteConfigurationService: RemoteConfigurationService;
  private readonly remoteWorkflow: RemoteWorkflow;
  private readonly rootAppController: RootAppController;
  private readonly detectPackageManager: typeof detectPackageManagerAndStartCommand;
  private isLoading = false;
  private reloadQueued = false;

  constructor(
    private readonly workspaceRoot: string | undefined,
    private readonly context: vscode.ExtensionContext,
    dependencies: UnifiedModuleFederationProviderDependencies = {}
  ) {
    this.rootConfigManager = dependencies.rootConfigManager ?? new RootConfigManager(context);
    this.configurationService = dependencies.configurationService ?? new ConfigurationService();
    this.dependencyGraphManager = dependencies.dependencyGraphManager ?? new DependencyGraphManager(context);
    this.terminalManager = dependencies.terminalManager ?? new TerminalManager(() => this.refresh());
    this.dialogs = dependencies.dialogs ?? DialogUtils;
    this.detectPackageManager = dependencies.detectPackageManager ?? detectPackageManagerAndStartCommand;
    this.pathResolver = dependencies.pathResolver ?? new PathResolver({
      log: message => this.log(message),
      logError: (message, error) => this.logError(message, error)
    });

    this.remoteConfigurationService = new RemoteConfigurationService({
      rootConfigurationStore: this.rootConfigManager,
      getRootConfigs: () => this.rootConfigs,
      workspaceRoot: this.workspaceRoot,
      log: message => this.log(message),
      logError: (message, error) => this.logError(message, error)
    });

    this.remoteWorkflow = new RemoteWorkflow({
      workspaceRoot: this.workspaceRoot,
      dialogs: this.dialogs,
      detectPackageManager: this.detectPackageManager,
      getRootConfigs: () => this.rootConfigs,
      remoteConfigurationService: this.remoteConfigurationService,
      refresh: () => this.refresh(),
      log: message => this.log(message),
      logError: (message, error) => this.logError(message, error)
    });

    this.rootAppController = new RootAppController({
      workspaceRoot: this.workspaceRoot,
      rootConfigManager: this.rootConfigManager,
      terminalManager: this.terminalManager,
      dialogs: this.dialogs,
      detectPackageManager: this.detectPackageManager,
      getRootConfigs: () => this.rootConfigs,
      refresh: () => this.refresh(),
      reloadConfigurations: () => this.reloadConfigurations(),
      replaceRootPath: (oldPath, newPath) => {
        const configs = this.rootConfigs.get(oldPath);
        if (!configs) return;
        this.rootConfigs.delete(oldPath);
        this.rootConfigs.set(newPath, configs);
      },
      removeRootFromMemory: rootPath => {
        this.rootConfigs.delete(rootPath);
        void vscode.commands.executeCommand('setContext', 'moduleFederation.hasRoots', this.rootConfigs.size > 0);
        this._onDidChangeTreeData.fire(undefined);
      },
      addExternalRemoteToHost: (remotesFolder, targetRootPath) =>
        this.remoteWorkflow.addExternalRemoteToHost(remotesFolder, targetRootPath),
      log: message => this.log(message),
      logError: (message, error) => this.logError(message, error)
    });

    this.log('Initializing Unified Module Federation Explorer...');
    void this.rootConfigManager.hasConfiguredRoots().then(hasRoots => {
      if (hasRoots) {
        void this.loadConfigurations();
      } else {
        void vscode.commands.executeCommand('setContext', 'moduleFederation.hasRoots', false);
        this.log('No host directories configured yet. Waiting for user to set up configuration.');
      }
    });
  }

  getWorkspaceRoot(): string | undefined {
    return this.workspaceRoot;
  }

  async hasConfiguredRoots(): Promise<boolean> {
    return this.rootConfigManager.hasConfiguredRoots();
  }

  async loadRootConfig(): Promise<UnifiedRootConfig | null> {
    return this.rootConfigManager.loadRootConfig();
  }

  getConfigPath(): string | undefined {
    return this.rootConfigManager.getConfigPath();
  }

  async setConfigPath(configPath: string): Promise<void> {
    await this.rootConfigManager.setConfigPath(configPath);
  }

  async saveRootConfig(config: UnifiedRootConfig): Promise<void> {
    await this.rootConfigManager.saveRootConfig(config);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  async reloadConfigurations(): Promise<void> {
    if (this.isLoading) {
      this.reloadQueued = true;
      return;
    }
    await this.loadConfigurations();
  }

  log(message: string): void {
    const timestamp = new Date().toISOString();
    outputChannel.appendLine(`[${timestamp}] ${message}`);
  }

  logError(message: string, error: unknown): void {
    const errorDetails = error instanceof Error ? error.stack || error.message : String(error);
    const timestamp = new Date().toISOString();
    outputChannel.appendLine(`[${timestamp}] ERROR: ${message}:\n${errorDetails}`);

    let userMessage = `${message}: ${error instanceof Error ? error.message : String(error)}`;
    const actions: Array<{ title: string; action: () => void | Promise<void> }> = [];

    if (message.includes('Failed to load Module Federation configurations')) {
      userMessage = 'Failed to load Module Federation configurations. This might be due to syntax errors in your configuration files.';
      actions.push(
        { title: 'Refresh', action: () => this.reloadConfigurations() },
        { title: 'Show Output Log', action: () => outputChannel.show() }
      );
    } else if (message.includes('Cannot access Root Host directory')) {
      userMessage = 'Cannot access a Host directory. The directory may have been moved or deleted.';
      actions.push({
        title: 'Remove Invalid Host',
        action: async () => {
          const rootConfig = await this.rootConfigManager.loadRootConfig();
          if (!rootConfig) {
            this.log('Failed to load root configuration for tree view');
            return;
          }

          const rootItems = rootConfig.roots.map(root => ({
            label: path.basename(root),
            description: root,
            rootPath: root
          }));
          const selectedRoot = await this.dialogs.showQuickPick(rootItems, {
            title: 'Remove Invalid Host',
            placeholder: 'Select a Host to remove'
          });

          if (selectedRoot && !Array.isArray(selectedRoot)) {
            await this.rootConfigManager.removeRoot(selectedRoot.rootPath);
            await this.reloadConfigurations();
          }
        }
      });
    } else if (message.includes('Failed to process config file')) {
      userMessage = 'Failed to process a Module Federation configuration file. The file may contain syntax errors.';
      actions.push({ title: 'Show Output Log', action: () => outputChannel.show() });
    } else if (message.includes('Failed to start remote') || message.includes('Failed to stop remote')) {
      userMessage = `${message}. Check if the remote's configured directory and start commands are correct.`;
      actions.push({ title: 'Show Output Log', action: () => outputChannel.show() });
    }

    if (actions.length > 0) {
      void this.dialogs.showError(userMessage, {
        actions: actions.map(action => ({ title: action.title }))
      }).then(selected => {
        const selectedAction = actions.find(action => action.title === selected);
        if (selectedAction) void selectedAction.action();
      });
    } else {
      void this.dialogs.showError(userMessage);
    }
  }

  private async loadConfigurations(): Promise<void> {
    if (this.isLoading) {
      this.reloadQueued = true;
      return;
    }

    try {
      this.isLoading = true;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Module Federation Explorer',
          cancellable: false
        },
        async progress => {
          progress.report({ message: 'Loading configurations...' });
          const rootConfig = await this.rootConfigManager.loadRootConfig();
          if (!rootConfig) {
            this.rootConfigs.clear();
            this.log('Failed to load root configuration');
            return;
          }

          if (rootConfig.roots.length === 0) {
            this.rootConfigs.clear();
            this.log('No Host directories configured. Configure at least one Host directory.');
            void vscode.commands.executeCommand('setContext', 'moduleFederation.hasRoots', false);
            setTimeout(() => {
              void this.dialogs.showInfo('No Host directories are configured.', {
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
          const snapshot = await this.configurationService.load(rootConfig.roots);
          this.rootConfigs = snapshot.configs;
          for (const loadError of snapshot.errors) {
            this.log(`Failed to parse configuration file ${loadError.filePath}: ${String(loadError.error)}`);
          }

          progress.report({ message: 'Loading host configurations...' });
          await this.rootAppController.loadRootFolderConfigs();
          progress.report({ message: 'Loading remote configurations...' });
          await this.remoteConfigurationService.loadRemoteConfigurations();
          void vscode.commands.executeCommand('setContext', 'moduleFederation.hasRoots', this.rootConfigs.size > 0);
          this.log('Finished loading configurations from all roots');
        }
      );

      this.refresh();
      this.dependencyGraphManager.refreshDependencyGraph(this.rootConfigs);
    } catch (error) {
      this.logError('Failed to load Module Federation configurations', error);
      void vscode.window.showErrorMessage('Failed to load Module Federation configurations. See output panel for details.');
    } finally {
      this.isLoading = false;
      if (this.reloadQueued) {
        this.reloadQueued = false;
        void this.loadConfigurations();
      }
    }
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return createTreeItem(
      element,
      remoteKey => this.terminalManager.getRunningRemoteTerminal(remoteKey) !== undefined
    );
  }

  getChildren(element?: TreeElement): Thenable<TreeElement[]> {
    try {
      if (this.isLoading) {
        return Promise.resolve([{
          type: 'loadingPlaceholder',
          name: 'Loading configurations...'
        } as LoadingPlaceholder]);
      }

      if (!element) {
        return this.getRootFolders().then(rootFolders => rootFolders.length === 0 ? [] : rootFolders);
      }

      if (isRootFolder(element)) {
        return Promise.resolve(getRootFolderChildren(element, message => this.log(message)));
      }
      if (isRemotesFolder(element)) return Promise.resolve(element.remotes);
      if (isExposesFolder(element)) return Promise.resolve(element.exposes);
      if (isExposedModule(element)) return Promise.resolve([]);
      if (isRemote(element)) return Promise.resolve(getRemoteExposedModules(this.rootConfigs, element.name));
      return Promise.resolve([]);
    } catch (error) {
      this.logError('Failed to get children', error);
      return Promise.resolve([]);
    }
  }

  private async getRootFolders(): Promise<RootFolder[]> {
    const config = await this.rootConfigManager.loadRootConfig();
    if (!config) {
      this.log('Failed to load root configuration for tree view');
      return [];
    }

    const rootFolders = Array.from(this.rootConfigs.entries()).map(([rootPath, configs]) => {
      const rootFolderConfig = config.rootConfigs?.[rootPath];
      return {
        type: 'rootFolder' as const,
        path: rootPath,
        name: path.basename(rootPath),
        configs,
        startCommand: rootFolderConfig?.startCommand,
        isRunning: this.terminalManager.isRootAppRunning(rootPath)
      };
    });

    void vscode.commands.executeCommand('setContext', 'moduleFederation.hasRoots', rootFolders.length > 0);
    return rootFolders;
  }

  getRunningRemoteTerminal(remoteKey: string): vscode.Terminal | undefined {
    return this.terminalManager.getRunningRemoteTerminal(remoteKey) as vscode.Terminal | undefined;
  }

  setRunningRemote(remoteKey: string, startTerminal: vscode.Terminal, buildTerminal?: vscode.Terminal): void {
    this.terminalManager.setRunningRemote(remoteKey, startTerminal, buildTerminal);
  }

  stopRemote(remoteKey: string): void {
    this.terminalManager.stopRemote(remoteKey);
  }

  addRoot(): Promise<void> {
    return this.rootAppController.addRoot();
  }

  removeRoot(rootFolder: RootFolder): Promise<void> {
    return this.rootAppController.removeRoot(rootFolder);
  }

  changeConfigFile(): Promise<void> {
    return this.rootAppController.changeConfigFile();
  }

  startRootApp(rootFolder: RootFolder): Promise<void> {
    return this.rootAppController.startRootApp(rootFolder);
  }

  editRootAppCommands(rootFolder: RootFolder): Promise<void> {
    return this.rootAppController.editRootAppCommands(rootFolder);
  }

  stopRootApp(rootFolder: RootFolder): Promise<void> {
    return this.rootAppController.stopRootApp(rootFolder);
  }

  configureRootAppStartCommand(rootFolder: RootFolder): Promise<string | undefined> {
    return this.rootAppController.configureRootAppStartCommand(rootFolder);
  }

  clearAllRunningApps(): void {
    this.terminalManager.clearAllRunningApps();
  }

  cleanupDisposedTerminals(): void {
    this.log('Checking for disposed terminals...');
    const cleanup = this.terminalManager.cleanupDisposedTerminals();
    if (cleanup.remotes > 0 || cleanup.rootApps > 0) {
      this.log(`Cleaned up ${cleanup.remotes} remotes and ${cleanup.rootApps} root apps`);
    } else {
      this.log('No disposed terminals found');
    }
  }

  handleTerminalClosed(closedTerminal: vscode.Terminal): void {
    this.log(`Terminal closed: ${closedTerminal.name}`);
    const foundMatch = this.terminalManager.handleTerminalClosed(closedTerminal);
    if (foundMatch) {
      this.log(`Removed tracked app for closed terminal: ${closedTerminal.name}`);
    } else {
      this.log(`No matching tracked terminal found for closed terminal: ${closedTerminal.name}`);
    }
  }

  resolveRemoteFolderPath(remote: Remote): string {
    return this.remoteConfigurationService.resolveRemoteFolderPath(remote);
  }

  saveRemoteConfiguration(remote: Remote): Promise<void> {
    return this.remoteConfigurationService.saveRemoteConfiguration(remote);
  }

  loadRemoteConfigurations(): Promise<void> {
    return this.remoteConfigurationService.loadRemoteConfigurations();
  }

  async showDependencyGraph(): Promise<void> {
    try {
      this.log('Generating dependency graph...');
      if (this.rootConfigs.size === 0) {
        this.log('No Host configurations found for dependency graph');
        await this.dialogs.showInfo('No Module Federation configurations found. Please add a Host folder first.');
        return;
      }

      let totalRemotes = 0;
      let totalExposes = 0;
      for (const configs of this.rootConfigs.values()) {
        for (const config of configs) {
          totalRemotes += config.remotes.length;
          totalExposes += config.exposes.length;
          this.log(`Configuration: ${config.name}, Remotes: ${config.remotes.length}, Exposes: ${config.exposes.length}`);
          if (config.remotes.length > 0) {
            this.log(`Remotes in ${config.name}: ${config.remotes.map(remote => remote.name).join(', ')}`);
          }
        }
      }

      this.log(`Total configurations: ${this.rootConfigs.size}, Total remotes: ${totalRemotes}, Total exposes: ${totalExposes}`);
      const graph = this.dependencyGraphManager.generateDependencyGraph(this.rootConfigs);
      this.log(`Generated graph with ${graph.nodes.length} nodes and ${graph.edges.length} edges`);
      this.dependencyGraphManager.showDependencyGraph(graph);
      this.log('Dependency graph opened');
    } catch (error) {
      this.logError('Failed to generate dependency graph', error);
      await this.dialogs.showError('Failed to generate dependency graph', {
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  resolveFileExtensionForPath(basePath: string): Promise<string> {
    return Promise.resolve(this.pathResolver.resolveFileExtensionForPath(basePath));
  }

  handleDrag(source: readonly TreeElement[], dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void | Thenable<void> {
    if (source.length === 1 && isRootFolder(source[0])) {
      dataTransfer.set(
        'application/vnd.code.tree.moduleFederation',
        new vscode.DataTransferItem(source[0])
      );
    }
  }

  async handleDrop(target: TreeElement | undefined, dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
    const draggedItem = dataTransfer.get('application/vnd.code.tree.moduleFederation')?.value;
    if (!draggedItem || !isRootFolder(draggedItem)) return;
    if (target && !isRootFolder(target)) return;

    try {
      this.log(`Reordering root folder ${draggedItem.name}`);
      const rootConfig = await this.rootConfigManager.loadRootConfig();
      if (!rootConfig) {
        this.logError('Failed to load root configuration for reordering', 'Configuration not found');
        return;
      }

      const rootPaths = [...rootConfig.roots];
      const sourceIndex = rootPaths.findIndex(rootPath => rootPath === draggedItem.path);
      if (sourceIndex === -1) {
        this.log(`Cannot find the source root folder ${draggedItem.name} in configuration`);
        return;
      }

      let targetIndex = rootPaths.length - 1;
      if (target) {
        const newTargetIndex = rootPaths.findIndex(rootPath => rootPath === target.path);
        if (newTargetIndex !== -1) targetIndex = newTargetIndex;
      }

      const [removedItem] = rootPaths.splice(sourceIndex, 1);
      if (sourceIndex < targetIndex) targetIndex--;
      rootPaths.splice(targetIndex + 1, 0, removedItem);
      rootConfig.roots = rootPaths;
      await this.rootConfigManager.saveRootConfig(rootConfig);
      await this.reloadConfigurations();
      this.log(`Root folder ${draggedItem.name} moved to position ${targetIndex + 1}`);
    } catch (error) {
      this.logError('Failed to reorder root folders', error);
      await this.dialogs.showError('Failed to reorder root folders', {
        detail: 'See output panel for details.'
      });
    }
  }

  editRemoteCommands(remote: Remote): Promise<void> {
    return this.remoteWorkflow.editRemoteCommands(remote);
  }

  addExternalRemote(remotesFolder: RemotesFolder): Promise<void> {
    return this.remoteWorkflow.addExternalRemote(remotesFolder);
  }

  removeExternalRemote(remote: Remote): Promise<void> {
    return this.remoteWorkflow.removeExternalRemote(remote);
  }

  addExternalRemoteToHost(remotesFolder: RemotesFolder, targetRootPath: string): Promise<void> {
    return this.remoteWorkflow.addExternalRemoteToHost(remotesFolder, targetRootPath);
  }
}
