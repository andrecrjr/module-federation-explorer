import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as fsSync from 'fs'; // Import for synchronous fs operations
import { 
    Remote, 
    ExposedModule, 
    ModuleFederationStatus, 
    ModuleFederationConfig,
    RemotesFolder,
    ExposesFolder,
    RootFolder,
    UnifiedRootConfig,
    FederationRoot
} from './types';
import { extractConfigFromWebpack, extractConfigFromVite } from './configExtractors';
import { RootConfigManager } from './rootConfigManager';
import { parse } from '@typescript-eslint/parser';

// Type guard functions to narrow down types
function isFederationRoot(element: any): element is FederationRoot {
  return element && element.type === 'federationRoot';
}

function isRootFolder(element: any): element is RootFolder {
  return element && element.type === 'rootFolder';
}

function isRemotesFolder(element: any): element is RemotesFolder {
  return element && element.type === 'remotesFolder';
}

function isExposesFolder(element: any): element is ExposesFolder {
  return element && element.type === 'exposesFolder';
}

function isExposedModule(element: any): element is ExposedModule {
  return element && 'remoteName' in element;
}

function isRemote(element: any): element is Remote {
  return element && 'name' in element && !('type' in element) && !('remoteName' in element);
}

export class UnifiedModuleFederationProvider implements vscode.TreeDataProvider<FederationRoot | RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule> {
  private _onDidChangeTreeData: vscode.EventEmitter<FederationRoot | RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | undefined> = 
    new vscode.EventEmitter<FederationRoot | RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | undefined>();
  
  readonly onDidChangeTreeData: vscode.Event<FederationRoot | RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | undefined> = 
    this._onDidChangeTreeData.event;
  
  private outputChannel: vscode.OutputChannel;
  private rootConfigs: Map<string, ModuleFederationConfig[]> = new Map();
  private rootConfigManager: RootConfigManager;
  private isLoading = false;
  private runningApps: Map<string, { terminal: vscode.Terminal; processId?: number }> = new Map();
  public runningRemotes: Map<string, { terminal: vscode.Terminal }> = new Map();
  // Store running root app information
  private runningRootApps: Map<string, { terminal: vscode.Terminal }> = new Map();
  
  constructor(private readonly workspaceRoot: string | undefined, private readonly context: vscode.ExtensionContext) {
    this.outputChannel = vscode.window.createOutputChannel('Module Federation Explorer');
    this.rootConfigManager = new RootConfigManager(context);
    this.log('Initializing Unified Module Federation Explorer...');
    this.loadConfigurations();
  }

  /**
   * Refreshes the tree view without reloading configurations
   */
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
  
  /**
   * Reloads configurations from disk and then refreshes the tree view
   */
  async reloadConfigurations(): Promise<void> {
    await this.loadConfigurations();
  }

  // Logger method for general logging
  log(message: string): void {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] ${message}`);
  }

  // Error logger method
  logError(message: string, error: unknown): void {
    const errorDetails = error instanceof Error ? error.stack || error.message : String(error);
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] ERROR: ${message}:\n${errorDetails}`);
    console.error(`[Module Federation] ${message}:\n`, errorDetails);
    vscode.window.showErrorMessage(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  }

  /**
   * Loads Module Federation configurations from all configured roots
   */
  private async loadConfigurations(): Promise<void> {
    if (this.isLoading) return;
    
    try {
      this.isLoading = true;
      this.rootConfigs.clear();
      
      // Load root configuration from settings
      const rootConfig = await this.rootConfigManager.loadRootConfig();
      if (!rootConfig.roots || rootConfig.roots.length === 0) {
        this.log('No roots configured. Configure at least one root directory.');
        return;
      }

      this.log(`Found ${rootConfig.roots.length} configured roots`);
      
      // Process each root
      for (const rootPath of rootConfig.roots) {
        await this.processRoot(rootPath);
      }

      // Load root folder configurations (start commands, etc.)
      await this.loadRootFolderConfigs();

      this.log('Finished loading configurations from all roots');
      this._onDidChangeTreeData.fire(undefined);
      
    } catch (error) {
      this.logError('Failed to load Module Federation configurations', error);
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Process a specific root directory to find and load MFE configurations
   */
  private async processRoot(rootPath: string): Promise<void> {
    try {
      this.log(`Processing root: ${rootPath}`);
      
      // Check if the directory exists
      try {
        const stats = await fs.stat(rootPath);
        if (!stats.isDirectory()) {
          this.logError(`Path is not a directory`, rootPath);
          return;
        }
      } catch (error) {
        this.logError(`Cannot access root directory`, rootPath);
        return;
      }

      // Find all webpack and vite config files in this root, excluding node_modules
      const webpackPattern = path.join(rootPath, '**', '{webpack.config.js,webpack.config.ts}');
      const vitePattern = path.join(rootPath, '**', '{vite.config.js,vite.config.ts}');
      const excludePattern = path.join(rootPath, '**', 'node_modules', '**');
      
      const [webpackFiles, viteFiles] = await Promise.all([
        this.findFiles(rootPath, '**/{webpack.config.js,webpack.config.ts}', '**/node_modules/**'),
        this.findFiles(rootPath, '**/{vite.config.js,vite.config.ts}', '**/node_modules/**')
      ]);

      this.log(`Found ${webpackFiles.length} webpack configs and ${viteFiles.length} vite configs in ${rootPath}`);

      // Process webpack configs
      const webpackConfigs = await this.processConfigFiles(
        webpackFiles, 
        extractConfigFromWebpack,
        'webpack',
        rootPath
      );
      
      // Process vite configs
      const viteConfigs = await this.processConfigFiles(
        viteFiles, 
        extractConfigFromVite,
        'vite',
        rootPath
      );
      
      // Store configs for this root
      const configs = [...webpackConfigs, ...viteConfigs];
      if (configs.length > 0) {
        this.rootConfigs.set(rootPath, configs);
        this.log(`Stored ${configs.length} configurations for root ${rootPath}`);
      } else {
        this.log(`No Module Federation configurations found in ${rootPath}`);
      }
    } catch (error) {
      this.logError(`Failed to process root ${rootPath}`, error);
    }
  }

  /**
   * Find files matching pattern in a directory
   */
  private async findFiles(rootPath: string, pattern: string, excludePattern: string): Promise<string[]> {
    try {
      // Create a glob pattern relative to the root path
      const relativePattern = new vscode.RelativePattern(rootPath, pattern);
      const files = await vscode.workspace.findFiles(relativePattern, excludePattern);
      return files.map(file => file.fsPath);
    } catch (error) {
      this.logError(`Failed to find files in ${rootPath} with pattern ${pattern}`, error);
      return [];
    }
  }

  /**
   * Process a list of config files with the provided extractor function
   */
  private async processConfigFiles(
    files: string[],
    extractor: (ast: any, workspaceRoot: string) => Promise<ModuleFederationConfig>,
    configType: string,
    rootPath: string
  ): Promise<ModuleFederationConfig[]> {
    const results: ModuleFederationConfig[] = [];
    
    for (const file of files) {
      try {
        this.log(`Processing ${configType} config: ${file}`);
        const content = await fs.readFile(file, 'utf8');
        const ast = parse(content, {
          sourceType: 'module',
          ecmaVersion: 'latest'
        });
        const config = await extractor(ast, rootPath);
        
        // Add the config source path
        const relativeConfigPath = path.relative(rootPath, file);
        results.push({
          ...config,
          configPath: file
        });
        
        // Add config source to remotes and exposes for tracking
        for (const remote of config.remotes) {
          remote.configSource = file;
        }
        
        for (const expose of config.exposes) {
          expose.configSource = file;
        }
      } catch (error) {
        this.logError(`Error processing ${file}`, error);
      }
    }
    
    return results;
  }

  getTreeItem(element: FederationRoot | RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule): vscode.TreeItem {
    if (isFederationRoot(element)) {
      // This is the root node
      const treeItem = new vscode.TreeItem(
        'Federation Explorer',
        vscode.TreeItemCollapsibleState.Expanded
      );
      
      treeItem.tooltip = 'Module Federation Explorer Root';
      treeItem.contextValue = 'federationRoot';
      treeItem.iconPath = new vscode.ThemeIcon('server-environment');
      
      return treeItem;
    } else if (isRootFolder(element)) {
      // This is a root folder node
      const name = path.basename(element.path);
      const treeItem = new vscode.TreeItem(
        name,
        vscode.TreeItemCollapsibleState.Expanded
      );
      
      // Check if this root app is running
      const isRunning = this.isRootAppRunning(element.path);
      
      treeItem.description = element.path;
      if (isRunning) {
        treeItem.description += ' (Running)';
      }
      
      let tooltip = `Root Folder: ${element.path}\nConfigurations: ${element.configs.length}`;
      if (element.startCommand) {
        tooltip += `\nStart Command: ${element.startCommand}`;
        tooltip += `\nStatus: ${isRunning ? 'Running' : 'Stopped'}`;
      } else {
        tooltip += '\nStart Command: Not configured';
      }
      
      treeItem.tooltip = tooltip;
      
      // Update context value based on whether it's running and has a start command
      const hasStartCommand = !!element.startCommand;
      if (isRunning) {
        treeItem.contextValue = 'runningRootApp';
      } else if (hasStartCommand) {
        treeItem.contextValue = 'configurableRootApp';
      } else {
        treeItem.contextValue = 'rootFolder';
      }
      
      // Update icon based on status
      treeItem.iconPath = new vscode.ThemeIcon(
        isRunning ? 'play-circle' : 'folder'
      );
      
      return treeItem;
    } else if (isRemotesFolder(element)) {
      // This is a RemotesFolder
      const treeItem = new vscode.TreeItem(
        'Remotes',
        vscode.TreeItemCollapsibleState.Expanded
      );
      treeItem.iconPath = new vscode.ThemeIcon('remote');
      treeItem.contextValue = 'remotesFolder';
      treeItem.description = `(${element.remotes.length})`;
      return treeItem;
    } else if (isExposesFolder(element)) {
      // This is an ExposesFolder
      const treeItem = new vscode.TreeItem(
        'Exposes',
        vscode.TreeItemCollapsibleState.Expanded
      );
      treeItem.iconPath = new vscode.ThemeIcon('symbol-module');
      treeItem.contextValue = 'exposesFolder';
      treeItem.description = `(${element.exposes.length})`;
      return treeItem;
    } else if (isExposedModule(element)) {
      // This is an ExposedModule
      const treeItem = new vscode.TreeItem(
        element.name,
        vscode.TreeItemCollapsibleState.None
      );
      
      treeItem.description = element.path;
      treeItem.tooltip = `Exposed Module: ${element.name}\nPath: ${element.path}\nRemote: ${element.remoteName}`;
      treeItem.iconPath = new vscode.ThemeIcon('symbol-module');
      treeItem.contextValue = 'exposedModule';
      return treeItem;
    } else if (isRemote(element)) {
      // This is a Remote
      const treeItem = new vscode.TreeItem(
        element.name, 
        vscode.TreeItemCollapsibleState.Collapsed
      );
      
      // Check if this remote is running
      const remoteKey = `remote-${element.name}`;
      const isRunning = this.getRunningRemoteTerminal(remoteKey) !== undefined;
      
      // Check if the folder is configured
      const isFolderConfigured = !!element.folder;
      
      treeItem.description = element.folder 
        ? `${element.url || ''} ${isRunning ? '(Running)' : ''}` 
        : 'Not configured - click to set up';
        
      treeItem.tooltip = `Remote: ${element.name}\n` +
        `URL: ${element.url || 'Not specified'}\n` +
        `Folder: ${element.folder || 'Not configured'}\n` +
        `Status: ${isRunning ? 'Running' : (isFolderConfigured ? 'Stopped' : 'Not configured')}`;
        
      treeItem.iconPath = new vscode.ThemeIcon(
        isRunning ? 'play-circle' : (isFolderConfigured ? 'server' : 'warning')
      );
      
      treeItem.contextValue = isRunning 
        ? 'runningRemote' 
        : (isFolderConfigured ? 'remote' : 'unconfiguredRemote');
      
      // Add command to start/stop or configure the remote based on current status
      treeItem.command = {
        command: isRunning 
          ? 'moduleFederation.stopRemote' 
          : 'moduleFederation.startRemote',
        title: isRunning 
          ? `Stop ${element.name}` 
          : (isFolderConfigured 
              ? `Start ${element.name} (${element.packageManager || 'npm'})` 
              : `Configure ${element.name}`),
        arguments: [element]
      };
      
      return treeItem;
    } else {
      throw new Error('Unknown element type');
    }
  }

  getChildren(element?: FederationRoot | RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule): Thenable<(FederationRoot | RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule)[]> {
    if (!element) {
      // Root level - create a federation root node
      const fedRoot: FederationRoot = {
        type: 'federationRoot',
        path: '',
        name: 'Federation Explorer',
        configs: []
      };
      return Promise.resolve([fedRoot]);
    } else if (isFederationRoot(element)) {
      // Return all configured root folders
      return this.getRootFolders();
    } else if (isRootFolder(element)) {
      // Show remotes folder and exposes folder for this root
      const children: (RemotesFolder | ExposesFolder)[] = [];
      
      // Collect all remotes and exposes from this root's configs
      const allRemotes = element.configs.flatMap(config => config.remotes);
      const allExposes = element.configs.flatMap(config => config.exposes);
      
      // Add remotes folder if there are remotes
      if (allRemotes.length > 0) {
        children.push({
          type: 'remotesFolder',
          parentName: element.name,
          remotes: allRemotes
        });
      }
      
      // Add exposes folder if there are exposes
      if (allExposes.length > 0) {
        children.push({
          type: 'exposesFolder',
          parentName: element.name,
          exposes: allExposes
        });
      }
      
      return Promise.resolve(children);
    } else if (isRemotesFolder(element)) {
      // RemotesFolder node - show all remotes
      return Promise.resolve(element.remotes);
    } else if (isExposesFolder(element)) {
      // ExposesFolder node - show all exposes
      return Promise.resolve(element.exposes);
    } else if (isExposedModule(element)) {
      // ExposedModule node - no children
      return Promise.resolve([]);
    } else if (isRemote(element)) {
      // Remote node - show its exposes
      // Find the config that contains this remote
      let exposedModules: ExposedModule[] = [];
      
      for (const [rootPath, configs] of this.rootConfigs.entries()) {
        for (const config of configs) {
          if (config.remotes.some(r => r.name === element.name)) {
            // Find exposed modules for this remote
            const exposes = config.exposes.filter(e => e.remoteName === element.name);
            exposedModules = [...exposedModules, ...exposes];
          }
        }
      }
      
      return Promise.resolve(exposedModules);
    } else {
      return Promise.resolve([]);
    }
  }

  /**
   * Get root folders with their configurations
   */
  private async getRootFolders(): Promise<RootFolder[]> {
    const rootFolders: RootFolder[] = [];
    
    // Get the root configuration
    const config = await this.rootConfigManager.loadRootConfig();
    
    for (const [rootPath, configs] of this.rootConfigs.entries()) {
      const rootConfig = config.rootConfigs?.[rootPath];
      
      rootFolders.push({
        type: 'rootFolder',
        path: rootPath,
        name: path.basename(rootPath),
        configs: configs,
        startCommand: rootConfig?.startCommand,
        isRunning: this.isRootAppRunning(rootPath)
      });
    }
    
    return rootFolders;
  }

  /**
   * Get terminal for a running remote
   */
  getRunningRemoteTerminal(remoteKey: string): vscode.Terminal | undefined {
    const runningRemote = this.runningRemotes.get(remoteKey);
    
    // Check if the terminal is still valid (not disposed)
    if (runningRemote) {
      try {
        // Try to reference the terminal - if it's disposed, this will throw an error
        const disposedCheck = runningRemote.terminal.processId;
        return runningRemote.terminal;
      } catch (error) {
        // Terminal was disposed externally, clean up our reference
        this.runningRemotes.delete(remoteKey);
        return undefined;
      }
    }
    
    return undefined;
  }
  
  /**
   * Set a remote as running
   */
  setRunningRemote(remoteKey: string, terminal: vscode.Terminal): void {
    this.runningRemotes.set(remoteKey, { terminal });
    this._onDidChangeTreeData.fire(undefined);
  }
  
  /**
   * Stop a running remote
   */
  stopRemote(remoteKey: string): void {
    const runningRemote = this.runningRemotes.get(remoteKey);
    if (runningRemote) {
      runningRemote.terminal.dispose();
      this.runningRemotes.delete(remoteKey);
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  /**
   * Add a new root to the configuration
   */
  async addRoot(): Promise<void> {
    try {
      const selectedFolder = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Root Folder',
        title: 'Select a folder to add to the Module Federation Explorer'
      });

      if (!selectedFolder || selectedFolder.length === 0) {
        return;
      }

      const rootPath = selectedFolder[0].fsPath;
      await this.rootConfigManager.addRoot(rootPath);
      
      // Process the new root
      await this.processRoot(rootPath);
      
      // Refresh the tree view
      this._onDidChangeTreeData.fire(undefined);
      
      vscode.window.showInformationMessage(`Added root ${rootPath} to configuration`);
    } catch (error) {
      this.logError('Failed to add root', error);
    }
  }

  /**
   * Remove a root from the configuration
   */
  async removeRoot(rootFolder: RootFolder): Promise<void> {
    try {
      const rootPath = rootFolder.path;
      
      // Confirm with user
      const confirmed = await vscode.window.showWarningMessage(
        `Are you sure you want to remove "${rootPath}" from the configuration?`,
        { modal: true },
        'Yes'
      );
      
      if (!confirmed) {
        return;
      }

      await this.rootConfigManager.removeRoot(rootPath);
      
      // Remove from our local map
      this.rootConfigs.delete(rootPath);
      
      // Refresh the tree view
      this._onDidChangeTreeData.fire(undefined);
      
      vscode.window.showInformationMessage(`Removed root ${rootPath} from configuration`);
    } catch (error) {
      this.logError('Failed to remove root', error);
    }
  }

  /**
   * Clear all running remotes - used when the extension is reactivated
   */
  clearAllRemotes(): void {
    this.runningRemotes.clear();
    this.log('Cleared all running remotes on startup');
  }

  /**
   * Change the configuration file and reload
   */
  async changeConfigFile(): Promise<void> {
    try {
      const changed = await this.rootConfigManager.changeConfigFile();
      
      if (changed) {
        // Reload configurations from the new config file
        await this.reloadConfigurations();
      }
    } catch (error) {
      this.logError('Failed to change configuration file', error);
    }
  }

  /**
   * Check if a root app is running
   */
  private isRootAppRunning(rootPath: string): boolean {
    return this.runningRootApps.has(rootPath);
  }

  /**
   * Start a root app
   */
  async startRootApp(rootFolder: RootFolder): Promise<void> {
    try {
      const rootPath = rootFolder.path;
      this.log(`Starting root app: ${rootPath}`);
      
      // Check if already running
      if (this.isRootAppRunning(rootPath)) {
        vscode.window.showInformationMessage(`Root app is already running: ${rootFolder.name}`);
        return;
      }
      
      // If start command is not configured, ask user to configure it
      if (!rootFolder.startCommand) {
        const startCommand = await this.configureRootAppStartCommand(rootFolder);
        if (!startCommand) {
          return; // User cancelled
        }
      }
      
      // Create terminal and run the start command
      const terminal = vscode.window.createTerminal(`MFE Root: ${rootFolder.name}`);
      terminal.show();
      terminal.sendText(`cd "${rootPath}" && ${rootFolder.startCommand}`);
      
      // Store the running app
      this.runningRootApps.set(rootPath, { terminal });
      
      // Refresh the tree view
      this.refresh();
      
      vscode.window.showInformationMessage(`Started root app: ${rootFolder.name}`);
    } catch (error) {
      this.logError(`Failed to start root app: ${rootFolder.name}`, error);
    }
  }
  
  /**
   * Stop a running root app
   */
  async stopRootApp(rootFolder: RootFolder): Promise<void> {
    try {
      const rootPath = rootFolder.path;
      this.log(`Stopping root app: ${rootPath}`);
      
      // Check if it's running
      const runningApp = this.runningRootApps.get(rootPath);
      if (!runningApp) {
        vscode.window.showInformationMessage(`Root app is not running: ${rootFolder.name}`);
        return;
      }
      
      // Dispose the terminal
      runningApp.terminal.dispose();
      this.runningRootApps.delete(rootPath);
      
      // Refresh the tree view
      this.refresh();
      
      vscode.window.showInformationMessage(`Stopped root app: ${rootFolder.name}`);
    } catch (error) {
      this.logError(`Failed to stop root app: ${rootFolder.name}`, error);
    }
  }
  
  /**
   * Configure start command for a root app
   */
  async configureRootAppStartCommand(rootFolder: RootFolder): Promise<string | undefined> {
    try {
      // Get current start command or default
      const currentCommand = rootFolder.startCommand || '';
      
      // Detect common package managers in the directory
      let defaultCommand = '';
      try {
        if (fsSync.existsSync(path.join(rootFolder.path, 'package-lock.json'))) {
          defaultCommand = 'npm run start';
        } else if (fsSync.existsSync(path.join(rootFolder.path, 'yarn.lock'))) {
          defaultCommand = 'yarn start';
        } else if (fsSync.existsSync(path.join(rootFolder.path, 'pnpm-lock.yaml'))) {
          defaultCommand = 'pnpm run start';
        } else {
          defaultCommand = 'npm run start';
        }
      } catch {
        defaultCommand = 'npm run start';
      }
      
      // Ask user for the start command
      const startCommand = await vscode.window.showInputBox({
        prompt: `Configure start command for ${rootFolder.name}`,
        value: currentCommand || defaultCommand,
        placeHolder: 'e.g., npm run start, yarn dev, etc.',
      });
      
      if (!startCommand) {
        return undefined; // User cancelled
      }
      
      // Update the root folder start command
      rootFolder.startCommand = startCommand;
      
      // Save root folder configuration
      await this.saveRootFolderConfig(rootFolder);
      
      // Refresh the tree view
      this.refresh();
      
      vscode.window.showInformationMessage(`Configured start command for ${rootFolder.name}: ${startCommand}`);
      return startCommand;
    } catch (error) {
      this.logError(`Failed to configure start command for root app: ${rootFolder.name}`, error);
      return undefined;
    }
  }
  
  /**
   * Save root folder configuration
   */
  private async saveRootFolderConfig(rootFolder: RootFolder): Promise<void> {
    try {
      const configPath = await this.rootConfigManager.getConfigPath();
      if (!configPath) {
        this.logError(`Failed to save root folder config for ${rootFolder.name}`, 'No configuration path found');
        return;
      }
      
      // Get current config
      const config = await this.rootConfigManager.loadRootConfig();
      
      // Create or update the configs property if it doesn't exist
      if (!config.rootConfigs) {
        config.rootConfigs = {};
      }
      
      // Save the root folder configuration
      config.rootConfigs[rootFolder.path] = {
        startCommand: rootFolder.startCommand
      };
      
      // Save the config
      await this.rootConfigManager.saveRootConfig(config);
      
      this.log(`Saved root folder configuration for ${rootFolder.name}`);
    } catch (error) {
      this.logError(`Failed to save root folder config for ${rootFolder.name}`, error);
    }
  }
  
  /**
   * Load root folder configurations
   */
  private async loadRootFolderConfigs(): Promise<void> {
    try {
      const config = await this.rootConfigManager.loadRootConfig();
      
      // If no root configs property, nothing to load
      if (!config.rootConfigs) {
        return;
      }
      
      // Update root folder configurations
      for (const [rootPath, configs] of this.rootConfigs.entries()) {
        const rootConfig = config.rootConfigs[rootPath];
        if (rootConfig) {
          // Update the root folder in the tree view
          const rootFolder: RootFolder = {
            type: 'rootFolder',
            path: rootPath,
            name: path.basename(rootPath),
            configs: configs,
            startCommand: rootConfig.startCommand,
            isRunning: this.isRootAppRunning(rootPath)
          };
          
          // Store the updated configuration in the map
          this.rootConfigs.set(rootPath, configs);
        }
      }
      
      this.log('Loaded root folder configurations');
    } catch (error) {
      this.logError('Failed to load root folder configurations', error);
    }
  }

  /**
   * Clear all running apps - used when the extension is reactivated
   */
  clearAllRunningApps(): void {
    this.runningRemotes.clear();
    this.runningRootApps.clear();
    this.log('Cleared all running remotes and root apps on startup');
  }
} 