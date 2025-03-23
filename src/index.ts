import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as estraverse from 'estraverse';
import { ModuleFederationConfig } from './types';
import { ExposedModule, ModuleFederationStatus, Remote } from './types';
const { parse } = require('@typescript-eslint/parser');

/**
 * Tree data provider for Module Federation remotes
 */
export class ModuleFederationProvider implements vscode.TreeDataProvider<Remote | ModuleFederationStatus | ExposedModule> {
  private _onDidChangeTreeData: vscode.EventEmitter<Remote | ModuleFederationStatus | ExposedModule | undefined> = new vscode.EventEmitter<Remote | ModuleFederationStatus | ExposedModule | undefined>();
  readonly onDidChangeTreeData: vscode.Event<Remote | ModuleFederationStatus | ExposedModule | undefined> = this._onDidChangeTreeData.event;
  private outputChannel: vscode.OutputChannel;

  private configs: ModuleFederationConfig[] = [];
  private status: ModuleFederationStatus = {
    hasConfig: false,
    remotesCount: 0,
    exposesCount: 0
  };
  private isLoading = false;

  constructor(private readonly workspaceRoot: string | undefined) {
    this.outputChannel = vscode.window.createOutputChannel('Module Federation');
    this.log('Initializing Module Federation Explorer...');
    this.loadConfigurations();
  }

  /**
   * Refreshes the tree view
   */
  refresh(): void {
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
        const content = await fs.readFile(file.fsPath, 'utf8');
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
      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  getTreeItem(element: Remote | ModuleFederationStatus | ExposedModule): vscode.TreeItem {
    if ('hasConfig' in element) {
      // This is a ModuleFederationStatus - represents an MFE app
      const treeItem = new vscode.TreeItem(
        element.name || 'Module Federation',
        vscode.TreeItemCollapsibleState.Expanded
      );
      
      const statusText = element.hasConfig 
        ? `${element.configType} - ${element.remotesCount} remote${element.remotesCount !== 1 ? 's' : ''}, ${element.exposesCount} expose${element.exposesCount !== 1 ? 's' : ''}`
        : 'Not configured';
      
      treeItem.description = statusText;
      treeItem.tooltip = element.hasConfig 
        ? `Module Federation App: ${element.name}\nConfig type: ${element.configType}\nConfig file: ${element.configPath}\nRemotes: ${element.remotesCount}\nExposes: ${element.exposesCount}`
        : 'Module Federation is not configured in this project.';
      treeItem.iconPath = new vscode.ThemeIcon('package');
      treeItem.contextValue = 'moduleFederationStatus';
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
    } else {
      // This is a Remote
      const treeItem = new vscode.TreeItem(
        element.name, 
        vscode.TreeItemCollapsibleState.Collapsed
      );
      
      treeItem.description = element.url;
      treeItem.tooltip = `Remote: ${element.name}\nURL: ${element.url || 'Not specified'}\nFolder: ${element.folder}`;
      treeItem.iconPath = new vscode.ThemeIcon('server');
      treeItem.contextValue = 'remote';
      
      // Add command to start the remote
      treeItem.command = {
        command: 'moduleFederation.startRemote',
        title: `Start ${element.name} (${element.packageManager || 'npm'})`,
        arguments: [element]
      };
      
      return treeItem;
    }
  }

  getChildren(element?: Remote | ModuleFederationStatus | ExposedModule): Thenable<(Remote | ModuleFederationStatus | ExposedModule)[]> {
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
      // MFE app node - show its remotes and exposes
      const config = this.configs.find(c => c.name === element.name);
      if (!config) return Promise.resolve([]);
      
      // First show remotes, then exposes
      return Promise.resolve([
        ...config.remotes,
        ...config.exposes
      ]);
    } else if ('remoteName' in element) {
      // ExposedModule node - no children
      return Promise.resolve([]);
    } else {
      // Remote node - show its exposes
      const config = this.configs.find(c => c.remotes.some(r => r.name === element.name));
      return Promise.resolve(config?.exposes.filter(e => e.remoteName === element.name) || []);
    }
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
              const folderPath = path.join(workspaceRoot, prop.key.name);
              config.remotes.push({
                name: prop.key.name,
                url: prop.value.value,
                folder: folderPath,
                remoteEntry: prop.value.value,
                packageManager: 'npm'
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

  // Detect package manager for each remote after AST traversal
  for (const remote of config.remotes) {
    const { packageManager, startCommand } = await detectPackageManagerAndStartCommand(remote.folder);
    remote.packageManager = packageManager;
    remote.startCommand = startCommand;
  }
  
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
          if (prop.key.type === 'Identifier') {
            const folderPath = path.join(workspaceRoot, prop.key.name);
            config.remotes.push({
              name: prop.key.name,
              folder: folderPath,
              packageManager: 'npm'
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

  // Detect package manager for each remote after AST traversal
  for (const remote of config.remotes) {
    const { packageManager, startCommand } = await detectPackageManagerAndStartCommand(remote.folder);
    remote.packageManager = packageManager;
    remote.startCommand = startCommand;
  }
  
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
 * Detect package manager and get start command for a remote
 */
async function detectPackageManagerAndStartCommand(folder: string): Promise<{ packageManager: 'npm' | 'pnpm' | 'yarn', startCommand: string }> {
  try {
    // Check for package-lock.json (npm)
    const hasPackageLock = await fs.access(path.join(folder, 'package-lock.json')).then(() => true).catch(() => false);
    if (hasPackageLock) {
      return { packageManager: 'npm', startCommand: 'npm start' };
    }

    // Check for pnpm-lock.yaml (pnpm)
    const hasPnpmLock = await fs.access(path.join(folder, 'pnpm-lock.yaml')).then(() => true).catch(() => false);
    if (hasPnpmLock) {
      return { packageManager: 'pnpm', startCommand: 'pnpm dev' };
    }

    // Check for yarn.lock (yarn)
    const hasYarnLock = await fs.access(path.join(folder, 'yarn.lock')).then(() => true).catch(() => false);
    if (hasYarnLock) {
      return { packageManager: 'yarn', startCommand: 'yarn start' };
    }

    // Default to npm if no lock file is found
    return { packageManager: 'npm', startCommand: 'npm start' };
  } catch (error) {
    console.error('Error detecting package manager:', error);
    return { packageManager: 'npm', startCommand: 'npm start' };
  }
}

/**
 * Activate the extension
 */
export function activate(context: vscode.ExtensionContext) {
  try {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const provider = new ModuleFederationProvider(workspaceRoot);
    
    // Show initial welcome message
    vscode.window.showInformationMessage('Module Federation Explorer is now active! Looking for remote configurations...');
    provider.log('Extension activated successfully');

    // Register the tree data provider
    vscode.window.registerTreeDataProvider('moduleFederation', provider);

    // Register commands and watchers
    const disposables = [
      vscode.commands.registerCommand('moduleFederation.refresh', () => provider.refresh()),
      
      // Start remote command
      vscode.commands.registerCommand('moduleFederation.startRemote', async (remote: Remote) => {
        try {
          // Detect package manager and start command if not already set
          if (!remote.packageManager || !remote.startCommand) {
            const { packageManager, startCommand } = await detectPackageManagerAndStartCommand(remote.folder);
            remote.packageManager = packageManager;
            remote.startCommand = startCommand;
          }

          const terminal = vscode.window.createTerminal(`${remote.name}`);
          terminal.show();
          terminal.sendText(`cd "${remote.folder}" && ${remote.startCommand}`);
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to start remote ${remote.name}: ${error}`);
        }
      }),

      // Configure start command
      vscode.commands.registerCommand('moduleFederation.configureStartCommand', async (remote: Remote) => {
        try {
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
          remote.startCommand = startCommand;
          
          // Refresh the tree view
          provider.refresh();
          
          vscode.window.showInformationMessage(`Updated start command for ${remote.name}: ${startCommand}`);
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to configure start command for ${remote.name}: ${error}`);
        }
      }),

      vscode.commands.registerCommand('moduleFederation.showWelcome', () => {
        vscode.window.showInformationMessage('Module Federation Explorer activated. Use the view to manage your remotes.');
      })
    ];

    // Add file watcher
    const fileWatcher = vscode.workspace.createFileSystemWatcher(
      '**/{webpack,vite}.config.js',
      true  // ignoreCreateEvents
    );
    fileWatcher.onDidChange(() => provider.refresh());
    fileWatcher.onDidCreate(() => provider.refresh());
    fileWatcher.onDidDelete(() => provider.refresh());
    
    context.subscriptions.push(...disposables, fileWatcher);

  } catch (error) {
    console.error('[Module Federation] Failed to activate extension:', error);
    throw error; // Re-throw to ensure VS Code knows activation failed
  }
}