import * as path from 'path';
import type { ModuleFederationConfig } from './types';
import {
  createVscodeDiscoveryDependencies,
  FederationDiscoveryService,
  type FederationFileDiscovery
} from './federation/configFileRegistry';
import { parseConfigFile } from './parser/parseConfigFile';
import type { ConfigExtractor, ParseDiagnostic } from './parser/parseConfigFile';
import type { WorkspaceFileDiscovery } from './app/ports';
import { detectPackageManagerAndStartCommand } from './packageManager';

export type { ConfigFileType } from './federation/configFileRegistry';

export interface ConfigurationLoadError {
  filePath: string;
  error: unknown;
  diagnostics?: readonly ParseDiagnostic[];
}

export interface ConfigurationSnapshot {
  configs: Map<string, ModuleFederationConfig[]>;
  errors: ConfigurationLoadError[];
}

export interface ConfigurationServiceDependencies extends WorkspaceFileDiscovery {
  parseConfigFile: (filePath: string, extractor: ConfigExtractor<ModuleFederationConfig>) => Promise<ModuleFederationConfig>;
  enrichRemote?: (remote: ModuleFederationConfig['remotes'][number], configPath: string) => Promise<Partial<ModuleFederationConfig['remotes'][number]>>;
}

const defaultDependencies: ConfigurationServiceDependencies = {
  ...createVscodeDiscoveryDependencies(),
  parseConfigFile,
  enrichRemote: async (remote, configPath) => {
    const configType = remote.configType === 'vite' || remote.configType === 'rsbuild' ? remote.configType : 'webpack';
    const folder = path.resolve(path.dirname(configPath), remote.folder);
    return detectPackageManagerAndStartCommand(folder, configType);
  }
};

/** Loads federation configuration through shared registry/discovery pipeline. */
export class ConfigurationService {
  constructor(private readonly dependencies: ConfigurationServiceDependencies = defaultDependencies) {}

  async load(rootPaths: readonly string[]): Promise<ConfigurationSnapshot> {
    const discoveryDependencies: FederationFileDiscovery & Pick<ConfigurationServiceDependencies, 'parseConfigFile'> = {
      findFiles: this.dependencies.findFiles,
      parseConfigFile: this.dependencies.parseConfigFile
    };
    const result = await new FederationDiscoveryService(discoveryDependencies).discover(rootPaths);
    const configs = new Map<string, ModuleFederationConfig[]>();

    for (const discovered of result.configurations) {
      const remotes = await Promise.all(discovered.config.remotes.map(async remote => ({
        ...remote,
        ...(this.dependencies.enrichRemote ? await this.dependencies.enrichRemote(remote, discovered.filePath) : {}),
        configSource: discovered.filePath
      })));
      const config = {
        ...discovered.config,
        configPath: discovered.filePath,
        remotes,
        exposes: discovered.config.exposes.map(expose => ({ ...expose, configSource: discovered.filePath }))
      };
      const rootConfigs = configs.get(discovered.rootPath) ?? [];
      rootConfigs.push(config);
      configs.set(discovered.rootPath, rootConfigs);
    }

    return { configs, errors: result.errors };
  }
}
