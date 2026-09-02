import type { ModuleFederationConfig, Remote } from '../../federation/types';
import type { UnifiedRootConfig } from '../roots/types';
import type { FileSystemPort, PathPort } from '../../app/ports';
import { findContainingRoot, normalizePath } from '../../infrastructure/node/pathUtils';

export interface RootConfigurationStore {
  loadRootConfig(): Promise<UnifiedRootConfig | null>;
  saveRootConfig(config: UnifiedRootConfig): Promise<void>;
}

export interface RemoteConfigurationServiceDependencies {
  rootConfigurationStore: RootConfigurationStore;
  getRootConfigs: () => ReadonlyMap<string, ModuleFederationConfig[]>;
  workspaceRoot?: string;
  fileSystem: Pick<FileSystemPort, 'existsSync' | 'statSync'>;
  path: Pick<PathPort, 'isAbsolute' | 'resolve' | 'dirname'>;
  log: (message: string) => void;
  logError: (message: string, error: unknown) => void;
}

function cloneConfig(config: ModuleFederationConfig): ModuleFederationConfig {
  return {
    ...config,
    remotes: config.remotes.map(remote => ({ ...remote })),
    exposes: config.exposes.map(expose => ({ ...expose })),
    shared: config.shared.map(dependency => ({ ...dependency }))
  };
}

function savedRootKey(config: UnifiedRootConfig, rootPath: string): string | undefined {
  const normalized = normalizePath(rootPath);
  return (
    config.roots.find(candidate => normalizePath(candidate) === normalized) ||
    Object.keys(config.rootConfigs || {}).find(candidate => normalizePath(candidate) === normalized)
  );
}

function createSavedRootKeyIndex(config: UnifiedRootConfig): Map<string, string> {
  const index = new Map<string, string>();
  for (const candidate of config.roots) {
    const normalized = normalizePath(candidate);
    if (!index.has(normalized)) index.set(normalized, candidate);
  }
  for (const candidate of Object.keys(config.rootConfigs || {})) {
    const normalized = normalizePath(candidate);
    if (!index.has(normalized)) index.set(normalized, candidate);
  }
  return index;
}

function savedRemoteSettings(remote: Remote, saved?: Remote): Remote {
  if (!saved) return { ...remote };
  return {
    ...remote,
    folder: saved.folder || remote.folder,
    url: saved.url || remote.url,
    packageManager: saved.packageManager || remote.packageManager,
    startCommand: saved.startCommand || remote.startCommand,
    buildCommand: saved.buildCommand || remote.buildCommand
  };
}

/** Owns persisted remote settings; hydration returns new discovered snapshots. */
export class RemoteConfigurationService {
  constructor(private readonly dependencies: RemoteConfigurationServiceDependencies) {}

  resolveRemoteFolderPath(remote: Remote): string {
    if (this.dependencies.path.isAbsolute(remote.folder)) return normalizePath(remote.folder);

    const roots = [...this.dependencies.getRootConfigs().keys()];
    for (const rootPath of roots) {
      const candidate = this.dependencies.path.resolve(rootPath, remote.folder);
      try {
        if (
          this.dependencies.fileSystem.existsSync(candidate) &&
          this.dependencies.fileSystem.statSync(candidate).isDirectory()
        ) {
          this.dependencies.log(`Resolved remote ${remote.name} folder path to: ${candidate}`);
          return candidate;
        }
      } catch {
        // Try next configured root.
      }
    }

    if (roots.length === 1) return this.dependencies.path.resolve(roots[0], remote.folder);
    if (this.dependencies.workspaceRoot)
      return this.dependencies.path.resolve(this.dependencies.workspaceRoot, remote.folder);
    return remote.folder;
  }

  async hydrateRemoteConfigurations(
    discoveredConfigs: ReadonlyMap<string, ModuleFederationConfig[]>,
    persistedConfig?: UnifiedRootConfig | null
  ): Promise<Map<string, ModuleFederationConfig[]>> {
    const persisted =
      persistedConfig === undefined ? await this.dependencies.rootConfigurationStore.loadRootConfig() : persistedConfig;
    const hydrated = new Map<string, ModuleFederationConfig[]>();
    const savedRootKeys = persisted ? createSavedRootKeyIndex(persisted) : undefined;

    for (const [rootPath, configs] of discoveredConfigs.entries()) {
      const key = savedRootKeys?.get(normalizePath(rootPath));
      const saved = key ? persisted?.rootConfigs?.[key] : undefined;
      const externalRemotes = Object.values(saved?.externalRemotes || {});
      hydrated.set(
        rootPath,
        configs.map(config => {
          const next = cloneConfig(config);
          next.remotes = next.remotes.map(remote => savedRemoteSettings(remote, saved?.remotes?.[remote.name]));
          const externalRemoteNames = new Set(
            next.remotes.filter(remote => remote.isExternal).map(remote => remote.name)
          );

          for (const external of externalRemotes) {
            if (!externalRemoteNames.has(external.name)) {
              next.remotes.push({
                name: external.name,
                url: external.url,
                folder: '',
                configType: 'external',
                packageManager: '',
                isExternal: true
              });
              externalRemoteNames.add(external.name);
            }
          }
          return next;
        })
      );
    }
    return hydrated;
  }

  /** Compatibility adapter for callers that still own a mutable map. */
  async loadRemoteConfigurations(): Promise<void> {
    try {
      const target = this.dependencies.getRootConfigs();
      const hydrated = await this.hydrateRemoteConfigurations(target);
      for (const [rootPath, configs] of hydrated) {
        const existingConfigs = target.get(rootPath);
        if (!existingConfigs) {
          continue;
        }
        existingConfigs.forEach((existingConfig, index) => {
          const nextConfig = configs[index];
          if (!nextConfig) return;
          const existingRemotes = existingConfig.remotes;
          Object.assign(existingConfig, nextConfig, { remotes: existingRemotes });
          for (const nextRemote of nextConfig.remotes) {
            const existingRemote = existingRemotes.find(
              candidate => candidate.name === nextRemote.name && candidate.isExternal === nextRemote.isExternal
            );
            if (existingRemote) Object.assign(existingRemote, nextRemote);
            else existingRemotes.push(nextRemote);
          }
        });
      }
      this.dependencies.log('Loaded remote configurations from unified config');
    } catch (error) {
      this.dependencies.logError('Failed to load remote configurations', error);
    }
  }

  private findRootForRemote(remote: Remote, config: UnifiedRootConfig): string | undefined {
    const roots = config.roots;
    if (remote.configSource) {
      const sourceRoot = findContainingRoot(this.dependencies.path.dirname(remote.configSource), roots);
      if (sourceRoot) return sourceRoot;
    }
    const resolved = this.resolveRemoteFolderPath(remote);
    return findContainingRoot(resolved, roots) || (roots.length === 1 ? roots[0] : undefined);
  }

  async saveRemoteConfiguration(remote: Remote): Promise<void> {
    try {
      const config = await this.dependencies.rootConfigurationStore.loadRootConfig();
      if (!config) throw new Error('No configuration found');
      const rootPath = this.findRootForRemote(remote, config);
      if (!rootPath) throw new Error(`Could not identify configured root for remote "${remote.name}"`);

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

  async saveExternalRemoteConfiguration(rootPath: string, externalRemote: Remote): Promise<void> {
    try {
      const config = await this.dependencies.rootConfigurationStore.loadRootConfig();
      if (!config) throw new Error('No configuration found');
      const owningRoot = findContainingRoot(rootPath, config.roots) || savedRootKey(config, rootPath);
      if (!owningRoot)
        throw new Error(`Could not identify configured root for external remote "${externalRemote.name}"`);

      config.rootConfigs ??= {};
      config.rootConfigs[owningRoot] ??= {};
      config.rootConfigs[owningRoot].externalRemotes ??= {};
      config.rootConfigs[owningRoot].externalRemotes![externalRemote.name] = {
        name: externalRemote.name,
        url: externalRemote.url || '',
        configType: 'external',
        isExternal: true
      };
      await this.dependencies.rootConfigurationStore.saveRootConfig(config);
    } catch (error) {
      this.dependencies.logError(`Failed to save external remote ${externalRemote.name}`, error);
      throw error;
    }
  }

  async removeExternalRemoteFromConfiguration(rootPath: string, remoteName: string): Promise<void> {
    try {
      const config = await this.dependencies.rootConfigurationStore.loadRootConfig();
      if (!config) throw new Error('No configuration found');
      const owningRoot = findContainingRoot(rootPath, config.roots) || savedRootKey(config, rootPath);
      const rootConfig = owningRoot ? config.rootConfigs?.[owningRoot] : undefined;
      if (!rootConfig?.externalRemotes) return;
      delete rootConfig.externalRemotes[remoteName];
      if (Object.keys(rootConfig.externalRemotes).length === 0) delete rootConfig.externalRemotes;
      await this.dependencies.rootConfigurationStore.saveRootConfig(config);
    } catch (error) {
      this.dependencies.logError(`Failed to remove external remote ${remoteName}`, error);
      throw error;
    }
  }
}
