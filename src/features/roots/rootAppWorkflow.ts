import * as fsSync from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ModuleFederationConfig, RemotesFolder, RootFolder } from '../../types';
import type { DialogService, PackageManagerDetector, RootConfigService, TerminalPort } from '../../app/ports';
import { normalizePath } from './pathUtils';

export interface RootAppControllerDependencies {
  workspaceRoot?: string;
  rootConfigManager: RootConfigService;
  terminalManager: TerminalPort;
  dialogs: DialogService;
  detectPackageManager: PackageManagerDetector;
  getRootConfigs: () => ReadonlyMap<string, ModuleFederationConfig[]>;
  refresh: () => void;
  reloadConfigurations: () => Promise<void>;
  replaceRootPath: (oldPath: string, newPath: string) => void;
  removeRootFromMemory: (rootPath: string) => void;
  addExternalRemoteToHost: (remotesFolder: RemotesFolder, targetRootPath: string) => Promise<void>;
  log: (message: string) => void;
  logError: (message: string, error: unknown) => void;
}

/** Root-folder persistence and host runtime workflow. */
export class RootAppController {
  constructor(private readonly dependencies: RootAppControllerDependencies) {}

  async addRoot(): Promise<void> {
    try {
      if (!this.dependencies.rootConfigManager.getConfigPath()) {
        const result = await this.dependencies.dialogs.showInfo('You need to set up your configuration file before adding hosts.', { actions: [{ title: 'Configure Settings' }, { title: 'Cancel', isCloseAffordance: true }] });
        if (result !== 'Configure Settings') return;
        await this.changeConfigFile();
        if (!this.dependencies.rootConfigManager.getConfigPath()) return;
      }
      const defaultUri = this.dependencies.workspaceRoot ? vscode.Uri.file(path.dirname(this.dependencies.workspaceRoot)) : undefined;
      const rootPath = await this.dependencies.dialogs.showFolderPicker({ title: 'Select a folder to add to the Module Federation Explorer', openLabel: 'Select Host Folder', defaultUri });
      if (!rootPath) return;
      await this.dependencies.rootConfigManager.addRoot(rootPath);
      void this.dependencies.reloadConfigurations();
    } catch (error) {
      this.dependencies.logError('Failed to add root', error);
    }
  }

  async removeRoot(rootFolder: RootFolder): Promise<void> {
    try {
      const confirmed = await this.dependencies.dialogs.showConfirmation(`Are you sure you want to remove "${rootFolder.path}" from the configuration?`, { destructive: true, confirmText: 'Remove', cancelText: 'Cancel' });
      if (!confirmed) return;
      await this.dependencies.rootConfigManager.removeRoot(rootFolder.path);
      this.dependencies.removeRootFromMemory(rootFolder.path);
      await this.dependencies.dialogs.showSuccess(`Removed Host ${rootFolder.path} from configuration`);
    } catch (error) {
      this.dependencies.logError(`Failed to remove Host ${rootFolder.path}`, error);
    }
  }

  async changeConfigFile(): Promise<void> {
    try {
      if (await this.dependencies.rootConfigManager.changeConfigFile()) await this.dependencies.reloadConfigurations();
    } catch (error) {
      this.dependencies.logError('Failed to change configuration file', error);
    }
  }

  async startRootApp(rootFolder: RootFolder): Promise<void> {
    try {
      if (this.dependencies.terminalManager.isRootAppRunning(rootFolder.path)) {
        await this.dependencies.dialogs.showInfo(`Host app is already running: ${rootFolder.name}`);
        return;
      }
      if (!rootFolder.startCommand) {
        const config = await this.dependencies.rootConfigManager.loadRootConfig();
        const configuredRootPath = Object.keys(config?.rootConfigs || {}).find(candidate => normalizePath(candidate) === normalizePath(rootFolder.path));
        rootFolder.startCommand = configuredRootPath ? config?.rootConfigs?.[configuredRootPath]?.startCommand : undefined;
      }
      if (!rootFolder.startCommand && !await this.configureRootAppStartCommand(rootFolder)) return;
      const terminal = vscode.window.createTerminal(`MFE App: ${rootFolder.name}`);
      terminal.show();
      terminal.sendText(`cd "${rootFolder.path}" && ${rootFolder.startCommand}`);
      this.dependencies.terminalManager.setRunningRootApp(rootFolder.path, terminal);
      this.dependencies.refresh();
      await this.dependencies.dialogs.showSuccess(`Started Host app: ${rootFolder.name}`);
    } catch (error) {
      this.dependencies.logError(`Failed to start Host app: ${rootFolder.name}`, error);
    }
  }

  async stopRootApp(rootFolder: RootFolder): Promise<void> {
    try {
      if (!this.dependencies.terminalManager.isRootAppRunning(rootFolder.path)) {
        await this.dependencies.dialogs.showInfo(`Host app is not running: ${rootFolder.name}`);
        return;
      }
      this.dependencies.terminalManager.stopRootApp(rootFolder.path);
      this.dependencies.refresh();
      await this.dependencies.dialogs.showSuccess(`Stopped Host app: ${rootFolder.name}`);
    } catch (error) {
      this.dependencies.logError(`Failed to stop Host app: ${rootFolder.name}`, error);
    }
  }

  async configureRootAppStartCommand(rootFolder: RootFolder): Promise<string | undefined> {
    try {
      const { startCommand: defaultCommand } = await this.dependencies.detectPackageManager(rootFolder.path, 'webpack');
      const startCommand = await this.dependencies.dialogs.showInput({ title: `Configure App Start Command for ${rootFolder.name}`, prompt: `Configure app start command for ${rootFolder.name}`, value: rootFolder.startCommand || defaultCommand, placeholder: 'e.g., npm run start, yarn dev, etc.' });
      if (!startCommand) return undefined;
      rootFolder.startCommand = startCommand;
      await this.saveRootFolderConfig(rootFolder);
      this.dependencies.refresh();
      await this.dependencies.dialogs.showSuccess(`Configured app start command for ${rootFolder.name}: ${startCommand}`);
      return startCommand;
    } catch (error) {
      this.dependencies.logError(`Failed to configure start command for ${rootFolder.name}`, error);
      return undefined;
    }
  }

  async editRootAppCommands(rootFolder: RootFolder): Promise<void> {
    try {
      let { packageManager } = await this.dependencies.detectPackageManager(rootFolder.path, 'webpack');
      const selected = await this.dependencies.dialogs.showQuickPick([
        { label: '▶️ Edit Start Command', description: rootFolder.startCommand || 'Not configured' },
        { label: '📁 Change Project Folder', description: rootFolder.path },
        { label: '🔗 Add External Remote', description: 'Add an external remote to this host app' }
      ], { title: `Edit Configuration for ${rootFolder.name}`, placeholder: 'What would you like to edit?' });
      if (!selected || Array.isArray(selected)) return;

      if (selected.label.includes('Change Project Folder')) {
        const defaultUri = this.dependencies.workspaceRoot ? vscode.Uri.file(path.dirname(this.dependencies.workspaceRoot)) : undefined;
        const newFolder = await this.dependencies.dialogs.showFolderPicker({
          title: `Select New Project Folder for Host App "${rootFolder.name}"`, openLabel: `Select "${rootFolder.name}" Project Folder`, defaultUri,
          validateFolder: async folderPath => {
            if (fsSync.existsSync(path.join(folderPath, 'package.json'))) return { valid: true };
            const continueAnyway = await this.dependencies.dialogs.showConfirmation('The selected folder doesn\'t contain a package.json file.', { detail: `Folder: ${folderPath}`, confirmText: 'Continue Anyway', cancelText: 'Select Different Folder' });
            return { valid: continueAnyway, message: 'Invalid Node.js project folder' };
          }
        });
        if (!newFolder) return;
        const oldPath = rootFolder.path;
        rootFolder.path = newFolder;
        this.dependencies.replaceRootPath(oldPath, newFolder);
        ({ packageManager } = await this.dependencies.detectPackageManager(newFolder, 'webpack'));
        await this.saveRootFolderConfig(rootFolder);
        this.dependencies.refresh();
        await this.dependencies.dialogs.showSuccess(`Updated project folder for ${rootFolder.name}`);
        return;
      }
      if (selected.label.includes('Edit Start Command')) {
        const startCommand = await this.dependencies.dialogs.showCommandConfig({ title: `Configure Start Command for ${rootFolder.name}`, commandType: 'start', currentCommand: rootFolder.startCommand, packageManager, projectPath: rootFolder.path });
        if (startCommand !== undefined) {
          rootFolder.startCommand = startCommand;
          await this.saveRootFolderConfig(rootFolder);
          this.dependencies.refresh();
          await this.dependencies.dialogs.showSuccess(`Updated start command for ${rootFolder.name}`);
        }
        return;
      }
      await this.dependencies.addExternalRemoteToHost({ type: 'remotesFolder', parentName: rootFolder.name, parentPath: rootFolder.path, remotes: [] }, rootFolder.path);
    } catch (error) {
      this.dependencies.logError(`Failed to edit commands for ${rootFolder.name}`, error);
    }
  }

  async loadRootFolderConfigs(): Promise<void> {
    if (await this.dependencies.rootConfigManager.loadRootConfig()) this.dependencies.log('Loaded Host folder configurations');
  }

  private async saveRootFolderConfig(rootFolder: RootFolder): Promise<void> {
    const config = await this.dependencies.rootConfigManager.loadRootConfig();
    if (!config) return;
    config.rootConfigs ??= {};
    config.rootConfigs[rootFolder.path] = { ...config.rootConfigs[rootFolder.path], startCommand: rootFolder.startCommand };
    await this.dependencies.rootConfigManager.saveRootConfig(config);
  }
}
