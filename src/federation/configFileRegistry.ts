import * as vscode from 'vscode';
import type { ModuleFederationConfig } from './types';
import { parseConfigFile, type ConfigExtractor, type ParseDiagnostic } from '../parser/parseConfigFile';
import { extractConfigFromModernJS } from '../extractors/modernjs';
import { extractConfigFromRSBuild } from '../extractors/rsbuild';
import { extractConfigFromVite } from '../extractors/vite';
import { extractConfigFromWebpack } from '../extractors/webpack';

export type ConfigFileType = 'webpack' | 'vite' | 'modernjs' | 'rsbuild' | 'rspack';

export interface ConfigFileDefinition {
  readonly type: ConfigFileType;
  readonly pattern: string;
  readonly extractor: ConfigExtractor<ModuleFederationConfig>;
}

export const CONFIG_FILE_DEFINITIONS: readonly ConfigFileDefinition[] = [
  { type: 'webpack', pattern: '**/{webpack.config.js,webpack.config.ts}', extractor: extractConfigFromWebpack },
  { type: 'vite', pattern: '**/{vite.config.js,vite.config.ts}', extractor: extractConfigFromVite },
  {
    type: 'modernjs',
    pattern: '**/{module-federation.config.js,module-federation.config.ts,modern.config.js,modern.config.ts}',
    extractor: extractConfigFromModernJS
  },
  { type: 'rsbuild', pattern: '**/{rsbuild.config.js,rsbuild.config.ts}', extractor: extractConfigFromRSBuild },
  {
    type: 'rspack',
    pattern: '**/{rspack.config.js,rspack.config.ts}',
    extractor: (ast, workspaceRoot) => extractConfigFromWebpack(ast, workspaceRoot, 'rspack')
  }
];

export interface FederationFileDiscovery {
  findFiles(rootPath: string, pattern: string, excludePattern: string): Promise<string[]>;
}

export interface FederationDiscoveryDependencies extends FederationFileDiscovery {
  parseConfigFile: (
    filePath: string,
    extractor: ConfigExtractor<ModuleFederationConfig>
  ) => Promise<ModuleFederationConfig>;
}

export interface DiscoveredConfiguration {
  rootPath: string;
  filePath: string;
  type: ConfigFileType;
  config: ModuleFederationConfig;
}

export interface FederationDiscoveryResult {
  configurations: DiscoveredConfiguration[];
  errors: Array<{ filePath: string; error: unknown; diagnostics?: readonly ParseDiagnostic[] }>;
}

export class FederationDiscoveryService {
  constructor(private readonly dependencies: FederationDiscoveryDependencies) {}

  async discover(rootPaths: readonly string[]): Promise<FederationDiscoveryResult> {
    const configurations: DiscoveredConfiguration[] = [];
    const errors: FederationDiscoveryResult['errors'] = [];
    const seenFiles = new Set<string>();

    for (const rootPath of rootPaths) {
      const matches = await Promise.all(
        CONFIG_FILE_DEFINITIONS.map(async definition => ({
          definition,
          files: await this.dependencies.findFiles(rootPath, definition.pattern, '**/node_modules/**')
        }))
      );

      for (const { definition, files } of matches) {
        for (const filePath of files) {
          if (seenFiles.has(filePath)) continue;
          seenFiles.add(filePath);
          try {
            const config = await this.dependencies.parseConfigFile(filePath, definition.extractor);
            if (config.detected) configurations.push({ rootPath, filePath, type: definition.type, config });
          } catch (error) {
            const diagnostics =
              error && typeof error === 'object' && 'diagnostics' in error
                ? (error as { diagnostics?: readonly ParseDiagnostic[] }).diagnostics
                : undefined;
            errors.push({ filePath, error, diagnostics });
          }
        }
      }
    }

    return { configurations, errors };
  }
}

export function createVscodeDiscoveryDependencies(): FederationDiscoveryDependencies {
  return {
    findFiles: async (rootPath, pattern, excludePattern) => {
      const files = await vscode.workspace.findFiles(new vscode.RelativePattern(rootPath, pattern), excludePattern);
      return files.map(file => file.fsPath);
    },
    parseConfigFile
  };
}
