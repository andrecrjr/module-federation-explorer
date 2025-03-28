import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { UnifiedRootConfig, FederationRoot } from './types';

/**
 * Manages the unified root configuration
 */
export class RootConfigManager {
  private outputChannel: vscode.OutputChannel;
  private static CONFIG_FILENAME = 'mf-explorer.roots.json';
  private static CONFIG_DIR = '.vscode';

  constructor(private readonly context: vscode.ExtensionContext) {
    this.outputChannel = vscode.window.createOutputChannel('Module Federation Roots');
  }

  /**
   * Log a message to the output channel
   */
  private log(message: string): void {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] ${message}`);
  }

  /**
   * Log an error message to the output channel
   */
  private logError(message: string, error: unknown): void {
    const errorDetails = error instanceof Error ? error.stack || error.message : String(error);
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] ERROR: ${message}:\n${errorDetails}`);
    console.error(`[Module Federation Roots] ${message}:\n`, errorDetails);
    vscode.window.showErrorMessage(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  }

  /**
   * Get the path to the unified root configuration file
   */
  private getConfigPath(): string | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return undefined;
    }
    return path.join(workspaceFolder.uri.fsPath, RootConfigManager.CONFIG_DIR, RootConfigManager.CONFIG_FILENAME);
  }

  /**
   * Ensures the config directory exists
   */
  private async ensureConfigDir(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder found');
    }
    
    const configDir = path.join(workspaceFolder.uri.fsPath, RootConfigManager.CONFIG_DIR);
    
    try {
      await fsPromises.access(configDir);
    } catch {
      // Directory doesn't exist, create it
      await fsPromises.mkdir(configDir, { recursive: true });
    }
  }

  /**
   * Load the unified root configuration
   */
  async loadRootConfig(): Promise<UnifiedRootConfig> {
    try {
      const configPath = this.getConfigPath();
      if (!configPath) {
        this.log('No workspace folder found, creating default config');
        return await this.createInitialConfig();
      }

      try {
        await fsPromises.access(configPath);
        const configContent = await fsPromises.readFile(configPath, 'utf-8');
        const config = JSON.parse(configContent) as UnifiedRootConfig;
        
        // Validate the config structure
        if (!config.roots || !Array.isArray(config.roots)) {
          this.log('Invalid config format, creating default config');
          return await this.createInitialConfig();
        }
        
        this.log(`Loaded root config with ${config.roots.length} roots`);
        return config;
      } catch (error) {
        // File doesn't exist or is invalid, create initial config
        this.log('Configuration file not found or invalid, creating default config');
        return await this.createInitialConfig();
      }
    } catch (error) {
      this.logError('Failed to load root configuration', error);
      // Return empty config as fallback
      return { roots: [] };
    }
  }

  /**
   * Create the initial root configuration
   */
  private async createInitialConfig(): Promise<UnifiedRootConfig> {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        return { roots: [] };
      }

      // Use the current workspace folder as the initial root
      const config: UnifiedRootConfig = {
        roots: [workspaceFolder.uri.fsPath]
      };

      await this.saveRootConfig(config);
      this.log('Created initial root configuration');
      return config;
    } catch (error) {
      this.logError('Failed to create initial configuration', error);
      return { roots: [] };
    }
  }

  /**
   * Save the unified root configuration
   */
  async saveRootConfig(config: UnifiedRootConfig): Promise<void> {
    try {
      const configPath = this.getConfigPath();
      if (!configPath) {
        throw new Error('No workspace folder found');
      }

      await this.ensureConfigDir();
      await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
      this.log(`Saved root configuration with ${config.roots.length} roots`);
    } catch (error) {
      this.logError('Failed to save root configuration', error);
    }
  }

  /**
   * Add a new root to the configuration
   */
  async addRoot(rootPath: string): Promise<void> {
    try {
      // Check if the path exists and is a directory
      const stats = await fsPromises.stat(rootPath);
      if (!stats.isDirectory()) {
        throw new Error(`${rootPath} is not a directory`);
      }

      const config = await this.loadRootConfig();
      
      // Check if the root already exists
      if (config.roots.includes(rootPath)) {
        this.log(`Root ${rootPath} already exists in configuration`);
        return;
      }

      config.roots.push(rootPath);
      await this.saveRootConfig(config);
      
      vscode.window.showInformationMessage(`Added root ${rootPath} to configuration`);
    } catch (error) {
      this.logError(`Failed to add root ${rootPath}`, error);
    }
  }

  /**
   * Remove a root from the configuration
   */
  async removeRoot(rootPath: string): Promise<void> {
    try {
      const config = await this.loadRootConfig();
      const index = config.roots.indexOf(rootPath);
      
      if (index === -1) {
        this.log(`Root ${rootPath} not found in configuration`);
        return;
      }

      config.roots.splice(index, 1);
      await this.saveRootConfig(config);
      
      vscode.window.showInformationMessage(`Removed root ${rootPath} from configuration`);
    } catch (error) {
      this.logError(`Failed to remove root ${rootPath}`, error);
    }
  }
} 