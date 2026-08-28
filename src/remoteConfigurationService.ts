import * as fs from 'fs';
import * as path from 'path';
import { ModuleFederationConfig, Remote, UnifiedRootConfig } from './types';

export interface RootConfigurationStore {
  loadRootConfig(): Promise<UnifiedRootConfig | null>;
  saveRootConfig(config: UnifiedRootConfig): Promise<void>;
}

export interface RemoteConfigurationServiceDependencies {
  rootConfigurationStore: RootConfigurationStore;
  getRootConfigs: () => Map<string, ModuleFederationConfig[]>;
  workspaceRoot?: string;
  log: (message: string) => void;
  logError: (message: string, error: unknown) => void;
}

/** Owns persisted remote state while keeping the provider's in-memory snapshot authoritative for the tree. */
export class RemoteConfigurationService {
  constructor(private readonly dependencies: RemoteConfigurationServiceDependencies) {}

  resolveRemoteFolderPath(remote: Remote): string {
    if (path.isAbsolute(remote.folder)) {
      return remote.folder;
    }

    for (const rootPath of this.dependencies.getRootConfigs().keys()) {
      const remoteFolderPath = path.join(rootPath, remote.folder);
      try {
        if (fs.existsSync(remoteFolderPath) && fs.statSync(remoteFolderPath).isDirectory()) {
          this.dependencies.log(`Resolved remote ${remote.name} folder path to: ${remoteFolderPath}`);
          return remoteFolderPath;
        }
      } catch {
        // Continue checking other configured roots.
      }
    }

    const rootPaths = Array.from(this.dependencies.getRootConfigs().keys());
    if (rootPaths.length > 0) {
      const defaultPath = path.resolve(rootPaths[0], remote.folder);
      this.dependencies.log(`Using default folder path for remote ${remote.name}: ${defaultPath}`);
      return defaultPath;
    }

    if (this.dependencies.workspaceRoot) {
      const workspacePath = path.join(this.dependencies.workspaceRoot, remote.folder);
      this.dependencies.log(`Using workspace Host for remote ${remote.name}: ${workspacePath}`);
      return workspacePath;
    }

    return remote.folder;
  }

  async saveRemoteConfiguration(remote: Remote): Promise<void> {
    try {
      this.dependencies.log(`Saving configuration for remote ${remote.name}`);
      const config = await this.dependencies.rootConfigurationStore.loadRootConfig();
      if (!config) {
        this.dependencies.logError(
          `Failed to save configuration for remote ${remote.name}`,
          'No configuration found'
        );
        return;
      }

      const resolvedFolderPath = this.resolveRemoteFolderPath(remote);
      let rootPath = '';
      for (const configuredRoot of config.roots) {
        if (resolvedFolderPath.startsWith(configuredRoot)) {
          rootPath = configuredRoot;
          break;
        }
      }

      if (!rootPath && config.roots.length > 0) {
        rootPath = config.roots[0];
      }

      config.rootConfigs ??= {};
      config.rootConfigs[rootPath] ??= {};
      config.rootConfigs[rootPath].remotes ??= {};
      config.rootConfigs[rootPath].remotes![remote.name] = {
        name: remote.name,
        url: remote.url,
        folder: remote.folder,
        packageManager: remote.packageManager,
        configType: remote.configType,
        startCommand: remote.startCommand,
        buildCommand: remote.buildCommand
      };

      await this.dependencies.rootConfigurationStore.saveRootConfig(config);
      this.dependencies.log(`Saved configuration for remote ${remote.name} in Host ${rootPath}`);
    } catch (error) {
      this.dependencies.logError(`Failed to save configuration for remote ${remote.name}`, error);
    }
  }

  async loadRemoteConfigurations(): Promise<void> {
    try {
      const config = await this.dependencies.rootConfigurationStore.loadRootConfig();
      if (!config) {
        this.dependencies.log('No root configuration found');
        return;
      }

      if (!config.rootConfigs) {
        this.dependencies.log('No saved Host configurations found');
        return;
      }

      const rootConfigs = this.dependencies.getRootConfigs();
      for (const [rootPath, rootConfig] of Object.entries(config.rootConfigs)) {
        if (rootConfig.remotes) {
          for (const [remoteName, savedRemote] of Object.entries(rootConfig.remotes)) {
            for (const configs of rootConfigs.values()) {
              for (const mfeConfig of configs) {
                for (const remote of mfeConfig.remotes) {
                  if (remote.name === remoteName) {
                    this.dependencies.log(
                      `Updating remote ${remote.name} with saved configuration from Host ${rootPath}`
                    );
                    remote.folder = savedRemote.folder || remote.name;
                    remote.url = savedRemote.url || remote.url;
                    remote.packageManager = savedRemote.packageManager || remote.packageManager;
                    remote.startCommand = savedRemote.startCommand || remote.startCommand;
                    remote.buildCommand = savedRemote.buildCommand || remote.buildCommand;
                  }
                }
              }
            }
          }
        }

        if (rootConfig.externalRemotes) {
          this.dependencies.log(
            `Loading ${Object.keys(rootConfig.externalRemotes).length} external remotes for root ${rootPath}`
          );
          const configs = rootConfigs.get(rootPath);
          if (configs) {
            for (const [externalRemoteName, externalRemoteConfig] of Object.entries(rootConfig.externalRemotes)) {
              this.dependencies.log(
                `Adding external remote ${externalRemoteName} to configurations in ${rootPath}`
              );
              const externalRemote: Remote = {
                name: externalRemoteConfig.name,
                url: externalRemoteConfig.url,
                folder: '',
                configType: 'external',
                packageManager: '',
                isExternal: true
              };

              for (const mfeConfig of configs) {
                const existingRemote = mfeConfig.remotes.find(
                  remote => remote.name === externalRemoteName && remote.isExternal
                );
                if (!existingRemote) {
                  mfeConfig.remotes.push(externalRemote);
                  this.dependencies.log(`Added external remote ${externalRemoteName} to config ${mfeConfig.name}`);
                }
              }
            }
          }
        }
      }

      this.dependencies.log('Loaded remote configurations from unified config');
    } catch (error) {
      this.dependencies.logError('Failed to load remote configurations', error);
    }
  }

  async saveExternalRemoteConfiguration(rootPath: string, externalRemote: Remote): Promise<void> {
    try {
      this.dependencies.log(
        `Saving external remote configuration for ${externalRemote.name} in root ${rootPath}`
      );
      const config = await this.dependencies.rootConfigurationStore.loadRootConfig();
      if (!config) throw new Error('No configuration found');

      config.rootConfigs ??= {};
      config.rootConfigs[rootPath] ??= {};
      config.rootConfigs[rootPath].externalRemotes ??= {};
      config.rootConfigs[rootPath].externalRemotes![externalRemote.name] = {
        name: externalRemote.name,
        url: externalRemote.url!,
        configType: 'external',
        isExternal: true
      };

      await this.dependencies.rootConfigurationStore.saveRootConfig(config);
      this.dependencies.log(
        `Saved external remote configuration for ${externalRemote.name} in root ${rootPath}`
      );
    } catch (error) {
      this.dependencies.logError(
        `Failed to save external remote configuration for ${externalRemote.name}`,
        error
      );
      throw error;
    }
  }

  async removeExternalRemoteFromConfiguration(rootPath: string, remoteName: string): Promise<void> {
    try {
      this.dependencies.log(`Removing external remote ${remoteName} from configuration in root ${rootPath}`);
      const config = await this.dependencies.rootConfigurationStore.loadRootConfig();
      if (!config) throw new Error('No configuration found');

      const rootConfig = config.rootConfigs?.[rootPath];
      if (!rootConfig?.externalRemotes) {
        this.dependencies.log(`No external remotes configuration found for root ${rootPath}`);
        return;
      }

      delete rootConfig.externalRemotes[remoteName];
      if (Object.keys(rootConfig.externalRemotes).length === 0) {
        delete rootConfig.externalRemotes;
      }

      await this.dependencies.rootConfigurationStore.saveRootConfig(config);
      this.dependencies.log(`Removed external remote ${remoteName} from configuration in root ${rootPath}`);
    } catch (error) {
      this.dependencies.logError(
        `Failed to remove external remote ${remoteName} from configuration`,
        error
      );
      throw error;
    }
  }
}
