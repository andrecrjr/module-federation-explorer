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

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return undefined;
    }
    return path.join(workspaceFolder.uri.fsPath, RootConfigManager.CONFIG_DIR, RootConfigManager.CONFIG_FILENAME);
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
          title: 'Select Module Federation Explorer Configuration File',
          openLabel: 'Select Configuration'
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
          placeHolder: 'Select a workspace folder for the configuration',
          title: 'Create Module Federation Configuration'
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
        prompt: 'Enter a name for your Module Federation configuration file',
        value: defaultFileName,
        title: 'Configuration File Name',
        placeHolder: 'Example: mf-explorer.roots.json'
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
  async loadRootConfig(): Promise<UnifiedRootConfig | null> {
    try {
      let configPath = this.getConfigPath();
      
      // If no configuration path is set, return null
      // User will need to explicitly set up configuration using changeConfigFile
      if (!configPath) {
        this.log('No configuration path set yet. User needs to configure settings first.');
        return null;
      }

      try {
        await fsPromises.access(configPath);
        const configContent = await fsPromises.readFile(configPath, 'utf-8');
        let config: UnifiedRootConfig;
        
        try {
          config = JSON.parse(configContent) as UnifiedRootConfig;
          
          // Validate the config structure
          if (!config.roots || !Array.isArray(config.roots)) {
            // Try to convert the file to the expected format
            this.log('Configuration file has incorrect format, attempting to convert');
            
            // Create a proper config with the loaded content as a root if possible
            try {
              const parsedContent = JSON.parse(configContent);
              
              // If it's an object with paths or roots, try to extract values
              if (typeof parsedContent === 'object') {
                const possibleRoots: string[] = [];
                
                // Check for common properties that might contain paths
                if (Array.isArray(parsedContent.roots)) {
                  possibleRoots.push(...parsedContent.roots);
                } else if (Array.isArray(parsedContent.paths)) {
                  possibleRoots.push(...parsedContent.paths);
                } else if (Array.isArray(parsedContent.directories)) {
                  possibleRoots.push(...parsedContent.directories);
                } else {
                  // Try to use the keys or values as paths
                  for (const key in parsedContent) {
                    if (typeof parsedContent[key] === 'string' && 
                        (parsedContent[key].includes('/') || parsedContent[key].includes('\\'))) {
                      possibleRoots.push(parsedContent[key]);
                    } else if (typeof key === 'string' && 
                               (key.includes('/') || key.includes('\\'))) {
                      possibleRoots.push(key);
                    }
                  }
                }
                
                if (possibleRoots.length > 0) {
                  config = { roots: possibleRoots };
                  this.log(`Converted configuration with ${possibleRoots.length} potential roots`);
                } else {
                  // Create an empty config
                  config = { roots: [] };
                }
              } else {
                config = { roots: [] };
              }
            } catch {
              config = { roots: [] };
            }
            
            // Save the converted configuration
            await this.saveRootConfig(config);
          }
          
          this.log(`Loaded root config with ${config.roots.length} roots from ${configPath}`);
          return config;
        } catch (parseError) {
          this.logError('Failed to parse configuration file, please remove the settings file and try again', parseError);
          // Return empty config instead of null
          return { roots: [] };
        }
      } catch (error) {
        // File doesn't exist or is invalid
        this.log(`Configuration file not found or invalid at ${configPath}`);
        // Return empty config instead of null
        return { roots: [] };
      }
    } catch (error) {
      this.logError('Failed to load root configuration', error);
      // Return empty config as fallback
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
      
      // Create a new config if none exists
      if (!config) {
        const newConfig: UnifiedRootConfig = { roots: [rootPath] };
        await this.saveRootConfig(newConfig);
        vscode.window.showInformationMessage(`Saved ${rootPath} to new configuration`);
        return;
      }
      
      // Check if the root already exists
      if (config.roots.includes(rootPath)) {
        this.log(`Root ${rootPath} already exists in configuration`);
        return;
      }

      config.roots.push(rootPath);
      await this.saveRootConfig(config);
      
      vscode.window.showInformationMessage(`Saved ${rootPath} to configuration`);
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
      
      if (!config) {
        this.log(`No configuration exists, cannot remove root ${rootPath}`);
        return;
      }
      
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
      
    } catch (error) {
      this.logError(`Failed to remove root ${rootPath}`, error);
    }
  }

  /**
   * Check if any root folders are configured
   */
  async hasConfiguredRoots(): Promise<boolean> {
    try {
      const config = await this.loadRootConfig();
      
      // If config is null, no roots are configured
      if (config === null) {
        return false;
      }
      
      // Check if we have any roots configured
      return config.roots && config.roots.length > 0;
    } catch (error) {
      this.logError('Failed to check for configured roots', error);
      return false;
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
        // File doesn't exist, create a new empty one
        await this.createEmptyConfig(configPath);
      }
      
      vscode.window.showInformationMessage(`Changed configuration to ${configPath}`);
      return true;
    } catch (error) {
      this.logError('Failed to change configuration file', error);
      return false;
    }
  }

  /**
   * Create an empty configuration file
   */
  private async createEmptyConfig(configPath: string): Promise<UnifiedRootConfig> {
    try {
      // Create an empty configuration
      const config: UnifiedRootConfig = {
        roots: []
      };
      
      // Save the configuration to the specified path
      await this.ensureConfigDir(path.dirname(configPath));
      await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
      
      this.log(`Created empty configuration file at ${configPath}`);
      return config;
    } catch (error) {
      this.logError('Failed to create empty configuration', error);
      return { roots: [] };
    }
  }
} 