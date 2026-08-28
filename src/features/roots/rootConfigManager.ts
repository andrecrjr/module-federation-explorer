import * as path from 'path';
import * as vscode from 'vscode';
import { DialogUtils } from '../../dialogUtils';
import { outputChannel } from '../../outputChannel';
import type { UnifiedRootConfig } from '../../types';
import { migrateLegacyRootConfig, parseRootConfig } from './rootConfigSchema';
import { JsonRootConfigRepository, type RootConfigRepository } from './rootConfigRepository';
import { normalizePath } from './pathUtils';

/** User-facing root configuration workflow backed by a JSON repository. */
export class RootConfigManager {
  static readonly CONFIG_FILENAME = 'mf-explorer.roots.json';
  private static readonly CONFIG_DIR = '.vscode';

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repository: RootConfigRepository = new JsonRootConfigRepository()
  ) {}

  private log(message: string): void {
    outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  private logError(message: string, error: unknown): void {
    const details = error instanceof Error ? error.stack || error.message : String(error);
    outputChannel.appendLine(`[${new Date().toISOString()}] ERROR: ${message}:\n${details}`);
    void DialogUtils.showError(message, { detail: error instanceof Error ? error.message : String(error) });
  }

  getConfigPath(): string | undefined {
    const configured = this.context.workspaceState.get<string>('mf-explorer.configPath');
    if (configured) return configured;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    return workspaceFolder
      ? path.join(workspaceFolder.uri.fsPath, RootConfigManager.CONFIG_DIR, RootConfigManager.CONFIG_FILENAME)
      : undefined;
  }

  async setConfigPath(configPath: string): Promise<void> {
    await this.context.workspaceState.update('mf-explorer.configPath', configPath);
    this.log(`Set configuration path to: ${configPath}`);
  }

  async findExistingConfigs(): Promise<string[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const paths: string[] = [];
    for (const folder of workspaceFolders) {
      const directory = path.join(folder.uri.fsPath, RootConfigManager.CONFIG_DIR);
      try {
        const entries = await (await import('fs/promises')).readdir(directory);
        paths.push(...entries.filter(file => file.endsWith('.json')).map(file => path.join(directory, file)));
      } catch {
        // Missing .vscode directory is expected.
      }
    }
    return paths;
  }

  async selectOrCreateConfigPath(): Promise<string | undefined> {
    const existing = await this.findExistingConfigs();
    const options: vscode.QuickPickItem[] = [
      { label: '$(add) Create new configuration', description: 'Create a new configuration file' },
      ...existing.map(configPath => ({ label: `$(file) ${path.basename(configPath)}`, description: vscode.workspace.asRelativePath(configPath) })),
      { label: '$(folder) Browse...', description: 'Select a configuration file from the file system' }
    ];
    const selected = await DialogUtils.showQuickPick(options, {
      title: 'Module Federation Configuration',
      placeholder: 'Select an existing configuration or create a new one'
    });
    if (!selected || Array.isArray(selected)) return undefined;
    if (selected.label === '$(add) Create new configuration') return this.createNewConfigPath();
    if (selected.label === '$(folder) Browse...') {
      const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, filters: { 'JSON files': ['json'] }, title: 'Select Module Federation Explorer Configuration File', openLabel: 'Select Configuration' });
      return uris?.[0]?.fsPath;
    }
    return existing.find(configPath => vscode.workspace.asRelativePath(configPath) === selected.description);
  }

  private async createNewConfigPath(): Promise<string | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    if (workspaceFolders.length === 0) {
      await DialogUtils.showError('No workspace folder is open');
      return undefined;
    }
    let target = workspaceFolders[0].uri;
    if (workspaceFolders.length > 1) {
      const selected = await DialogUtils.showQuickPick(workspaceFolders.map(folder => ({ label: folder.name, description: folder.uri.fsPath })), {
        title: 'Create Module Federation Configuration', placeholder: 'Select a workspace folder for the configuration'
      });
      if (!selected || Array.isArray(selected)) return undefined;
      const folder = workspaceFolders.find(candidate => candidate.name === selected.label);
      if (!folder) return undefined;
      target = folder.uri;
    }
    const fileName = await DialogUtils.showInput({ title: 'Configuration File Name', prompt: 'Enter a name for your Module Federation configuration file', value: RootConfigManager.CONFIG_FILENAME, placeholder: 'Example: mf-explorer.roots.json' });
    if (!fileName) return undefined;
    return path.join(target.fsPath, RootConfigManager.CONFIG_DIR, fileName.endsWith('.json') ? fileName : `${fileName}.json`);
  }

  async loadRootConfig(): Promise<UnifiedRootConfig | null> {
    const configPath = this.getConfigPath();
    if (!configPath) return null;
    if (!await this.repository.exists(configPath)) return { roots: [] };
    try {
      const parsed = await this.repository.read(configPath);
      const config = parseRootConfig(parsed);
      if (config) return config;
      const migrated = migrateLegacyRootConfig(parsed);
      if (migrated) {
        await this.saveRootConfig(migrated);
        return migrated;
      }
      this.log(`Configuration file has unsupported format at ${configPath}`);
      return { roots: [] };
    } catch (error) {
      this.logError('Failed to load root configuration', error);
      return { roots: [] };
    }
  }

  async saveRootConfig(config: UnifiedRootConfig): Promise<void> {
    const configPath = this.getConfigPath();
    if (!configPath) {
      this.logError('Failed to save root configuration', 'No configuration path found');
      return;
    }
    try {
      await this.repository.write(configPath, config);
      this.log(`Saved root configuration with ${config.roots.length} roots to ${configPath}`);
    } catch (error) {
      this.logError('Failed to save root configuration', error);
    }
  }

  async addRoot(rootPath: string): Promise<void> {
    try {
      const fs = await import('fs/promises');
      if (!(await fs.stat(rootPath)).isDirectory()) throw new Error(`${rootPath} is not a directory`);
      const config = await this.loadRootConfig() || { roots: [] };
      const normalizedRoot = normalizePath(rootPath);
      if (config.roots.some(candidate => normalizePath(candidate) === normalizedRoot)) return;
      config.roots.push(normalizedRoot);
      await this.saveRootConfig(config);
      await DialogUtils.showSuccess(`Saved ${rootPath} to configuration`);
    } catch (error) {
      this.logError(`Failed to add root ${rootPath}`, error);
    }
  }

  async removeRoot(rootPath: string): Promise<void> {
    try {
      const config = await this.loadRootConfig();
      if (!config) return;
      const normalizedRoot = normalizePath(rootPath);
      const index = config.roots.findIndex(candidate => normalizePath(candidate) === normalizedRoot);
      if (index === -1) return;
      config.roots.splice(index, 1);
      if (config.rootConfigs) {
        for (const configuredPath of Object.keys(config.rootConfigs)) {
          if (normalizePath(configuredPath) === normalizedRoot) delete config.rootConfigs[configuredPath];
        }
      }
      await this.saveRootConfig(config);
    } catch (error) {
      this.logError(`Failed to remove root ${rootPath}`, error);
    }
  }

  async hasConfiguredRoots(): Promise<boolean> {
    const config = await this.loadRootConfig();
    return !!config?.roots.length;
  }

  async changeConfigFile(): Promise<boolean> {
    try {
      const configPath = await this.selectOrCreateConfigPath();
      if (!configPath) return false;
      await this.setConfigPath(configPath);
      if (!await this.repository.exists(configPath)) await this.repository.write(configPath, { roots: [] });
      await DialogUtils.showSuccess(`Changed configuration to ${configPath}`);
      return true;
    } catch (error) {
      this.logError('Failed to change configuration file', error);
      return false;
    }
  }
}
