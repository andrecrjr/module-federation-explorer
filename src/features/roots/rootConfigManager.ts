import type { AsyncFileSystemPort, DialogService, Logger, PathPort, StoragePort, WorkspacePort } from '../../app/ports';
import type { UnifiedRootConfig } from './types';
import { migrateLegacyRootConfig, parseRootConfig } from './rootConfigSchema';
import type { RootConfigRepository } from '../../infrastructure/node/rootConfigRepository';
import { normalizePath } from '../../infrastructure/node/pathUtils';

export interface RootConfigManagerDependencies {
  storage: StoragePort;
  workspace: WorkspacePort;
  fileSystem: AsyncFileSystemPort;
  path: PathPort;
  dialogs: DialogService;
  logger: Logger;
  repository: RootConfigRepository;
}

/** User-facing root configuration workflow backed by ports and a JSON repository. */
export class RootConfigManager {
  static readonly CONFIG_FILENAME = 'mf-explorer.json';
  static readonly LEGACY_CONFIG_FILENAME = 'mf-explorer.roots.json';
  private static readonly CONFIG_DIR = '.vscode';

  constructor(private readonly dependencies: RootConfigManagerDependencies) {}

  private log(message: string): void {
    this.dependencies.logger.log(`[${new Date().toISOString()}] ${message}`);
  }

  private logError(message: string, error: unknown): void {
    const details = error instanceof Error ? error.stack || error.message : String(error);
    this.dependencies.logger.logError(`[${new Date().toISOString()}] ${message}`, details);
    void this.dependencies.dialogs.showError(message, {
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  getConfigPath(): string | undefined {
    const configured = this.dependencies.storage.get<string>('mf-explorer.configPath');
    if (configured) return configured;
    const workspaceFolder = this.dependencies.workspace.folders[0];
    return workspaceFolder
      ? this.dependencies.path.join(
          workspaceFolder.path,
          RootConfigManager.CONFIG_DIR,
          RootConfigManager.CONFIG_FILENAME
        )
      : undefined;
  }

  private getWorkspaceConfigPath(fileName: string): string | undefined {
    const workspaceFolder = this.dependencies.workspace.folders[0];
    return workspaceFolder
      ? this.dependencies.path.join(workspaceFolder.path, RootConfigManager.CONFIG_DIR, fileName)
      : undefined;
  }

  async setConfigPath(configPath: string): Promise<void> {
    await this.dependencies.storage.update('mf-explorer.configPath', configPath);
    this.log(`Set configuration path to: ${configPath}`);
  }

  async findExistingConfigs(): Promise<string[]> {
    const paths: string[] = [];
    for (const folder of this.dependencies.workspace.folders) {
      const directory = this.dependencies.path.join(folder.path, RootConfigManager.CONFIG_DIR);
      try {
        const entries = await this.dependencies.fileSystem.readDirectory(directory);
        paths.push(
          ...entries.filter(file => file.endsWith('.json')).map(file => this.dependencies.path.join(directory, file))
        );
      } catch {
        // Missing .vscode directory is expected.
      }
    }
    return paths;
  }

  async selectOrCreateConfigPath(): Promise<string | undefined> {
    const existing = await this.findExistingConfigs();
    const options = [
      { label: '$(add) Create new configuration', description: 'Create a new configuration file' },
      ...existing.map(configPath => ({
        label: `$(file) ${this.dependencies.path.basename(configPath)}`,
        description: this.dependencies.workspace.asRelativePath(configPath)
      })),
      { label: '$(folder) Browse...', description: 'Select a configuration file from the file system' }
    ];
    const selected = await this.dependencies.dialogs.showQuickPick(options, {
      title: 'Module Federation Configuration',
      placeholder: 'Select an existing configuration or create a new one'
    });
    if (!selected || Array.isArray(selected)) return undefined;
    if (selected.label === '$(add) Create new configuration') return this.createNewConfigPath();
    if (selected.label === '$(folder) Browse...') return this.dependencies.workspace.showOpenFile();
    return existing.find(configPath => this.dependencies.workspace.asRelativePath(configPath) === selected.description);
  }

  private async createNewConfigPath(): Promise<string | undefined> {
    const workspaceFolders = this.dependencies.workspace.folders;
    if (workspaceFolders.length === 0) {
      await this.dependencies.dialogs.showError('No workspace folder is open');
      return undefined;
    }

    let target = workspaceFolders[0].path;
    if (workspaceFolders.length > 1) {
      const selected = await this.dependencies.dialogs.showQuickPick(
        workspaceFolders.map(folder => ({ label: folder.name, description: folder.path })),
        {
          title: 'Create Module Federation Configuration',
          placeholder: 'Select a workspace folder for the configuration'
        }
      );
      if (!selected || Array.isArray(selected)) return undefined;
      const folder = workspaceFolders.find(candidate => candidate.name === selected.label);
      if (!folder) return undefined;
      target = folder.path;
    }

    const fileName = await this.dependencies.dialogs.showInput({
      title: 'Configuration File Name',
      prompt: 'Enter a name for your Module Federation configuration file',
      value: RootConfigManager.CONFIG_FILENAME,
      placeholder: 'Example: mf-explorer.json'
    });
    if (!fileName) return undefined;
    return this.dependencies.path.join(
      target,
      RootConfigManager.CONFIG_DIR,
      fileName.endsWith('.json') ? fileName : `${fileName}.json`
    );
  }

  async loadRootConfig(): Promise<UnifiedRootConfig | null> {
    const configPath = this.getConfigPath();
    if (!configPath) return null;
    const configuredPath = this.dependencies.storage.get<string>('mf-explorer.configPath');
    let sourcePath = configPath;
    let shouldMigrateToDefault = false;
    if (!configuredPath && !(await this.dependencies.repository.exists(configPath))) {
      const legacyPath = this.getWorkspaceConfigPath(RootConfigManager.LEGACY_CONFIG_FILENAME);
      if (legacyPath && (await this.dependencies.repository.exists(legacyPath))) {
        sourcePath = legacyPath;
        shouldMigrateToDefault = true;
      }
    }
    if (!(await this.dependencies.repository.exists(sourcePath))) return { roots: [] };
    try {
      const parsed = await this.dependencies.repository.read(sourcePath);
      const config = parseRootConfig(parsed);
      if (config) {
        if (shouldMigrateToDefault) await this.dependencies.repository.write(configPath, config);
        return config;
      }
      const migrated = migrateLegacyRootConfig(parsed);
      if (migrated) {
        if (shouldMigrateToDefault) {
          await this.dependencies.repository.write(configPath, migrated);
        } else {
          await this.saveRootConfig(migrated);
        }
        return migrated;
      }
      this.log(`Configuration file has unsupported format at ${sourcePath}`);
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
      await this.dependencies.repository.write(configPath, config);
      this.log(`Saved root configuration with ${config.roots.length} roots to ${configPath}`);
    } catch (error) {
      this.logError('Failed to save root configuration', error);
    }
  }

  async addRoot(rootPath: string): Promise<void> {
    try {
      if (!(await this.dependencies.fileSystem.isDirectory(rootPath))) {
        throw new Error(`${rootPath} is not a directory`);
      }
      const config = (await this.loadRootConfig()) || { roots: [] };
      const normalizedRoot = normalizePath(rootPath);
      if (config.roots.some(candidate => normalizePath(candidate) === normalizedRoot)) return;
      config.roots.push(normalizedRoot);
      await this.saveRootConfig(config);
      await this.dependencies.dialogs.showSuccess(`Saved ${rootPath} to configuration`);
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
      if (!(await this.dependencies.repository.exists(configPath))) {
        await this.dependencies.repository.write(configPath, { roots: [] });
      }
      await this.dependencies.dialogs.showSuccess(`Changed configuration to ${configPath}`);
      return true;
    } catch (error) {
      this.logError('Failed to change configuration file', error);
      return false;
    }
  }
}
