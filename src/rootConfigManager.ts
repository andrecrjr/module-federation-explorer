import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { UnifiedRootConfig, FederationRoot } from './types';
import { outputChannel } from './outputChannel';

/**
 * Manages the unified root configuration
 */
export class RootConfigManager {
  private static CONFIG_FILENAME = 'mf-explorer.roots.json';
  private static CONFIG_DIR = '.vscode';

  constructor(private readonly context: vscode.ExtensionContext) {
    // Removed the creation of a separate output channel
  }

  /**
   * Log a message to the output channel
   */
  private log(message: string): void {
    const timestamp = new Date().toISOString();
    outputChannel.appendLine(`[${timestamp}] ${message}`);
  }

  /**
   * Log an error message to the output channel
   */
  private logError(message: string, error: unknown): void {
    const errorDetails = error instanceof Error ? error.stack || error.message : String(error);
    const timestamp = new Date().toISOString();
    outputChannel.appendLine(`[${timestamp}] ERROR: ${message}:\n${errorDetails}`);
    console.error(`[Module Federation Roots] ${message}:\n`, errorDetails);
    vscode.window.showErrorMessage(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  }

  /**
   * Get the path to the unified root configuration file
   */
  getConfigPath(): string | undefined {
    const configPath = this.context.workspaceState.get<string>('mf-explorer.configPath');
    if (configPath) {
      return configPath;
    }

    // No longer automatically returning a default path
    return undefined;
  }

  /**
   * Set the configuration path
   */
  async setConfigPath(configPath: string): Promise<void> {
    await this.context.workspaceState.update('mf-explorer.configPath', configPath);
    this.log(`Set configuration path to: ${configPath}`);
  }

  /**
   * Ensures the config directory exists
   */
  private async ensureConfigDir(configDir: string): Promise<void> {
    try {
      await fsPromises.access(configDir);
    } catch {
      // Directory doesn't exist, create it
      await fsPromises.mkdir(configDir, { recursive: true });
    }
  }

  /**
   * Find existing .vscode configuration files in the workspace
   */
  async findExistingConfigs(): Promise<string[]> {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        return [];
      }

      const configPaths: string[] = [];

      for (const folder of workspaceFolders) {
        const vscodeDir = path.join(folder.uri.fsPath, '.vscode');
        try {
          const stat = await fsPromises.stat(vscodeDir);
          if (stat.isDirectory()) {
            const files = await fsPromises.readdir(vscodeDir);
            // Look for JSON files that might be configuration files
            for (const file of files) {
              if (file.endsWith('.json')) {
                configPaths.push(path.join(vscodeDir, file));
              }
            }
          }
        } catch (error) {
          // Directory doesn't exist or can't be accessed, skip
          continue;
        }
      }

      return configPaths;
    } catch (error) {
      this.logError('Failed to find existing configurations', error);
      return [];
    }
  }

  /**
   * Prompt the user to select an existing configuration or create a new one
   */
  async selectOrCreateConfigPath(): Promise<string | undefined> {
    try {
      // Find existing configurations
      const existingConfigs = await this.findExistingConfigs();
      
      // Filter to only show JSON files in .vscode folders
      const configOptions: vscode.QuickPickItem[] = [
        { label: '$(add) Create new configuration', description: 'Create a new configuration file' }
      ];
      
      // Add existing configuration files
      for (const configPath of existingConfigs) {
        const relativePath = vscode.workspace.asRelativePath(configPath);
        configOptions.push({
          label: `$(file) ${path.basename(configPath)}`,
          description: relativePath
        });
      }
      
      // Allow user to browse for a configuration file
      configOptions.push({ 
        label: '$(folder) Browse...',
        description: 'Select a configuration file from the file system'
      });
      
      // Show quick pick to select a configuration
      const selected = await vscode.window.showQuickPick(configOptions, {
        placeHolder: 'Select an existing configuration or create a new one',
        title: 'Module Federation Configuration'
      });
      
      if (!selected) {
        return undefined;
      }
      
      // Handle the selection
      if (selected.label === '$(add) Create new configuration') {
        // Create a new configuration
        return await this.createNewConfigPath();
      } else if (selected.label === '$(folder) Browse...') {
        // Browse for a configuration file
        const selectedUris = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: {
            'JSON files': ['json']
          },
          title: 'Select configuration file'
        });
        
        if (!selectedUris || selectedUris.length === 0) {
          return undefined;
        }
        
        return selectedUris[0].fsPath;
      } else {
        // User selected an existing configuration
        for (const configPath of existingConfigs) {
          const relativePath = vscode.workspace.asRelativePath(configPath);
          if (selected.description === relativePath) {
            return configPath;
          }
        }
      }
      
      return undefined;
    } catch (error) {
      this.logError('Failed to select or create configuration path', error);
      return undefined;
    }
  }

  /**
   * Create a new configuration file path
   */
  private async createNewConfigPath(): Promise<string | undefined> {
    try {
      // Let the user select where to create the configuration file
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder is open');
        return undefined;
      }
      
      let targetFolder: vscode.Uri | undefined;
      
      if (workspaceFolders.length === 1) {
        targetFolder = workspaceFolders[0].uri;
      } else {
        // Multiple workspace folders, ask the user which one to use
        const folderOptions = workspaceFolders.map(folder => ({
          label: folder.name,
          description: folder.uri.fsPath
        }));
        
        const selectedFolder = await vscode.window.showQuickPick(folderOptions, {
          placeHolder: 'Select a workspace folder',
          title: 'Create Configuration'
        });
        
        if (!selectedFolder) {
          return undefined;
        }
        
        targetFolder = workspaceFolders.find(folder => folder.name === selectedFolder.label)?.uri;
      }
      
      if (!targetFolder) {
        return undefined;
      }
      
      // Create the configuration file path
      const vscodeDir = path.join(targetFolder.fsPath, '.vscode');
      await this.ensureConfigDir(vscodeDir);
      
      // Let user enter a custom file name
      const defaultFileName = RootConfigManager.CONFIG_FILENAME;
      const fileName = await vscode.window.showInputBox({
        prompt: 'Enter the configuration file name',
        value: defaultFileName,
        title: 'Configuration File Name'
      });
      
      if (!fileName) {
        return undefined;
      }
      
      // Ensure the file has .json extension
      const configFileName = fileName.endsWith('.json') ? fileName : `${fileName}.json`;
      const configPath = path.join(vscodeDir, configFileName);
      
      // Check if the file already exists
      try {
        await fsPromises.access(configPath);
        const overwrite = await vscode.window.showWarningMessage(
          `File ${configFileName} already exists. Overwrite?`,
          { modal: true },
          'Yes', 'No'
        );
        
        if (overwrite !== 'Yes') {
          return undefined;
        }
      } catch {
        // File doesn't exist, which is fine
      }
      
      return configPath;
    } catch (error) {
      this.logError('Failed to create new configuration path', error);
      return undefined;
    }
  }

  /**
   * Load the unified root configuration
   */
  async loadRootConfig(): Promise<UnifiedRootConfig> {
    try {
      const configPath = this.getConfigPath();
      
      if (!configPath) {
        // No config path set, just return an empty config
        return { roots: [] };
      }

      try {
        // Check if the file exists
        await fsPromises.access(configPath);
        
        // Read the file content
        const configContent = await fsPromises.readFile(configPath, 'utf-8');
        
        try {
          // Parse the JSON content
          const config = JSON.parse(configContent) as UnifiedRootConfig;
          
          // Validate the config structure
          if (!config.roots || !Array.isArray(config.roots)) {
            // Invalid structure, return empty config
            this.log('Configuration file has incorrect format, returning empty config');
            return { roots: [] };
          }
          
          this.log(`Loaded root config with ${config.roots.length} roots from ${configPath}`);
          return config;
        } catch (parseError) {
          // Failed to parse, return empty config
          this.logError('Failed to parse configuration file', parseError);
          return { roots: [] };
        }
      } catch (error) {
        // File doesn't exist, return empty config
        this.log(`Configuration file not found at ${configPath}`);
        return { roots: [] };
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
  private async createInitialConfig(configPath?: string): Promise<UnifiedRootConfig> {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        return { roots: [] };
      }

      // Ask the user if they want to use the current workspace folder or select a different one
      const choice = await vscode.window.showQuickPick(
        [
          { 
            label: `Use current workspace folder (${workspaceFolder.name})`, 
            description: workspaceFolder.uri.fsPath 
          },
          { 
            label: 'Select a different folder', 
            description: 'Browse for a specific Module Federation project folder' 
          },
          {
            label: 'Start with empty configuration', 
            description: 'No roots will be added initially'
          }
        ],
        { 
          placeHolder: 'Choose initial Module Federation configuration', 
          title: 'Module Federation Configuration' 
        }
      );

      if (!choice) {
        return { roots: [] }; // User cancelled
      }

      let config: UnifiedRootConfig;

      if (choice.label.startsWith('Use current workspace')) {
        // Use the current workspace folder as the initial root
        config = {
          roots: [workspaceFolder.uri.fsPath]
        };
      } else if (choice.label.startsWith('Select a different')) {
        // Let the user select a folder
        const selectedFolder = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          title: 'Select Module Federation Project Folder'
        });

        if (!selectedFolder || selectedFolder.length === 0) {
          // User cancelled folder selection
          return { roots: [] };
        }

        config = {
          roots: [selectedFolder[0].fsPath]
        };
      } else {
        // Start with empty configuration
        config = { roots: [] };
      }

      // If configPath is provided, use it, otherwise use the default
      if (!configPath) {
        configPath = path.join(workspaceFolder.uri.fsPath, RootConfigManager.CONFIG_DIR, RootConfigManager.CONFIG_FILENAME);
      }
      
      // Save the configuration to the specified path
      await this.ensureConfigDir(path.dirname(configPath));
      await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
      
      // Save the path for future use
      await this.setConfigPath(configPath);
      
      this.log(`Created initial root configuration at ${configPath}`);
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
        throw new Error('No configuration path found');
      }

      await this.ensureConfigDir(path.dirname(configPath));
      await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
      this.log(`Saved root configuration with ${config.roots.length} roots to ${configPath}`);
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
      
      // Also remove the rootPath entry from rootConfigs if it exists
      if (config.rootConfigs && config.rootConfigs[rootPath]) {
        delete config.rootConfigs[rootPath];
        this.log(`Removed rootConfig entry for ${rootPath}`);
      }
      
      await this.saveRootConfig(config);
      
      vscode.window.showInformationMessage(`Removed root ${rootPath} from configuration`);
    } catch (error) {
      this.logError(`Failed to remove root ${rootPath}`, error);
    }
  }

  /**
   * Change to a different configuration file
   */
  async changeConfigFile(): Promise<boolean> {
    try {
      const configPath = await this.selectOrCreateConfigPath();
      
      if (!configPath) {
        return false;
      }
      
      await this.setConfigPath(configPath);
      
      // Try to load the configuration
      try {
        await fsPromises.access(configPath);
      } catch {
        // File doesn't exist, create a new one
        await this.createInitialConfig(configPath);
      }
      
      vscode.window.showInformationMessage(`Changed configuration to ${configPath}`);
      return true;
    } catch (error) {
      this.logError('Failed to change configuration file', error);
      return false;
    }
  }
} 