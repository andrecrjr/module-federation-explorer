import * as vscode from 'vscode';
import {
  extractConfigFromModernJS,
  extractConfigFromRSBuild,
  extractConfigFromVite,
  extractConfigFromWebpack,
  parseConfigFile
} from './configExtractors';
import { ModuleFederationConfig } from './types';

export type ConfigFileType = 'webpack' | 'vite' | 'modernjs' | 'rsbuild' | 'rspack';

export interface ConfigurationLoadError {
  filePath: string;
  error: unknown;
}

export interface ConfigurationSnapshot {
  configs: Map<string, ModuleFederationConfig[]>;
  errors: ConfigurationLoadError[];
}

type ConfigExtractor = (ast: unknown, workspaceRoot: string) => Promise<ModuleFederationConfig>;

interface ConfigFileDefinition {
  type: ConfigFileType;
  pattern: string;
  extractor: ConfigExtractor;
}

export interface ConfigurationServiceDependencies {
  findFiles: (rootPath: string, pattern: string, excludePattern: string) => Promise<string[]>;
  parseConfigFile: (filePath: string, extractor: ConfigExtractor) => Promise<ModuleFederationConfig>;
}

const CONFIG_FILES: ConfigFileDefinition[] = [
  { type: 'webpack', pattern: '**/{webpack.config.js,webpack.config.ts}', extractor: extractConfigFromWebpack },
  { type: 'vite', pattern: '**/{vite.config.js,vite.config.ts}', extractor: extractConfigFromVite },
  { type: 'modernjs', pattern: '**/module-federation.config.{js,ts}', extractor: extractConfigFromModernJS },
  { type: 'rsbuild', pattern: '**/{rsbuild.config.js,rsbuild.config.ts}', extractor: extractConfigFromRSBuild },
  { type: 'rspack', pattern: '**/{rspack.config.js,rspack.config.ts}', extractor: extractConfigFromWebpack }
];

const defaultDependencies: ConfigurationServiceDependencies = {
  findFiles: async (rootPath, pattern, excludePattern) => {
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(rootPath, pattern),
      excludePattern
    );
    return files.map(file => file.fsPath);
  },
  parseConfigFile
};

/** Loads and normalizes workspace federation configuration without owning tree state. */
export class ConfigurationService {
  constructor(private readonly dependencies: ConfigurationServiceDependencies = defaultDependencies) {}

  async load(rootPaths: readonly string[]): Promise<ConfigurationSnapshot> {
    const configs = new Map<string, ModuleFederationConfig[]>();
    const errors: ConfigurationLoadError[] = [];

    for (const rootPath of rootPaths) {
      const rootConfigs: ModuleFederationConfig[] = [];

      const discoveredFiles = await Promise.all(
        CONFIG_FILES.map(async definition => ({
          definition,
          files: await this.dependencies.findFiles(rootPath, definition.pattern, '**/node_modules/**')
        }))
      );

      for (const { definition, files } of discoveredFiles) {
        for (const filePath of files) {
          try {
            const config = await this.dependencies.parseConfigFile(filePath, definition.extractor);
            if (!config.detected) continue;

            const normalizedConfig = {
              ...config,
              configPath: filePath
            };

            for (const remote of normalizedConfig.remotes) {
              remote.configSource = filePath;
            }
            for (const expose of normalizedConfig.exposes) {
              expose.configSource = filePath;
            }

            rootConfigs.push(normalizedConfig);
          } catch (error) {
            errors.push({ filePath, error });
          }
        }
      }

      if (rootConfigs.length > 0) {
        configs.set(rootPath, rootConfigs);
      }
    }

    return { configs, errors };
  }
}
