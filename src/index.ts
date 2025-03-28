import * as vscode from 'vscode';
import * as fsPromises from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import * as estraverse from 'estraverse';
import { ModuleFederationConfig } from './types';
import { ExposedModule, ModuleFederationStatus, Remote, RemotesFolder, ExposesFolder } from './types';
import { UnifiedModuleFederationProvider } from './unifiedTreeProvider';
const { parse } = require('@typescript-eslint/parser');

function isRemote(element: Remote | ModuleFederationStatus | ExposedModule | RemotesFolder | ExposesFolder): element is Remote {
  return !('type' in element) && !('hasConfig' in element) && !('remoteName' in element);
}

/**
 * Tree data provider for Module Federation remotes
 */
export class ModuleFederationProvider implements vscode.TreeDataProvider<Remote | ModuleFederationStatus | ExposedModule | RemotesFolder | ExposesFolder> {
  private _onDidChangeTreeData: vscode.EventEmitter<Remote | ModuleFederationStatus | ExposedModule | RemotesFolder | ExposesFolder | undefined> = new vscode.EventEmitter<Remote | ModuleFederationStatus | ExposedModule | RemotesFolder | ExposesFolder | undefined>();
  readonly onDidChangeTreeData: vscode.Event<Remote | ModuleFederationStatus | ExposedModule | RemotesFolder | ExposesFolder | undefined> = this._onDidChangeTreeData.event;
  private outputChannel: vscode.OutputChannel;
  private runningApps: Map<string, { terminal: vscode.Terminal; processId?: number }> = new Map();
  public runningRemotes: Map<string, { terminal: vscode.Terminal }> = new Map();

  private configs: ModuleFederationConfig[] = [];
  private status: ModuleFederationStatus = {
    hasConfig: false,
    remotesCount: 0,
    exposesCount: 0
  };
  private isLoading = false;

  constructor(
    private readonly workspaceRoot: string | undefined,
    private readonly context: vscode.ExtensionContext
  ) {
    this.outputChannel = vscode.window.createOutputChannel('Module Federation');
    this.log('Initializing Module Federation Explorer...');
    this.loadConfigurations();
  }

  /**
   * Refreshes the tree view
   */
  refresh(): void {
    // Only fire a change event to refresh the UI without reloading configs
    this._onDidChangeTreeData.fire(undefined);
  }
  
  /**
   * Reloads configurations from disk and then refreshes the tree view
   */
  reloadConfigurations(): void {
    this.loadConfigurations();
  }

  // Add logger method for general logging
  log(message: string): void {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] ${message}`);
  }

  // Update existing logError method
  private logError(message: string, error: unknown): void {
    const errorDetails = error instanceof Error ? error.stack || error.message : String(error);
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] ERROR: ${message}:\n${errorDetails}`);
    console.error(`[Module Federation] ${message}:\n`, errorDetails);
    vscode.window.showErrorMessage(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  }

  /**
   * Loads Module Federation configurations from webpack and vite configs
   */
  private async loadConfigurations(): Promise<void> {
    if (this.isLoading) return;
    
    try {
      this.isLoading = true;
      
      // Save names of running apps for restoration later
      const runningAppNames = new Set([...this.runningApps.keys()]);
      const oldConfigs = [...this.configs]; // Make a copy of the existing configs
      
      this.configs = [];
      
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        this.logError('Configuration Error', 'No workspace folders found');
        return;
      }

      this.log('Searching for configuration files...');
      
      // Process each workspace folder
      for (const folder of workspaceFolders) {
        const workspaceRoot = folder.uri.fsPath;
        this.log(`Processing workspace folder: ${workspaceRoot}`);

        // Find all webpack and vite config files, excluding node_modules
        // Use relative path pattern to scope search to current workspace folder
        const relativePattern = path.relative(workspaceRoot, workspaceRoot);
        const [webpackFiles, viteFiles] = await Promise.all([
          vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, '**/{webpack.config.js,webpack.config.ts}'),
            '**/node_modules/**'
          ),
          vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, '**/{vite.config.js,vite.config.ts}'),
            '**/node_modules/**'
          )
        ]).catch(error => {
          this.logError('Failed to find configuration files', error);
          return [[], []];
        });

        this.log(`Found ${webpackFiles.length} webpack configs and ${viteFiles.length} vite configs in ${folder.name}`);

        // Process webpack configs
        const webpackConfigs = await this.processConfigFiles(
          webpackFiles, 
          extractConfigFromWebpack,
          'webpack',
          workspaceRoot
        );
        
        // Process vite configs
        const viteConfigs = await this.processConfigFiles(
          viteFiles, 
          extractConfigFromVite,
          'vite',
          workspaceRoot
        );
        
        this.configs = [...this.configs, ...webpackConfigs, ...viteConfigs];
      }

      // After loading all configs, update with saved settings
      await this.loadSavedRemoteConfigurations();

      // Update status
      this.status = {
        hasConfig: this.configs.length > 0,
        configType: this.configs[0]?.configType,
        configPath: this.configs[0]?.configPath,
        remotesCount: this.configs.reduce((acc, config) => acc + config.remotes.length, 0),
        exposesCount: this.configs.reduce((acc, config) => acc + config.exposes.length, 0)
      };

      this.log(`Found ${this.configs.length} configurations with ${this.status.remotesCount} remotes and ${this.status.exposesCount} exposes`);
      this._onDidChangeTreeData.fire(undefined);
      
    } catch (error) {
      this.logError('Failed to load Module Federation configurations', error);
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Process a list of config files with the provided extractor function
   */
  private async processConfigFiles(
    files: vscode.Uri[],
    extractor: (ast: any, workspaceRoot: string) => Promise<ModuleFederationConfig>,
    configType: string,
    workspaceRoot: string
  ): Promise<ModuleFederationConfig[]> {
    const results: ModuleFederationConfig[] = [];
    
    for (const file of files) {
      try {
        this.log(`Processing ${configType} config: ${file.fsPath}`);
        const content = await fsPromises.readFile(file.fsPath, 'utf8');
        const ast = parse(content, {
          sourceType: 'module',
          ecmaVersion: 'latest'
        });
        const config = await extractor(ast, workspaceRoot);
        results.push({
          ...config,
          configPath: file.fsPath
        });
      } catch (error) {
        this.logError(`Error processing ${file.fsPath}`, error);
      }
    }
    
    return results;
  }

  /**
   * Check if a directory exists
   */
  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stats = await fsPromises.stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  getTreeItem(element: Remote | ModuleFederationStatus | ExposedModule | RemotesFolder | ExposesFolder): vscode.TreeItem {
    if ('type' in element && element.type === 'remotesFolder') {
      // This is a RemotesFolder
      const treeItem = new vscode.TreeItem(
        'Remotes',
        vscode.TreeItemCollapsibleState.Expanded
      );
      treeItem.iconPath = new vscode.ThemeIcon('remote');
      treeItem.contextValue = 'remotesFolder';
      return treeItem;
    } else if ('type' in element && element.type === 'exposesFolder') {
      // This is an ExposesFolder
      const treeItem = new vscode.TreeItem(
        'Exposes',
        vscode.TreeItemCollapsibleState.Expanded
      );
      treeItem.iconPath = new vscode.ThemeIcon('symbol-module');
      treeItem.contextValue = 'exposesFolder';
      return treeItem;
    } else if ('hasConfig' in element) {
      // This is a ModuleFederationStatus - represents an MFE app
      const treeItem = new vscode.TreeItem(
        element.name || 'Module Federation',
        vscode.TreeItemCollapsibleState.Expanded
      );
      
      const runningStatus = this.runningApps.has(element.name || '') ? '(Running)' : '';
      const statusText = element.hasConfig 
        ? `${element.configType} - ${element.remotesCount} remote${element.remotesCount !== 1 ? 's' : ''}, ${element.exposesCount} expose${element.exposesCount !== 1 ? 's' : ''} ${runningStatus}`
        : 'Not configured';
      
      treeItem.description = statusText;
      treeItem.tooltip = element.hasConfig 
        ? `Module Federation App: ${element.name}\nConfig type: ${element.configType}\nConfig file: ${element.configPath}\nRemotes: ${element.remotesCount}\nExposes: ${element.exposesCount}\nStatus: ${runningStatus || 'Not Running'}`
        : 'Module Federation is not configured in this project.';
      treeItem.iconPath = new vscode.ThemeIcon(this.runningApps.has(element.name || '') ? 'play-circle' : 'package');
      treeItem.contextValue = this.runningApps.has(element.name || '') ? 'moduleFederationStatusRunning' : 'moduleFederationStatus';
      
      // Add buttons for start/stop
      treeItem.command = {
        command: this.runningApps.has(element.name || '') ? 'moduleFederation.stopApp' : 'moduleFederation.startApp',
        title: this.runningApps.has(element.name || '') ? 'Stop App' : 'Start App',
        arguments: [element]
      };
      
      return treeItem;
    } else if ('remoteName' in element) {
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
        ? (element.url || '') 
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

  getChildren(element?: Remote | ModuleFederationStatus | ExposedModule | RemotesFolder | ExposesFolder): Thenable<(Remote | ModuleFederationStatus | ExposedModule | RemotesFolder | ExposesFolder)[]> {
    if (!element) {
      // Root level - show MFE apps
      return Promise.resolve(
        this.configs.map(config => ({
          hasConfig: true,
          name: config.name,
          configType: config.configType,
          configPath: config.configPath,
          remotesCount: config.remotes.length,
          exposesCount: config.exposes.length
        }))
      );
    } else if ('hasConfig' in element) {
      // MFE app node - show remotes folder and exposes folder
      const config = this.configs.find(c => c.name === element.name);
      if (!config) return Promise.resolve([]);
      
      const children: (RemotesFolder | ExposesFolder)[] = [];
      
      // Add remotes folder if there are remotes
      if (config.remotes.length > 0) {
        children.push({
          type: 'remotesFolder',
          parentName: config.name,
          remotes: config.remotes
        });
      }
      
      // Add exposes folder if there are exposes
      if (config.exposes.length > 0) {
        children.push({
          type: 'exposesFolder',
          parentName: config.name,
          exposes: config.exposes
        });
      }
      
      return Promise.resolve(children);
    } else if ('type' in element && element.type === 'remotesFolder') {
      // RemotesFolder node - show all remotes
      return Promise.resolve(element.remotes);
    } else if ('type' in element && element.type === 'exposesFolder') {
      // ExposesFolder node - show all exposes
      return Promise.resolve(element.exposes);
    } else if ('remoteName' in element) {
      // ExposedModule node - no children
      return Promise.resolve([]);
    } else if (isRemote(element)) {
      // Remote node - show its exposes
      const config = this.configs.find(c => c.remotes.some(r => r.name === element.name));
      return Promise.resolve(config?.exposes.filter(e => e.remoteName === element.name) || []);
    } else {
      return Promise.resolve([]);
    }
  }

  // Add method to start an MFE app
  async startApp(status: ModuleFederationStatus) {
    if (!status.name) return;
    
    try {
      const config = this.configs.find(c => c.name === status.name);
      if (!config) {
        throw new Error(`Configuration not found for ${status.name}`);
      }

      // Check if already running
      if (this.runningApps.has(status.name)) {
        vscode.window.showInformationMessage(`${status.name} is already running`);
        return;
      }

      // Get the project directory (parent of config file)
      const projectDir = config.configPath.replace(/[^/\\]+$/, '');

      // Detect package manager and determine start command
      const { packageManager, startCommand } = await detectPackageManagerAndStartCommand(projectDir, config.configType);
      
      // Create terminal and start the app
      const terminal = vscode.window.createTerminal(`MFE: ${status.name}`);
      terminal.show();
      terminal.sendText(`cd "${projectDir}" && ${startCommand}`);
      
      // Store running app info
      this.runningApps.set(status.name, { terminal });
      
      // Refresh the tree view to show the updated status
      this._onDidChangeTreeData.fire(undefined);
      
      vscode.window.showInformationMessage(`Started ${status.name} using ${packageManager}`);
    } catch (error) {
      this.logError(`Failed to start ${status.name}`, error);
    }
  }

  // Add method to stop an MFE app
  async stopApp(status: ModuleFederationStatus) {
    if (!status.name) return;
    
    try {
      const runningApp = this.runningApps.get(status.name);
      if (!runningApp) {
        vscode.window.showInformationMessage(`${status.name} is not running`);
        return;
      }

      // Dispose the terminal
      runningApp.terminal.dispose();
      this.runningApps.delete(status.name);
      
      // Refresh the tree view to show the updated status
      this._onDidChangeTreeData.fire(undefined);
      
      vscode.window.showInformationMessage(`Stopped ${status.name}`);
    } catch (error) {
      this.logError(`Failed to stop ${status.name}`, error);
    }
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
   * Update the remote configurations from saved settings
   */
  async loadSavedRemoteConfigurations(): Promise<void> {
    try {
      const savedConfigs = await loadRemoteConfigurations(this.context);
      
      // Update remotes with saved configurations
      for (const config of this.configs) {
        for (const remote of config.remotes) {
          const savedRemote = savedConfigs[remote.name];
          if (savedRemote) {
            // Update folder, package manager and commands
            remote.folder = savedRemote.folder || remote.folder;
            remote.packageManager = savedRemote.packageManager || remote.packageManager;
            remote.startCommand = savedRemote.startCommand || remote.startCommand;
            remote.buildCommand = savedRemote.buildCommand || undefined;
          }
        }
      }
    } catch (error) {
      this.logError('Failed to load saved remote configurations', error);
    }
  }

  /**
   * Clear all running remotes - used when the extension is reactivated
   */
  clearAllRemotes(): void {
    this.runningRemotes.clear();
    this.log('Cleared all running remotes on startup');
  }
}

/**
 * Extract Module Federation configuration from webpack config AST
 */
async function extractConfigFromWebpack(ast: any, workspaceRoot: string): Promise<ModuleFederationConfig> {
  const config: ModuleFederationConfig = {
    name: '',
    remotes: [],
    exposes: [],
    configType: 'webpack',
    configPath: ''
  };
  
  estraverse.traverse(ast, {
    enter(node: any) {
      // Check for ModuleFederationPlugin instantiation
      if (isModuleFederationPluginNode(node)) {
        const options = node.arguments[0];
        
        // Extract name
        const nameProp = findProperty(options, 'name');
        if (nameProp?.value.type === 'Literal') {
          config.name = nameProp.value.value;
        }
        
        // Extract remotes
        const remotesProp = findProperty(options, 'remotes');
        if (remotesProp?.value.type === 'ObjectExpression') {
          for (const prop of remotesProp.value.properties) {
            if (isValidRemoteProperty(prop)) {
              // Each remote needs its own folder setting - leave blank and let user configure
              config.remotes.push({
                name: prop.key.name,
                url: prop.value.value,
                folder: '',  // This will be configured by the user
                remoteEntry: prop.value.value,
                packageManager: '',  // Will be detected after folder is set
                configType: 'webpack'
              });
            }
          }
        }
        
        // Extract exposes
        const exposesProp = findProperty(options, 'exposes');
        if (exposesProp?.value.type === 'ObjectExpression') {
          for (const prop of exposesProp.value.properties) {
            if (prop.key.type === 'Identifier' && prop.value.type === 'Literal') {
              config.exposes.push({
                name: prop.key.name,
                path: prop.value.value,
                remoteName: config.name
              });
            }
          }
        }
      }
    }
  });

  // We'll defer package manager detection until the user selects a folder
  return config;
}

/**
 * Extract Module Federation configuration from vite config AST
 */
async function extractConfigFromVite(ast: any, workspaceRoot: string): Promise<ModuleFederationConfig> {
  const config: ModuleFederationConfig = {
    name: '',
    remotes: [],
    exposes: [],
    configType: 'vite',
    configPath: ''
  };
  
  const configObj = findViteConfigObject(ast);
  if (!configObj) return config;
  
  // Find plugins array
  const pluginsProp = findProperty(configObj, 'plugins');
  if (pluginsProp?.value.type !== 'ArrayExpression') return config;
  
  // Process each plugin
  for (const plugin of pluginsProp.value.elements) {
    if (isFederationPlugin(plugin)) {
      const options = plugin.arguments[0];
      
      // Extract name
      const nameProp = findProperty(options, 'name');
      if (nameProp?.value.type === 'Literal') {
        config.name = nameProp.value.value;
      }
      
      // Extract remotes
      const remotesProp = findProperty(options, 'remotes');
      if (remotesProp?.value.type === 'ObjectExpression') {
        for (const prop of remotesProp.value.properties) {
          if (prop.key.type === 'Identifier' || prop.key.type === 'Literal') {
            const remoteName = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
            const remoteUrl = prop.value.type === 'Literal' ? prop.value.value : undefined;
            
            config.remotes.push({
              name: remoteName,
              url: remoteUrl,
              folder: '',  // This will be configured by the user
              remoteEntry: remoteUrl,
              packageManager: '',  // Will be detected after folder is set
              configType: 'vite'
            });
          }
        }
      }
      
      // Extract exposes
      const exposesProp = findProperty(options, 'exposes');
      if (exposesProp?.value.type === 'ObjectExpression') {
        for (const prop of exposesProp.value.properties) {
          if (prop.key.type === 'Identifier' || prop.key.type === 'Literal') {
            const exposeName = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
            if (prop.value.type === 'Literal') {
              config.exposes.push({
                name: exposeName,
                path: prop.value.value,
                remoteName: config.name
              });
            }
          }
        }
      }
    }
  }
  
  // We'll defer package manager detection until the user selects a folder
  return config;
}

// Helper functions for AST traversal
function findProperty(obj: any, name: string): any {
  return obj.properties.find((p: any) =>
    p.type === 'Property' &&
    p.key.type === 'Identifier' &&
    p.key.name === name
  );
}

function isValidRemoteProperty(prop: any): boolean {
  return prop.type === 'Property' &&
         prop.key.type === 'Identifier' &&
         prop.value.type === 'Literal' &&
         typeof prop.value.value === 'string';
}

function isModuleFederationPluginNode(node: any): boolean {
  if (node.type !== 'NewExpression' || node.arguments.length === 0) {
    return false;
  }
  
  let calleeName: string | undefined;
  
  if (node.callee.type === 'Identifier') {
    calleeName = node.callee.name;
  } else if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier') {
    calleeName = node.callee.property.name;
  }
  
  return calleeName === 'ModuleFederationPlugin' && 
         node.arguments[0]?.type === 'ObjectExpression';
}

function findViteConfigObject(ast: any): any {
  let configObj = null;
  
  estraverse.traverse(ast, {
    enter(node: any) {
      if (node.type === 'ExportDefaultDeclaration') {
        if (node.declaration.type === 'CallExpression' &&
            node.declaration.callee.type === 'Identifier' &&
            node.declaration.callee.name === 'defineConfig' &&
            node.declaration.arguments.length > 0) {
          configObj = node.declaration.arguments[0];
        } else if (node.declaration.type === 'ObjectExpression') {
          configObj = node.declaration;
        }
      }
    }
  });
  
  return configObj;
}

function isFederationPlugin(plugin: any): boolean {
  if (plugin.type !== 'CallExpression' || plugin.arguments.length === 0) {
    return false;
  }

  // Check for direct federation call
  if (plugin.callee.type === 'Identifier' && plugin.callee.name === 'federation') {
    return true;
  }

  // Check for imported federation plugin
  if (plugin.callee.type === 'Identifier' && 
      (plugin.callee.name === 'federation' || 
       plugin.callee.name.includes('federation'))) {
    return true;
  }

  return false;
}

/**
 * Detect package manager and get appropriate start command based on project type
 */
async function detectPackageManagerAndStartCommand(folder: string, configType: 'webpack' | 'vite'): Promise<{ packageManager: 'npm' | 'pnpm' | 'yarn', startCommand: string }> {
  try {
    // Check for package-lock.json (npm)
    const hasPackageLock = await fsPromises.access(path.join(folder, 'package-lock.json')).then(() => true).catch(() => false);
    if (hasPackageLock) {
      const startScript = configType === 'vite' ? 'dev' : 'start';
      return { packageManager: 'npm', startCommand: `npm run ${startScript}` };
    }

    // Check for pnpm-lock.yaml (pnpm)
    const hasPnpmLock = await fsPromises.access(path.join(folder, 'pnpm-lock.yaml')).then(() => true).catch(() => false);
    if (hasPnpmLock) {
      const startScript = configType === 'vite' ? 'dev' : 'start';
      return { packageManager: 'pnpm', startCommand: `pnpm run ${startScript}` };
    }

    // Check for yarn.lock (yarn)
    const hasYarnLock = await fsPromises.access(path.join(folder, 'yarn.lock')).then(() => true).catch(() => false);
    if (hasYarnLock) {
      const startScript = configType === 'vite' ? 'dev' : 'start';
      return { packageManager: 'yarn', startCommand: `yarn ${startScript}` };
    }

    // Default to npm if no lock file is found
    const startScript = configType === 'vite' ? 'dev' : 'start';
    return { packageManager: 'npm', startCommand: `npm run ${startScript}` };
  } catch (error) {
    console.error('Error detecting package manager:', error);
    // Default to npm if there's an error
    const startScript = configType === 'vite' ? 'dev' : 'start';
    return { packageManager: 'npm', startCommand: `npm run ${startScript}` };
  }
}

/**
 * Activate the extension
 */
export function activate(context: vscode.ExtensionContext) {
  try {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    
    // Create the unified provider instead of the old one
    const provider = new UnifiedModuleFederationProvider(workspaceRoot, context);
    
    // Clear any previously running remotes (in case of extension restart)
    provider.clearAllRemotes();
    
    // Show initial welcome message
    vscode.window.showInformationMessage('Module Federation Explorer is now active! Loading configurations from all roots...');
    provider.log('Extension activated successfully');

    // Register the tree data provider
    vscode.window.registerTreeDataProvider('moduleFederation', provider);

    // Register commands and watchers
    const disposables = [
      vscode.commands.registerCommand('moduleFederation.refresh', () => provider.reloadConfigurations()),
      
      // Root management commands
      vscode.commands.registerCommand('moduleFederation.addRoot', () => provider.addRoot()),
      vscode.commands.registerCommand('moduleFederation.removeRoot', (rootFolder) => provider.removeRoot(rootFolder)),
      
      // Remote commands
      vscode.commands.registerCommand('moduleFederation.stopRemote', async (remote: Remote) => {
        try {
          const remoteKey = `remote-${remote.name}`;
          provider.log(`Stopping remote ${remote.name}`);
          provider.stopRemote(remoteKey);
          provider.refresh();
          vscode.window.showInformationMessage(`Stopped remote ${remote.name}`);
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to stop remote ${remote.name}: ${error}`);
        }
      }),

      // Start remote command
      vscode.commands.registerCommand('moduleFederation.startRemote', async (remote: Remote) => {
        try {
          provider.log(`Starting remote ${remote.name}, folder: ${remote.folder || 'not set'}`);
          
          // First, let the user select or confirm the remote folder
          let folder = remote.folder;
          
          // If folder is not set, ask user to select one
          if (!folder) {
            const selectedFolder = await vscode.window.showOpenDialog({
              canSelectFiles: false,
              canSelectFolders: true,
              canSelectMany: false,
              openLabel: 'Select MFE Project Folder',
              title: `Select the project folder for MFE remote "${remote.name}" (where package.json is located)`
            });

            if (!selectedFolder || selectedFolder.length === 0) {
              vscode.window.showInformationMessage('No MFE project folder selected. Please select the folder where your MFE project is located (containing package.json).');
              return;
            }
            
            folder = selectedFolder[0].fsPath;
            remote.folder = folder;
            provider.log(`User selected root project folder for remote ${remote.name}: ${folder}`);
            
            // Save the folder configuration
            await saveRemoteConfiguration(remote, context);
            
            // Refresh the tree view to reflect folder changes
            provider.reloadConfigurations();
          } else {
            // If folder is already set, confirm with user
            const confirmFolder = await vscode.window.showQuickPick(
              [
                { label: 'Yes, use current folder', description: folder },
                { label: 'No, select a different folder', description: 'Browse for a different MFE project folder' }
              ],
              { placeHolder: `Current MFE project folder: ${folder}. Continue with this folder?` }
            );
            
            if (!confirmFolder) return;
            
            if (confirmFolder.label.startsWith('No')) {
              const selectedFolder = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select MFE Project Folder',
                title: `Select the project folder for MFE remote "${remote.name}" (where package.json is located)`
              });

              if (!selectedFolder || selectedFolder.length === 0) return;
              
              folder = selectedFolder[0].fsPath;
              remote.folder = folder;
              provider.log(`User selected root project folder for remote ${remote.name}: ${folder}`);
              
              // Save the folder configuration
              await saveRemoteConfiguration(remote, context);
              
              // Refresh the tree view to reflect folder changes
              provider.reloadConfigurations();
            }
          }
          
          // Check if build and start commands are configured
          if (!remote.buildCommand || !remote.startCommand) {
            provider.log(`Build or start command not configured for remote ${remote.name}`);
            // Get current package manager or detect it
            let packageManager = remote.packageManager;
            if (!packageManager) {
              // Detect package manager
              if (fs.existsSync(path.join(remote.folder, 'package-lock.json'))) {
                packageManager = 'npm';
              } else if (fs.existsSync(path.join(remote.folder, 'yarn.lock'))) {
                packageManager = 'yarn';
              } else if (fs.existsSync(path.join(remote.folder, 'pnpm-lock.yaml'))) {
                packageManager = 'pnpm';
              } else {
                packageManager = 'npm'; // Default to npm
              }
              remote.packageManager = packageManager;
              provider.log(`Detected package manager for remote ${remote.name}: ${packageManager}`);
            }
            
            // Ask user for build command
            const defaultBuildCommand = `${packageManager} run build`;
            const buildCommand = await vscode.window.showInputBox({
              prompt: 'Enter the build command',
              value: remote.buildCommand || defaultBuildCommand,
              title: 'Configure Build Command'
            });
            
            if (!buildCommand) {
              vscode.window.showInformationMessage('Build command not provided, remote configuration canceled.');
              return;
            }
            
            // Ask user for start command
            const defaultStartCommand = `${packageManager} run ${remote.configType === 'vite' ? 'dev' : 'start'}`;
            const startCommand = await vscode.window.showInputBox({
              prompt: 'Enter the start command',
              value: remote.startCommand || defaultStartCommand,
              title: 'Configure Start Command'
            });
            
            if (!startCommand) {
              vscode.window.showInformationMessage('Start command not provided, remote configuration canceled.');
              return;
            }
            
            // Update remote configuration
            remote.buildCommand = buildCommand;
            remote.startCommand = startCommand;
            
            // Save the updated configuration
            await saveRemoteConfiguration(remote, context);
            
            // Refresh view to reflect new command configuration
            provider.reloadConfigurations();
            
            vscode.window.showInformationMessage(`Commands configured for remote "${remote.name}"`);
          }

          // Check if a terminal for this remote is already running
          const remoteKey = `remote-${remote.name}`;
          provider.log(`Checking if remote ${remote.name} is already running (key: ${remoteKey})`);
          const existingTerminal = provider.getRunningRemoteTerminal(remoteKey);
          if (existingTerminal) {
            provider.log(`Remote ${remote.name} is already running, showing existing terminal`);
            existingTerminal.show();
            vscode.window.showInformationMessage(`Remote ${remote.name} is already running`);
            return;
          }
          
          provider.log(`Remote ${remote.name} is not running, creating new terminal`);

          // Create a new terminal and start the remote
          const terminal = vscode.window.createTerminal(`Remote: ${remote.name}`);
          terminal.show();
          
          // Run build and serve commands
          terminal.sendText(`cd "${remote.folder}" && ${remote.buildCommand} && ${remote.startCommand}`);
          
          // Store running remote info
          provider.setRunningRemote(remoteKey, terminal);
          
          // Ensure UI is updated to show the running remote
          provider.refresh();
          
          vscode.window.showInformationMessage(`Started remote ${remote.name}: build with "${remote.buildCommand}" and serve with "${remote.startCommand}"`);
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to start remote ${remote.name}: ${error}`);
        }
      }),

      // Configure start command
      vscode.commands.registerCommand('moduleFederation.configureStartCommand', async (remote: Remote) => {
        try {
          // First, let the user select or confirm the remote folder
          let folder = remote.folder;
          
          // If folder is not set, ask user to select one
          if (!folder) {
            const selectedFolder = await vscode.window.showOpenDialog({
              canSelectFiles: false,
              canSelectFolders: true,
              canSelectMany: false,
              openLabel: 'Select MFE Project Folder',
              title: `Select the project folder for MFE remote "${remote.name}" (where package.json is located)`
            });

            if (!selectedFolder || selectedFolder.length === 0) {
              vscode.window.showInformationMessage('No MFE project folder selected. Please select the folder where your MFE project is located (containing package.json).');
              return;
            }
            
            folder = selectedFolder[0].fsPath;
            remote.folder = folder;
          } else {
            // If folder is already set, confirm with user
            const confirmFolder = await vscode.window.showQuickPick(
              [
                { label: 'Yes, use current folder', description: folder },
                { label: 'No, select a different folder', description: 'Browse for a different MFE project folder' }
              ],
              { placeHolder: `Current MFE project folder: ${folder}. Continue with this folder?` }
            );
            
            if (!confirmFolder) return;
            
            if (confirmFolder.label.startsWith('No')) {
              const selectedFolder = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select MFE Project Folder',
                title: `Select the project folder for MFE remote "${remote.name}" (where package.json is located)`
              });

              if (!selectedFolder || selectedFolder.length === 0) return;
              
              folder = selectedFolder[0].fsPath;
              remote.folder = folder;
            }
          }
          
          // Get current package manager
          const currentPM = remote.packageManager || 'npm';
          
          // Let user select package manager
          const packageManagers: vscode.QuickPickItem[] = [
            { label: 'npm', description: 'Node Package Manager' },
            { label: 'yarn', description: 'Yarn Package Manager' },
            { label: 'pnpm', description: 'Performant NPM' }
          ];
          
          const selectedPM = await vscode.window.showQuickPick(
            packageManagers,
            {
              placeHolder: 'Select package manager',
              title: 'Configure Start Command'
            }
          );
          
          if (!selectedPM) return;
          
          // Let user input custom build command
          const defaultBuildCommand = remote.buildCommand || `${selectedPM.label} run build`;
          const buildCommand = await vscode.window.showInputBox({
            prompt: 'Enter the build command (leave empty to skip build step)',
            value: defaultBuildCommand,
            title: 'Configure Build Command'
          });
          
          // Let user input custom start command
          const defaultCommand = remote.startCommand || `${selectedPM.label} start`;
          const startCommand = await vscode.window.showInputBox({
            prompt: 'Enter the start command',
            value: defaultCommand,
            title: 'Configure Start Command'
          });
          
          if (!startCommand) return;
          
          // Update remote configuration
          remote.packageManager = selectedPM.label as 'npm' | 'yarn' | 'pnpm';
          remote.buildCommand = buildCommand || '';
          remote.startCommand = startCommand;
          
          // Save configuration to a persistent storage
          await saveRemoteConfiguration(remote, context);
          
          // Refresh the tree view
          provider.reloadConfigurations();
          
          vscode.window.showInformationMessage(`Updated configuration for ${remote.name}`);
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to configure commands for ${remote.name}: ${error}`);
        }
      }),

      vscode.commands.registerCommand('moduleFederation.showWelcome', () => {
        vscode.window.showInformationMessage('Module Federation Explorer activated. Use the view to manage your remotes.');
      })
    ];

    // Add file watcher for config changes in all roots
    const updateOnFileChange = async (uri: vscode.Uri) => {
      try {
        provider.log(`Configuration file changed: ${uri.fsPath}`);
        await provider.reloadConfigurations();
      } catch (error) {
        provider.logError('Error handling file change', error);
      }
    };
    
    // Watch for webpack and vite config changes
    const fileWatcher = vscode.workspace.createFileSystemWatcher(
      '**/{webpack,vite}.config.{js,ts}',
      false, // ignoreCreateEvents
      false, // ignoreChangeEvents
      false  // ignoreDeleteEvents
    );
    
    fileWatcher.onDidChange(updateOnFileChange);
    fileWatcher.onDidCreate(updateOnFileChange);
    fileWatcher.onDidDelete(updateOnFileChange);
    
    // Also watch for changes in .vscode/mf-explorer.roots.json
    const rootsWatcher = vscode.workspace.createFileSystemWatcher(
      '**/.vscode/mf-explorer.roots.json',
      false, // ignoreCreateEvents
      false, // ignoreChangeEvents
      false  // ignoreDeleteEvents
    );
    
    rootsWatcher.onDidChange(updateOnFileChange);
    rootsWatcher.onDidCreate(updateOnFileChange);
    rootsWatcher.onDidDelete(updateOnFileChange);
    
    context.subscriptions.push(...disposables, fileWatcher, rootsWatcher);

  } catch (error) {
    console.error('[Module Federation] Failed to activate extension:', error);
    throw error; // Re-throw to ensure VS Code knows activation failed
  }
}

/**
 * Save remote configuration to persistent storage
 */
async function saveRemoteConfiguration(remote: Remote, context: vscode.ExtensionContext): Promise<void> {
  try {
    // Try to get saved config path first
    let configPath = await getConfigurationPath(context);
    
    // If no saved config path, use default or ask user
    if (!configPath) {
      // Default path in .vscode directory
      const defaultPath = path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.vscode', 'mf-remotes.json');
      
      // Ask user where to store the configuration
      const selectedFolder = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Configuration Folder',
        title: 'Select folder where remote configurations will be stored'
      });

      if (selectedFolder && selectedFolder.length > 0) {
        configPath = path.join(selectedFolder[0].fsPath, 'mf-remotes.json');
      } else {
        configPath = defaultPath;
      }
      
      // Save the selected path for future use
      await saveConfigurationPath(context, configPath);
    }
    
    // Ensure parent directory exists
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    // Read existing config or create empty object
    let config: Record<string, Remote> = {};
    if (fs.existsSync(configPath)) {
      const configContent = await fsPromises.readFile(configPath, 'utf-8');
      config = JSON.parse(configContent);
    }
    
    // Update config with this remote
    config[remote.name] = remote;
    
    // Write config back to file
    await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    
    // Show success message
    vscode.window.showInformationMessage(`Configuration saved to ${configPath}`);
  } catch (error) {
    console.error('Failed to save remote configuration:', error);
    throw new Error(`Failed to save remote configuration: ${error}`);
  }
}

/**
 * Load remote configurations from persistent storage
 */
async function loadRemoteConfigurations(context: vscode.ExtensionContext): Promise<Record<string, Remote>> {
  try {
    // Try to get saved config path first
    let configPath = await getConfigurationPath(context);
    
    // If we have a saved path, check if file exists
    if (configPath && fs.existsSync(configPath)) {
      const configContent = await fsPromises.readFile(configPath, 'utf-8');
      return JSON.parse(configContent);
    }
    
    // Check default location if no saved path or file doesn't exist
    const defaultConfigPath = path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.vscode', 'mf-remotes.json');
    
    if (fs.existsSync(defaultConfigPath)) {
      // Save this path for future use
      await saveConfigurationPath(context, defaultConfigPath);
      const configContent = await fsPromises.readFile(defaultConfigPath, 'utf-8');
      return JSON.parse(configContent);
    }
    
    // If not found anywhere, create a new default configuration file
    const defaultConfig: Record<string, Remote> = {
      // Define a valid default structure for Remote
      'defaultRemote': {
        name: 'defaultRemote',
        folder: '',
        url: '',
        packageManager: 'npm',
        configType: 'webpack', // or 'vite' depending on your use case
        startCommand: '',
        buildCommand: ''
      }
    };

    // Ensure the .vscode directory exists
    const configDir = path.dirname(defaultConfigPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Write the default configuration to the file
    await fsPromises.writeFile(defaultConfigPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    await saveConfigurationPath(context, defaultConfigPath); // Save the path for future use

    return defaultConfig; // Return the newly created default configuration
  } catch (error) {
    console.error('Failed to load remote configurations:', error);
    return {};
  }
}

/**
 * Get the saved configuration path from the workspace state
 */
async function getConfigurationPath(context: vscode.ExtensionContext): Promise<string | undefined> {
  return context.workspaceState.get<string>('mf-explorer.configPath');
}

/**
 * Save the configuration path to the workspace state
 */
async function saveConfigurationPath(context: vscode.ExtensionContext, configPath: string): Promise<void> {
  await context.workspaceState.update('mf-explorer.configPath', configPath);
}