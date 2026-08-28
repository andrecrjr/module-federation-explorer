import * as fsSync from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ModuleFederationConfig, Remote, RemotesFolder } from './types';
import { DialogService, PackageManagerDetector } from './providerDependencies';
import { RemoteConfigurationService } from './remoteConfigurationService';

export interface RemoteWorkflowDependencies {
  workspaceRoot?: string;
  dialogs: DialogService;
  detectPackageManager: PackageManagerDetector;
  getRootConfigs: () => Map<string, ModuleFederationConfig[]>;
  remoteConfigurationService: RemoteConfigurationService;
  refresh: () => void;
  log: (message: string) => void;
  logError: (message: string, error: unknown) => void;
}

/** Coordinates remote command editing and external-remote UI workflows. */
export class RemoteWorkflow {
  constructor(private readonly dependencies: RemoteWorkflowDependencies) {}

  async editRemoteCommands(remote: Remote): Promise<void> {
    try {
      const resolvedFolderPath = this.dependencies.remoteConfigurationService.resolveRemoteFolderPath(remote);
      this.dependencies.log(`Editing commands for remote ${remote.name}, folder: ${resolvedFolderPath || 'not set'}`);

      let packageManager = remote.packageManager;
      if (resolvedFolderPath && !packageManager) {
        const configType = remote.configType === 'vite' || remote.configType === 'rsbuild'
          ? remote.configType
          : 'webpack';
        ({ packageManager } = await this.dependencies.detectPackageManager(resolvedFolderPath, configType));
        remote.packageManager = packageManager;
      }

      const options = [
        { label: '📁 Change Project Folder', description: resolvedFolderPath || 'Not configured' },
        { label: '🔨 Edit Build Command', description: remote.buildCommand || 'Not configured' },
        { label: '▶️ Edit Preview Build Command', description: remote.startCommand || 'Not configured' },
        { label: '⚙️ Edit Both Commands', description: 'Configure both build and start commands' }
      ];

      const selectedOption = await this.dependencies.dialogs.showQuickPick(options, {
        title: `Edit Configuration for ${remote.name}`,
        placeholder: 'What would you like to edit?'
      });

      if (!selectedOption || Array.isArray(selectedOption)) return;

      if (selectedOption.label.includes('Change Project Folder')) {
        let defaultUri: vscode.Uri | undefined;
        if (this.dependencies.workspaceRoot) {
          defaultUri = vscode.Uri.file(path.dirname(this.dependencies.workspaceRoot));
        }

        const newFolder = await this.dependencies.dialogs.showFolderPicker({
          title: `Select New Project Folder for Remote "${remote.name}"`,
          openLabel: `Select "${remote.name}" Project Folder`,
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
            `No folder selected for remote "${remote.name}".`,
            { detail: 'Folder configuration was not changed.' }
          );
          return;
        }

        remote.folder = newFolder;
        this.dependencies.log(`Updated project folder for remote ${remote.name}: ${newFolder}`);
        const configType = remote.configType === 'vite' || remote.configType === 'rsbuild'
          ? remote.configType
          : 'webpack';
        const packageManagerInfo = await this.dependencies.detectPackageManager(newFolder, configType);
        remote.packageManager = packageManagerInfo.packageManager;
        await this.dependencies.remoteConfigurationService.saveRemoteConfiguration(remote);
        this.dependencies.refresh();
        await this.dependencies.dialogs.showSuccess(`Updated project folder for ${remote.name}`);
        return;
      }

      if (!resolvedFolderPath) {
        await this.dependencies.dialogs.showError(`Cannot edit commands for ${remote.name}: Folder not configured`, {
          detail: 'Please configure the project folder first by selecting "Change Project Folder".'
        });
        return;
      }

      if (selectedOption.label.includes('Edit Build Command') || selectedOption.label.includes('Edit Both Commands')) {
        const buildCommand = await this.dependencies.dialogs.showCommandConfig({
          title: `Configure Build Command for ${remote.name}`,
          commandType: 'build',
          currentCommand: remote.buildCommand,
          packageManager,
          projectPath: resolvedFolderPath,
          configType: remote.configType
        });

        if (buildCommand !== undefined) {
          remote.buildCommand = buildCommand;
        } else if (selectedOption.label.includes('Edit Build Command')) {
          return;
        }
      }

      if (selectedOption.label.includes('Edit Preview Build Command') || selectedOption.label.includes('Edit Both Commands')) {
        const startCommand = await this.dependencies.dialogs.showCommandConfig({
          title: `Configure Start Command for ${remote.name}`,
          commandType: 'start',
          currentCommand: remote.startCommand,
          packageManager,
          projectPath: resolvedFolderPath,
          configType: remote.configType
        });

        if (startCommand !== undefined) {
          remote.startCommand = startCommand;
        } else if (selectedOption.label.includes('Edit Start Command')) {
          return;
        }
      }

      await this.dependencies.remoteConfigurationService.saveRemoteConfiguration(remote);
      this.dependencies.refresh();
      await this.dependencies.dialogs.showSuccess(`Updated commands for ${remote.name}`);
    } catch (error) {
      this.dependencies.logError(`Failed to edit commands for ${remote.name}`, error);
      await this.dependencies.dialogs.showError(`Failed to edit commands for ${remote.name}`, {
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async addExternalRemote(remotesFolder: RemotesFolder): Promise<void> {
    try {
      this.dependencies.log(`Adding external remote for host ${remotesFolder.parentName}`);
      const remote = await this.promptForExternalRemote();
      if (!remote) return;

      let targetRootPath = '';
      for (const [rootPath, configs] of this.dependencies.getRootConfigs().entries()) {
        for (const config of configs) {
          if (config.name === remotesFolder.parentName) {
            targetRootPath = rootPath;
            break;
          }
        }
        if (targetRootPath) break;
      }

      if (!targetRootPath) {
        await this.dependencies.dialogs.showError('Failed to find host configuration', {
          detail: `Could not find configuration for host "${remotesFolder.parentName}"`
        });
        return;
      }

      if (remotesFolder.remotes.find(existingRemote => existingRemote.name === remote.name)) {
        await this.dependencies.dialogs.showError('Remote already exists', {
          detail: `A remote named "${remote.name}" already exists in host "${remotesFolder.parentName}"`
        });
        return;
      }

      await this.dependencies.remoteConfigurationService.saveExternalRemoteConfiguration(targetRootPath, remote);
      remotesFolder.remotes.push(remote);
      this.dependencies.refresh();
      await this.dependencies.dialogs.showSuccess(
        `Added external remote "${remote.name}" to host "${remotesFolder.parentName}"`
      );
    } catch (error) {
      this.dependencies.logError('Failed to add external remote', error);
      await this.dependencies.dialogs.showError('Failed to add external remote', {
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async removeExternalRemote(remote: Remote): Promise<void> {
    try {
      this.dependencies.log(`Removing external remote ${remote.name}`);
      const confirmed = await this.dependencies.dialogs.showConfirmation(
        `Are you sure you want to remove external remote "${remote.name}"?`,
        { destructive: true, confirmText: 'Remove', cancelText: 'Cancel' }
      );
      if (!confirmed) return;

      let targetRootPath = '';
      for (const [rootPath, configs] of this.dependencies.getRootConfigs().entries()) {
        for (const config of configs) {
          if (config.remotes.some(candidate => candidate.name === remote.name && candidate.isExternal)) {
            targetRootPath = rootPath;
            break;
          }
        }
        if (targetRootPath) break;
      }

      if (!targetRootPath) {
        await this.dependencies.dialogs.showError('Failed to find external remote configuration', {
          detail: `Could not find configuration for external remote "${remote.name}"`
        });
        return;
      }

      await this.dependencies.remoteConfigurationService.removeExternalRemoteFromConfiguration(
        targetRootPath,
        remote.name
      );

      for (const configs of this.dependencies.getRootConfigs().values()) {
        for (const config of configs) {
          const remoteIndex = config.remotes.findIndex(
            candidate => candidate.name === remote.name && candidate.isExternal
          );
          if (remoteIndex !== -1) {
            config.remotes.splice(remoteIndex, 1);
            this.dependencies.log(`Removed external remote ${remote.name} from config ${config.name}`);
          }
        }
      }

      this.dependencies.refresh();
      await this.dependencies.dialogs.showSuccess(`Removed external remote "${remote.name}"`);
    } catch (error) {
      this.dependencies.logError('Failed to remove external remote', error);
      await this.dependencies.dialogs.showError('Failed to remove external remote', {
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async addExternalRemoteToHost(remotesFolder: RemotesFolder, targetRootPath: string): Promise<void> {
    try {
      this.dependencies.log(`Adding external remote for host ${remotesFolder.parentName} at path ${targetRootPath}`);
      const remote = await this.promptForExternalRemote();
      if (!remote) return;

      const configs = this.dependencies.getRootConfigs().get(targetRootPath);
      if (configs) {
        for (const config of configs) {
          if (config.remotes.find(existingRemote => existingRemote.name === remote.name)) {
            await this.dependencies.dialogs.showError('Remote already exists', {
              detail: `A remote named "${remote.name}" already exists in host "${remotesFolder.parentName}"`
            });
            return;
          }
        }
      }

      await this.dependencies.remoteConfigurationService.saveExternalRemoteConfiguration(targetRootPath, remote);
      if (configs) {
        for (const config of configs) {
          config.remotes.push(remote);
        }
      }

      this.dependencies.refresh();
      await this.dependencies.dialogs.showSuccess(
        `Added external remote "${remote.name}" to host "${remotesFolder.parentName}"`
      );
    } catch (error) {
      this.dependencies.logError('Failed to add external remote', error);
      await this.dependencies.dialogs.showError('Failed to add external remote', {
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async promptForExternalRemote(): Promise<Remote | undefined> {
    const remoteName = await this.dependencies.dialogs.showInput({
      title: 'Add External Remote',
      prompt: 'Enter the name of the external remote',
      placeholder: 'e.g., shared-components, auth-service, etc.',
      validateInput: (value: string) => {
        if (!value || value.trim() === '') return 'Remote name is required';
        if (!/^[a-zA-Z0-9_-]+$/.test(value.trim())) {
          return 'Remote name can only contain letters, numbers, hyphens, and underscores';
        }
        return undefined;
      }
    });
    if (!remoteName) return undefined;

    const remoteUrl = await this.dependencies.dialogs.showInput({
      title: 'Add External Remote',
      prompt: `Enter the URL for remote "${remoteName}"`,
      placeholder: 'e.g., http://localhost:3001/remoteEntry.js, https://my-remote.com/remoteEntry.js',
      validateInput: (value: string) => {
        if (!value || value.trim() === '') return 'Remote URL is required';
        try {
          new URL(value.trim());
          return undefined;
        } catch {
          return 'Please enter a valid URL';
        }
      }
    });
    if (!remoteUrl) return undefined;

    return {
      name: remoteName.trim(),
      url: remoteUrl.trim(),
      folder: '',
      configType: 'external',
      packageManager: '',
      isExternal: true
    };
  }
}
