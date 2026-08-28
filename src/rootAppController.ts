import * as fsSync from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ModuleFederationConfig, RemotesFolder, RootFolder } from './types';
import { DialogService, PackageManagerDetector, RootConfigService } from './providerDependencies';
import { TerminalManager } from './terminalManager';

interface RootAppTerminalService {
  isRootAppRunning(rootPath: string): boolean;
  setRunningRootApp(rootPath: string, terminal: vscode.Terminal): void;
  stopRootApp(rootPath: string): boolean;
}

export interface RootAppControllerDependencies {
  workspaceRoot?: string;
  rootConfigManager: RootConfigService;
  terminalManager: RootAppTerminalService | TerminalManager;
  dialogs: DialogService;
  detectPackageManager: PackageManagerDetector;
  getRootConfigs: () => Map<string, ModuleFederationConfig[]>;
  refresh: () => void;
  reloadConfigurations: () => Promise<void>;
  replaceRootPath: (oldPath: string, newPath: string) => void;
  removeRootFromMemory: (rootPath: string) => void;
  addExternalRemoteToHost: (remotesFolder: RemotesFolder, targetRootPath: string) => Promise<void>;
  log: (message: string) => void;
  logError: (message: string, error: unknown) => void;
}

/** Coordinates root-folder configuration and host application lifecycle commands. */
export class RootAppController {
  constructor(private readonly dependencies: RootAppControllerDependencies) {}

  async addRoot(): Promise<void> {
    try {
      if (!this.dependencies.rootConfigManager.getConfigPath()) {
        const result = await this.dependencies.dialogs.showInfo(
          'You need to set up your configuration file before adding hosts.',
          {
            actions: [
              { title: 'Configure Settings' },
              { title: 'Cancel', isCloseAffordance: true }
            ]
          }
        );

        if (result === 'Configure Settings') {
          await this.changeConfigFile();
          if (!this.dependencies.rootConfigManager.getConfigPath()) return;
        } else {
          return;
        }
      }

      let defaultUri: vscode.Uri | undefined;
      if (this.dependencies.workspaceRoot) {
        defaultUri = vscode.Uri.file(path.dirname(this.dependencies.workspaceRoot));
      }

      const rootPath = await this.dependencies.dialogs.showFolderPicker({
        title: 'Select a folder to add to the Module Federation Explorer',
        openLabel: 'Select Host Folder',
        defaultUri
      });

      if (!rootPath) return;
      await this.dependencies.rootConfigManager.addRoot(rootPath);
      void this.dependencies.reloadConfigurations();
    } catch (error) {
      this.dependencies.logError('Failed to add root', error);
      await this.dependencies.dialogs.showError('Failed to add root', {
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async removeRoot(rootFolder: RootFolder): Promise<void> {
    try {
      this.dependencies.log(`Removing Host ${rootFolder.path}`);
      const confirmed = await this.dependencies.dialogs.showConfirmation(
        `Are you sure you want to remove "${rootFolder.path}" from the configuration?`,
        { destructive: true, confirmText: 'Remove', cancelText: 'Cancel' }
      );

      if (!confirmed) return;
      await this.dependencies.rootConfigManager.removeRoot(rootFolder.path);
      this.dependencies.removeRootFromMemory(rootFolder.path);
      await this.dependencies.dialogs.showSuccess(`Removed Host ${rootFolder.path} from configuration`);
    } catch (error) {
      this.dependencies.logError(`Failed to remove Host ${rootFolder.path}`, error);
      await this.dependencies.dialogs.showError('Failed to remove Host', {
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async changeConfigFile(): Promise<void> {
    try {
      const result = await this.dependencies.rootConfigManager.changeConfigFile();
      if (result) await this.dependencies.reloadConfigurations();
    } catch (error) {
      this.dependencies.logError('Failed to change configuration file', error);
    }
  }

  async startRootApp(rootFolder: RootFolder): Promise<void> {
    try {
      const rootPath = rootFolder.path;
      this.dependencies.log(`Starting Host app: ${rootPath}`);

      if (this.dependencies.terminalManager.isRootAppRunning(rootPath)) {
        await this.dependencies.dialogs.showInfo(`Host app is already running: ${rootFolder.name}`);
        return;
      }

      if (!rootFolder.startCommand) {
        const startCommand = await this.configureRootAppStartCommand(rootFolder);
        if (!startCommand) return;
      }

      const terminal = vscode.window.createTerminal(`MFE App: ${rootFolder.name}`);
      terminal.show();
      terminal.sendText(`cd "${rootPath}" && ${rootFolder.startCommand}`);
      this.dependencies.terminalManager.setRunningRootApp(rootPath, terminal);
      this.dependencies.refresh();
      await this.dependencies.dialogs.showSuccess(`Started Host app: ${rootFolder.name}`);
    } catch (error) {
      this.dependencies.logError(`Failed to start Host app: ${rootFolder.name}`, error);
    }
  }

  async editRootAppCommands(rootFolder: RootFolder): Promise<void> {
    try {
      const rootPath = rootFolder.path;
      this.dependencies.log(`Editing commands for Host app: ${rootPath}`);
      let { packageManager } = await this.dependencies.detectPackageManager(rootFolder.path, 'webpack');

      const options = [
        {
          label: '▶️ Edit Start Command - eg. npm run start, yarn dev, etc. the command to start the app',
          description: rootFolder.startCommand || 'Not configured'
        },
        { label: '📁 Change Project Folder', description: rootFolder.path || 'Not configured' },
        { label: '🔗 Add External Remote', description: 'Add an external remote to this host app' }
      ];

      const selectedOption = await this.dependencies.dialogs.showQuickPick(options, {
        title: `Edit Configuration for ${rootFolder.name}`,
        placeholder: 'What would you like to edit?'
      });

      if (!selectedOption || Array.isArray(selectedOption)) return;

      if (selectedOption.label.includes('Change Project Folder')) {
        let defaultUri: vscode.Uri | undefined;
        if (this.dependencies.workspaceRoot) {
          defaultUri = vscode.Uri.file(path.dirname(this.dependencies.workspaceRoot));
        }

        const newFolder = await this.dependencies.dialogs.showFolderPicker({
          title: `Select New Project Folder for Host App "${rootFolder.name}"`,
          openLabel: `Select "${rootFolder.name}" Project Folder`,
          defaultUri,
          validateFolder: async (folderPath: string) => {
            const packageJsonPath = path.join(folderPath, 'package.json');
            if (!fsSync.existsSync(packageJsonPath)) {
              const continueAnyway = await this.dependencies.dialogs.showConfirmation(
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
          await this.dependencies.dialogs.showWarning(
            `No folder selected for Host app "${rootFolder.name}".`,
            { detail: 'Folder configuration was not changed.' }
          );
          return;
        }

        const oldPath = rootFolder.path;
        rootFolder.path = newFolder;
        this.dependencies.log(`Updated project folder for Host app ${rootFolder.name}: ${newFolder}`);
        this.dependencies.replaceRootPath(oldPath, newFolder);
        ({ packageManager } = await this.dependencies.detectPackageManager(newFolder, 'webpack'));
        await this.saveRootFolderConfig(rootFolder);
        this.dependencies.refresh();
        await this.dependencies.dialogs.showSuccess(`Updated project folder for ${rootFolder.name}`);
        return;
      }

      if (selectedOption.label.includes('Edit Start Command')) {
        const startCommand = await this.dependencies.dialogs.showCommandConfig({
          title: `Configure Start Command for ${rootFolder.name}`,
          commandType: 'start',
          currentCommand: rootFolder.startCommand,
          packageManager,
          projectPath: rootFolder.path
        });

        if (startCommand !== undefined) {
          rootFolder.startCommand = startCommand;
          await this.saveRootFolderConfig(rootFolder);
          this.dependencies.refresh();
          await this.dependencies.dialogs.showSuccess(`Updated start command for ${rootFolder.name}`);
        }
      }

      if (selectedOption.label.includes('Add External Remote')) {
        const remotesFolder: RemotesFolder = {
          type: 'remotesFolder',
          parentName: rootFolder.name,
          remotes: []
        };
        await this.dependencies.addExternalRemoteToHost(remotesFolder, rootFolder.path);
      }
    } catch (error) {
      this.dependencies.logError(`Failed to edit commands for ${rootFolder.name}`, error);
      await this.dependencies.dialogs.showError(`Failed to edit commands for ${rootFolder.name}`, {
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async stopRootApp(rootFolder: RootFolder): Promise<void> {
    try {
      const rootPath = rootFolder.path;
      this.dependencies.log(`Stopping Host app: ${rootPath}`);
      if (!this.dependencies.terminalManager.isRootAppRunning(rootPath)) {
        await this.dependencies.dialogs.showInfo(`Host app is not running: ${rootFolder.name}`);
        return;
      }

      this.dependencies.terminalManager.stopRootApp(rootPath);
      this.dependencies.refresh();
      await this.dependencies.dialogs.showSuccess(`Stopped Host app: ${rootFolder.name}`);
    } catch (error) {
      this.dependencies.logError(`Failed to stop Host app: ${rootFolder.name}`, error);
    }
  }

  async configureRootAppStartCommand(rootFolder: RootFolder): Promise<string | undefined> {
    try {
      const currentCommand = rootFolder.startCommand || '';
      const { startCommand: defaultCommand } = await this.dependencies.detectPackageManager(rootFolder.path, 'webpack');
      const startCommand = await this.dependencies.dialogs.showInput({
        title: `Configure App Start Command for ${rootFolder.name}`,
        prompt: `Configure app start command for ${rootFolder.name}`,
        value: currentCommand || defaultCommand,
        placeholder: 'e.g., npm run start, yarn dev, etc. the command to start the app'
      });

      if (!startCommand) return undefined;
      rootFolder.startCommand = startCommand;
      await this.saveRootFolderConfig(rootFolder);
      this.dependencies.refresh();
      await this.dependencies.dialogs.showSuccess(
        `Configured app start command for ${rootFolder.name}: ${startCommand}`
      );
      return startCommand;
    } catch (error) {
      this.dependencies.logError(`Failed to configure serve build command for ${rootFolder.name}`, error);
      return undefined;
    }
  }

  async loadRootFolderConfigs(): Promise<void> {
    try {
      const config = await this.dependencies.rootConfigManager.loadRootConfig();
      if (!config?.rootConfigs) return;

      for (const [rootPath, configs] of this.dependencies.getRootConfigs().entries()) {
        if (config.rootConfigs[rootPath]) {
          this.dependencies.getRootConfigs().set(rootPath, configs);
        }
      }
      this.dependencies.log('Loaded Host folder configurations');
    } catch (error) {
      this.dependencies.logError('Failed to load Host folder configurations', error);
    }
  }

  private async saveRootFolderConfig(rootFolder: RootFolder): Promise<void> {
    try {
      const configPath = this.dependencies.rootConfigManager.getConfigPath();
      if (!configPath) {
        this.dependencies.logError(
          `Failed to save Host folder config for ${rootFolder.name}`,
          'No configuration path found'
        );
        return;
      }

      const config = await this.dependencies.rootConfigManager.loadRootConfig();
      if (!config) {
        this.dependencies.logError(
          `Failed to save Host folder config for ${rootFolder.name}`,
          'No configuration found'
        );
        return;
      }

      config.rootConfigs ??= {};
      config.rootConfigs[rootFolder.path] = {
        ...config.rootConfigs[rootFolder.path],
        startCommand: rootFolder.startCommand
      };
      await this.dependencies.rootConfigManager.saveRootConfig(config);
      this.dependencies.log(`Saved Host folder configuration for ${rootFolder.name}`);
    } catch (error) {
      this.dependencies.logError(`Failed to save Host folder config for ${rootFolder.name}`, error);
    }
  }

}
