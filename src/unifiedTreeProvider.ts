import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as fsSync from 'fs'; // Import for synchronous fs operations
import { 
    Remote, 
    ExposedModule, 
    ModuleFederationConfig,
    RemotesFolder,
    ExposesFolder,
    RootFolder,
    UnifiedRootConfig,
    FederationRoot
} from './types';
import { extractConfigFromWebpack, extractConfigFromVite, extractConfigFromModernJS } from './configExtractors';
import { RootConfigManager } from './rootConfigManager';
import { parse } from '@typescript-eslint/parser';
import { outputChannel, log, show, clear } from './outputChannel';
import { DependencyGraphManager } from './dependencyGraph';

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

function isLoadingPlaceholder(element: any): element is LoadingPlaceholder {
  return element && element.type === 'loadingPlaceholder';
}

function isEmptyState(element: any): element is EmptyState {
  return element && element.type === 'emptyState';
}

// Define new interfaces for the loading and empty states
interface LoadingPlaceholder {
  type: 'loadingPlaceholder';
  name: string;
}

interface EmptyState {
  type: 'emptyState';
  name: string;
  description: string;
}

export class UnifiedModuleFederationProvider implements vscode.TreeDataProvider<FederationRoot | RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | LoadingPlaceholder | EmptyState>, 
  vscode.TreeDragAndDropController<FederationRoot | RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | LoadingPlaceholder | EmptyState> {
  private _onDidChangeTreeData: vscode.EventEmitter<FederationRoot | RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | LoadingPlaceholder | EmptyState | undefined> = 
    new vscode.EventEmitter<FederationRoot | RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | LoadingPlaceholder | EmptyState | undefined>();
  
  readonly onDidChangeTreeData: vscode.Event<FederationRoot | RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | LoadingPlaceholder | EmptyState | undefined> = 
    this._onDidChangeTreeData.event;
  
  // DragAndDrop properties required for the controller
  readonly dragMimeTypes = ['application/vnd.code.tree.moduleFederation'];
  readonly dropMimeTypes = ['application/vnd.code.tree.moduleFederation'];

  private rootConfigs: Map<string, ModuleFederationConfig[]> = new Map();
  private rootConfigManager: RootConfigManager;
  private isLoading = false;
  public runningRemotes: Map<string, { terminal: vscode.Terminal }> = new Map();
  // Store running Host app information
  private runningRootApps: Map<string, { terminal: vscode.Terminal }> = new Map();
  
  private dependencyGraphManager: DependencyGraphManager;
  
  constructor(private readonly workspaceRoot: string | undefined, private readonly context: vscode.ExtensionContext) {
    this.rootConfigManager = new RootConfigManager(context);
    this.dependencyGraphManager = new DependencyGraphManager(context);
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
    outputChannel.appendLine(`[${timestamp}] ${message}`);
  }

  // Error logger method
  logError(message: string, error: unknown): void {
    const errorDetails = error instanceof Error ? error.stack || error.message : String(error);
    const timestamp = new Date().toISOString();
    outputChannel.appendLine(`[${timestamp}] ERROR: ${message}:\n${errorDetails}`);
    console.error(`[Module Federation] ${message}:\n`, errorDetails);
    
    // Provide more helpful error messages with user guidance
    let userMessage = `${message}: ${error instanceof Error ? error.message : String(error)}`;
    let actions = [];
    
    // Add specific user guidance based on the error context
    if (message.includes('Failed to load Module Federation configurations')) {
      userMessage = 'Failed to load Module Federation configurations. This might be due to syntax errors in your configuration files.';
      actions.push({
        title: 'Refresh',
        action: () => this.reloadConfigurations()
      });
      actions.push({
        title: 'Show Output Log',
        action: () => outputChannel.show()
      });
    } else if (message.includes('Cannot access Root Host directory')) {
      userMessage = 'Cannot access a Host directory. The directory may have been moved or deleted.';
      actions.push({
        title: 'Remove Invalid Host',
        action: async () => {
          // Find and show all configured roots to allow user to remove the invalid one
          const rootConfig = await this.rootConfigManager.loadRootConfig();
          const rootItems = rootConfig.roots.map(root => ({
            label: path.basename(root),
            description: root,
            rootPath: root
          }));
          
          const selectedRoot = await vscode.window.showQuickPick(rootItems, {
            placeHolder: 'Select a Host to remove',
            title: 'Remove Invalid Host'
          });
          
          if (selectedRoot) {
            await this.rootConfigManager.removeRoot(selectedRoot.rootPath);
            this.reloadConfigurations();
          }
        }
      });
    } else if (message.includes('Failed to process config file')) {
      userMessage = 'Failed to process a Module Federation configuration file. The file may contain syntax errors.';
      actions.push({
        title: 'Show Output Log',
        action: () => outputChannel.show()
      });
    } else if (message.includes('Failed to start remote') || message.includes('Failed to stop remote')) {
      userMessage = `${message}. Check if the remote's configured directory and start commands are correct.`;
      actions.push({
        title: 'Show Output Log',
        action: () => outputChannel.show()
      });
    }
    
    // Show error message with actions if available
    if (actions.length > 0) {
      const actionTitles = actions.map(a => a.title);
      vscode.window.showErrorMessage(userMessage, ...actionTitles).then(selected => {
        const selectedAction = actions.find(a => a.title === selected);
        if (selectedAction) {
          selectedAction.action();
        }
      });
    } else {
      vscode.window.showErrorMessage(userMessage);
    }
  }

  /**
   * Loads Module Federation configurations from all configured roots
   */
  private async loadConfigurations(): Promise<void> {
    if (this.isLoading) return;
    
    try {
      this.isLoading = true;
      this.rootConfigs.clear();
      
      // Show a progress notification
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Module Federation Explorer',
          cancellable: false
        },
        async (progress) => {
          progress.report({ message: 'Loading configurations...' });
          
          // Load Host configuration from settings
          const rootConfig = await this.rootConfigManager.loadRootConfig();
          if (!rootConfig.roots || rootConfig.roots.length === 0) {
            this.log('No roots configured. Configure at least one Host directory.');
            // Set context to show welcome view when no roots are configured
            vscode.commands.executeCommand('setContext', 'moduleFederation.hasRoots', false);
            return;
          }

          this.log(`Found ${rootConfig.roots.length} configured roots`);
          
          // Process each Host
          for (const [index, rootPath] of rootConfig.roots.entries()) {
            progress.report({ 
              message: `Processing host ${index + 1}/${rootConfig.roots.length}: ${path.basename(rootPath)}`,
              increment: (100 / rootConfig.roots.length) 
            });
            await this.processRoot(rootPath);
          }

          progress.report({ message: 'Loading host configurations...' });
          // Load Host folder configurations (start commands, etc.)
          await this.loadRootFolderConfigs();
          
          progress.report({ message: 'Loading remote configurations...' });
          // Load remote configurations
          await this.loadRemoteConfigurations();

          // Set context based on whether any roots were found
          vscode.commands.executeCommand('setContext', 'moduleFederation.hasRoots', this.rootConfigs.size > 0);
          
          this.log('Finished loading configurations from all roots');
        }
      );
      
      this._onDidChangeTreeData.fire(undefined);
      
    } catch (error) {
      this.logError('Failed to load Module Federation configurations', error);
      vscode.window.showErrorMessage('Failed to load Module Federation configurations. See output panel for details.');
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Process a specific Host directory to find and load MFE configurations
   */
  private async processRoot(rootPath: string): Promise<void> {
    try {
      this.log(`Processing Root Host: ${rootPath}`);
      
      // Check if the directory exists
      try {
        const stats = await fs.stat(rootPath);
        if (!stats.isDirectory()) {
          this.logError(`Path is not a directory`, rootPath);
          return;
        }
      } catch (error) {
        this.logError(`Cannot access Root Host directory`, rootPath);
        return;
      }

      // Find all webpack, vite, and ModernJS config files in this Host, excluding node_modules
      const [webpackFiles, viteFiles, modernJSFiles] = await Promise.all([
        this.findFiles(rootPath, '**/{webpack.config.js,webpack.config.ts}', '**/node_modules/**'),
        this.findFiles(rootPath, '**/{vite.config.js,vite.config.ts}', '**/node_modules/**'),
        this.findFiles(rootPath, '**/module-federation.config.{js,ts}', '**/node_modules/**')
      ]);

      this.log(`Found ${webpackFiles.length} webpack configs, ${viteFiles.length} vite configs, and ${modernJSFiles.length} ModernJS configs in ${rootPath}`);

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
      
      // Process ModernJS configs
      const modernJSConfigs = await this.processConfigFiles(
        modernJSFiles,
        extractConfigFromModernJS,
        'modernjs',
        rootPath
      );
      
      // Store configs for this Host
      const configs = [...webpackConfigs, ...viteConfigs, ...modernJSConfigs];
      if (configs.length > 0) {
        this.rootConfigs.set(rootPath, configs);
        
        // Count total remotes and exposes
        const totalRemotes = configs.reduce((acc, config) => acc + config.remotes.length, 0);
        const totalExposes = configs.reduce((acc, config) => acc + config.exposes.length, 0);
        
        this.log(`SUMMARY FOR ROOT ${path.basename(rootPath)}: Found ${configs.length} configurations with a total of ${totalRemotes} remotes and ${totalExposes} exposes`);
        
        if (totalRemotes > 0) {
          const remoteNames = configs.flatMap(config => config.remotes.map(r => r.name));
          this.log(`All remotes in ${path.basename(rootPath)}: ${remoteNames.join(', ')}`);
        }
        
        if (totalExposes > 0) {
          const exposeNames = configs.flatMap(config => config.exposes.map(e => e.name));
          this.log(`All exposes in ${path.basename(rootPath)}: ${exposeNames.join(', ')}`);
        }
      } else {
        this.log(`No Module Federation configurations found in ${rootPath}`);
      }
    } catch (error) {
      this.logError(`Failed to process Root Host ${rootPath}`, error);
    }
  }

  /**
   * Find files matching pattern in a directory
   */
  private async findFiles(rootPath: string, pattern: string, excludePattern: string): Promise<string[]> {
    try {
      // Create a glob pattern relative to the Host path
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
        
        // Log what we found in this config file
        this.log(`Found in ${relativeConfigPath}: name=${config.name}, remotes=${config.remotes.length}, exposes=${config.exposes.length}`);
        if (config.remotes.length > 0) {
          this.log(`Remotes found in ${relativeConfigPath}: ${config.remotes.map(r => r.name).join(', ')}`);
        }
        if (config.exposes.length > 0) {
          this.log(`Exposes found in ${relativeConfigPath}: ${config.exposes.map(e => e.name).join(', ')}`);
        }
      } catch (error) {
        this.logError(`Error processing ${file}`, error);
      }
    }
    
    // Log summary for this config type
    const totalRemotes = results.reduce((acc, cfg) => acc + cfg.remotes.length, 0);
    const totalExposes = results.reduce((acc, cfg) => acc + cfg.exposes.length, 0);
    this.log(`Summary for ${configType} configs: found ${results.length} configs with ${totalRemotes} remotes and ${totalExposes} exposes`);
    
    return results;
  }

  getTreeItem(element: FederationRoot | RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | LoadingPlaceholder | EmptyState): vscode.TreeItem {
    // Handle loading placeholder
    if (isLoadingPlaceholder(element)) {
      const treeItem = new vscode.TreeItem(
        'Loading Module Federation configurations...',
        vscode.TreeItemCollapsibleState.None
      );
      treeItem.iconPath = new vscode.ThemeIcon('loading~spin');
      return treeItem;
    }
    
    // Handle empty state
    if (isEmptyState(element)) {
      const treeItem = new vscode.TreeItem(
        element.name,
        vscode.TreeItemCollapsibleState.None
      );
      treeItem.description = element.description;
      treeItem.iconPath = new vscode.ThemeIcon('info');
      treeItem.tooltip = new vscode.MarkdownString(
        '**No Module Federation Hosts found**\n\n' +
        'To get started:\n\n' +
        '1. Click the "+" button in the toolbar to add a Host folder\n' +
        '2. Select a folder containing Module Federation configurations\n' +
        '3. The extension will automatically scan for webpack, Vite, or ModernJS configurations'
      );
      return treeItem;
    }
    
    if (isFederationRoot(element)) {
      // If it's a federation root (top level)
      const treeItem = new vscode.TreeItem(
        element.name,
        vscode.TreeItemCollapsibleState.Expanded
      );
      treeItem.tooltip = new vscode.MarkdownString(`## ${element.name}\n\n**Path:** ${element.path}\n\n${element.configs.length} configurations found`);
      treeItem.iconPath = new vscode.ThemeIcon('server');
      return treeItem;
    } else if (isRootFolder(element)) {
      // If it's a root folder
      const treeItem = new vscode.TreeItem(
        element.name,
        vscode.TreeItemCollapsibleState.Expanded
      );
      
      // Better tooltip with markdown formatting
      let tooltip = new vscode.MarkdownString(`## ${element.name}\n\n**Path:** ${element.path}\n\n`);
      
      if (element.configs.length > 0) {
        tooltip.appendMarkdown(`**Configuration files:**\n\n`);
        element.configs.forEach(config => {
          tooltip.appendMarkdown(`- ${path.basename(config.configPath)}\n`);
        });
      }
      
      if (element.startCommand) {
        tooltip.appendMarkdown(`\n**Start command:** \`${element.startCommand}\``);
      }
      
      if (element.isRunning) {
        tooltip.appendMarkdown(`\n\n$(play) **Running**`);
        treeItem.iconPath = new vscode.ThemeIcon('vm-running');
        treeItem.contextValue = 'runningRootApp';
      } else if (element.startCommand) {
        treeItem.iconPath = new vscode.ThemeIcon('vm');
        treeItem.contextValue = 'configurableRootApp';
      } else {
        treeItem.iconPath = new vscode.ThemeIcon('folder');
        treeItem.contextValue = 'rootFolder';
      }
      
      treeItem.tooltip = tooltip;
      return treeItem;
    } else if (isRemotesFolder(element)) {
      // If it's a remotes folder
      const treeItem = new vscode.TreeItem(
        `Remotes (${element.remotes.length})`,
        element.remotes.length > 0 
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.None
      );
      treeItem.iconPath = new vscode.ThemeIcon('references');
      treeItem.tooltip = new vscode.MarkdownString(`## Remotes\n\n${element.remotes.length} remotes imported by ${element.parentName}`);
      treeItem.contextValue = 'remotesFolder';
      return treeItem;
    } else if (isExposesFolder(element)) {
      // If it's an exposes folder
      const treeItem = new vscode.TreeItem(
        `Exposed Modules (${element.exposes.length})`,
        element.exposes.length > 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.None
      );
      treeItem.iconPath = new vscode.ThemeIcon('export');
      treeItem.tooltip = new vscode.MarkdownString(`## Exposed Modules\n\n${element.exposes.length} modules exposed by ${element.parentName}`);
      treeItem.contextValue = 'exposesFolder';
      return treeItem;
    } else if (isRemote(element)) {
      // If it's a remote
      const isRunning = this.runningRemotes.has(`remote-${element.name}`);
      const hasFolder = !!element.folder;
      const hasStartCommand = !!element.startCommand;
      
      const treeItem = new vscode.TreeItem(
        element.name,
        vscode.TreeItemCollapsibleState.None
      );
      
      // Create rich tooltip with configuration details
      let tooltip = new vscode.MarkdownString(`## Remote: ${element.name}\n\n`);
      
      if (element.url) {
        tooltip.appendMarkdown(`**URL:** ${element.url}\n\n`);
      }
      
      if (element.remoteEntry) {
        tooltip.appendMarkdown(`**Remote entry:** ${element.remoteEntry}\n\n`);
      }
      
      if (element.folder) {
        tooltip.appendMarkdown(`**Folder:** ${element.folder}\n\n`);
      }
      
      if (element.startCommand) {
        tooltip.appendMarkdown(`**Start command:** \`${element.startCommand}\`\n\n`);
      }
      
      if (element.buildCommand) {
        tooltip.appendMarkdown(`**Build command:** \`${element.buildCommand}\`\n\n`);
      }
      
      tooltip.appendMarkdown(`**Config type:** ${element.configType}`);
      
      if (isRunning) {
        tooltip.appendMarkdown(`\n\n$(play) **Running**`);
        treeItem.iconPath = new vscode.ThemeIcon('vm-running');
        treeItem.contextValue = 'runningRemote';
      } else if (hasFolder && hasStartCommand) {
        treeItem.iconPath = new vscode.ThemeIcon('vm');
        treeItem.contextValue = 'remote';
      } else {
        treeItem.iconPath = new vscode.ThemeIcon('vm-outline');
        treeItem.contextValue = 'unconfiguredRemote';
      }
      
      // Add description if URL is available
      if (element.url) {
        treeItem.description = element.url;
      }
      
      treeItem.tooltip = tooltip;
      return treeItem;
    } else if (isExposedModule(element)) {
      // If it's an exposed module
      const treeItem = new vscode.TreeItem(
        element.name,
        vscode.TreeItemCollapsibleState.None
      );
      
      treeItem.iconPath = new vscode.ThemeIcon('symbol-module');
      treeItem.tooltip = new vscode.MarkdownString(`## Exposed Module: ${element.name}\n\n**Path:** ${element.path}\n\n**From remote:** ${element.remoteName}`);
      treeItem.description = element.path;
      treeItem.command = {
        command: 'moduleFederation.openExposedPath',
        arguments: [element],
        title: 'Open File'
      };
      
      return treeItem;
    }
    
    throw new Error(`Unknown element type`);
  }

  getChildren(element?: FederationRoot | RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | LoadingPlaceholder | EmptyState): Thenable<(FederationRoot | RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | LoadingPlaceholder | EmptyState)[]> {
    try {
      // If we're still loading, show a loading placeholder
      if (this.isLoading) {
        return Promise.resolve([{
          type: 'loadingPlaceholder',
          name: 'Loading configurations...'
        } as LoadingPlaceholder]);
      }
      
      // Root element
      if (!element) {
        return this.getRootFolders().then(rootFolders => {
          if (rootFolders.length === 0) {
            // Return empty array to allow viewsWelcome to be shown instead
            return [];
          }
          return rootFolders;
        });
      } else if (isFederationRoot(element)) {
        // Return all configured Host folders
        return this.getRootFolders();
      } else if (isRootFolder(element)) {
        // Show remotes folder and exposes folder for this Host
        const children: (RemotesFolder | ExposesFolder)[] = [];
        
        // Collect all remotes and exposes from this Host's configs
        const allRemotes = element.configs.flatMap(config => config.remotes);
        const allExposes = element.configs.flatMap(config => config.exposes);
        
        this.log(`Building tree for Host folder ${element.name}:`);
        this.log(`- Found ${element.configs.length} configs with ${allRemotes.length} remotes and ${allExposes.length} exposes`);
        
        if (allRemotes.length > 0) {
          this.log(`- Remotes to display: ${allRemotes.map(r => r.name).join(', ')}`);
        } else {
          this.log(`- No remotes found to display`);
        }
        
        if (allExposes.length > 0) {
          this.log(`- Exposes to display: ${allExposes.map(e => e.name).join(', ')}`);
        } else {
          this.log(`- No exposes found to display`);
        }
        
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
        
        this.log(`- Generated ${children.length} tree folders for ${element.name}`);
        
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
    } catch (error) {
      this.logError('Failed to get children', error);
      return Promise.resolve([]);
    }
  }

  /**
   * Get Host folders with their configurations
   */
  private async getRootFolders(): Promise<RootFolder[]> {
    const rootFolders: RootFolder[] = [];
    
    // Get the Host configuration
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
    
    // Set context variable to show/hide the welcome view
    vscode.commands.executeCommand('setContext', 'moduleFederation.hasRoots', rootFolders.length > 0);
    
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
   * Add a new Host to the configuration
   */
  async addRoot(): Promise<void> {
    try {
      const selectedFolder = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Host Folder',
        title: 'Select a folder to add to the Module Federation Explorer'
      });

      if (!selectedFolder || selectedFolder.length === 0) {
        return;
      }

      const rootPath = selectedFolder[0].fsPath;
      await this.rootConfigManager.addRoot(rootPath);
      
      // Process the new Host
      await this.processRoot(rootPath);
      
      // Update context to reflect that there are roots
      vscode.commands.executeCommand('setContext', 'moduleFederation.hasRoots', true);
      
      // Refresh the tree view
      this._onDidChangeTreeData.fire(undefined);
      
      vscode.window.showInformationMessage(`Added Host ${rootPath} to configuration`);
    } catch (error) {
      this.logError(`Failed to add Host`, error);
      vscode.window.showErrorMessage(`Failed to add Host: ${error}`);
    }
  }

  /**
   * Remove a Host from the configuration
   */
  async removeRoot(rootFolder: RootFolder): Promise<void> {
    try {
      this.log(`Removing Host ${rootFolder.path}`);
      
      // Confirm with user
      const confirmed = await vscode.window.showWarningMessage(
        `Are you sure you want to remove "${rootFolder.path}" from the configuration?`,
        { modal: true },
        'Yes'
      );
      
      if (!confirmed) {
        return;
      }
      
      // Remove this Host from the configuration
      await this.rootConfigManager.removeRoot(rootFolder.path);
      
      // Remove this Host from the configs map
      this.rootConfigs.delete(rootFolder.path);
      
      // Update context based on remaining roots
      vscode.commands.executeCommand('setContext', 'moduleFederation.hasRoots', this.rootConfigs.size > 0);
      
      // Refresh the tree view
      this._onDidChangeTreeData.fire(undefined);
      
      vscode.window.showInformationMessage(`Removed Host ${rootFolder.path} from configuration`);
    } catch (error) {
      this.logError(`Failed to remove Host ${rootFolder.path}`, error);
      vscode.window.showErrorMessage(`Failed to remove Host: ${error}`);
    }
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
   * Check if a Host app is running
   */
  private isRootAppRunning(rootPath: string): boolean {
    return this.runningRootApps.has(rootPath);
  }

  /**
   * Start a Host app
   */
  async startRootApp(rootFolder: RootFolder): Promise<void> {
    try {
      const rootPath = rootFolder.path;
      this.log(`Starting Host app: ${rootPath}`);
      
      // Check if already running
      if (this.isRootAppRunning(rootPath)) {
        vscode.window.showInformationMessage(`Host app is already running: ${rootFolder.name}`);
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
      const terminal = vscode.window.createTerminal(`MFE App: ${rootFolder.name}`);
      terminal.show();
      terminal.sendText(`cd "${rootPath}" && ${rootFolder.startCommand}`);
      
      // Store the running app
      this.runningRootApps.set(rootPath, { terminal });
      
      // Refresh the tree view
      this.refresh();
      
      vscode.window.showInformationMessage(`Started Host app: ${rootFolder.name}`);
    } catch (error) {
      this.logError(`Failed to start Host app: ${rootFolder.name}`, error);
    }
  }
  
  /**
   * Stop a running Host app
   */
  async stopRootApp(rootFolder: RootFolder): Promise<void> {
    try {
      const rootPath = rootFolder.path;
      this.log(`Stopping Host app: ${rootPath}`);
      
      // Check if it's running
      const runningApp = this.runningRootApps.get(rootPath);
      if (!runningApp) {
        vscode.window.showInformationMessage(`Host app is not running: ${rootFolder.name}`);
        return;
      }
      
      // Dispose the terminal
      runningApp.terminal.dispose();
      this.runningRootApps.delete(rootPath);
      
      // Refresh the tree view
      this.refresh();
      
      vscode.window.showInformationMessage(`Stopped Host app: ${rootFolder.name}`);
    } catch (error) {
      this.logError(`Failed to stop Host app: ${rootFolder.name}`, error);
    }
  }
  
  /**
   * Configure start command for a Host app
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
      
      // Update the Host folder start command
      rootFolder.startCommand = startCommand;
      
      // Save Host folder configuration
      await this.saveRootFolderConfig(rootFolder);
      
      // Refresh the tree view
      this.refresh();
      
      vscode.window.showInformationMessage(`Configured start command for ${rootFolder.name}: ${startCommand}`);
      return startCommand;
    } catch (error) {
      this.logError(`Failed to configure start command for Host app: ${rootFolder.name}`, error);
      return undefined;
    }
  }
  
  /**
   * Save Host folder configuration
   */
  private async saveRootFolderConfig(rootFolder: RootFolder): Promise<void> {
    try {
      const configPath = await this.rootConfigManager.getConfigPath();
      if (!configPath) {
        this.logError(`Failed to save Host folder config for ${rootFolder.name}`, 'No configuration path found');
        return;
      }
      
      // Get current config
      const config = await this.rootConfigManager.loadRootConfig();
      
      // Create or update the configs property if it doesn't exist
      if (!config.rootConfigs) {
        config.rootConfigs = {};
      }
      
      // Save the Host folder configuration
      config.rootConfigs[rootFolder.path] = {
        startCommand: rootFolder.startCommand
      };
      
      // Save the config
      await this.rootConfigManager.saveRootConfig(config);
      
      this.log(`Saved Host folder configuration for ${rootFolder.name}`);
    } catch (error) {
      this.logError(`Failed to save Host folder config for ${rootFolder.name}`, error);
    }
  }
  
  /**
   * Load Host folder configurations
   */
  private async loadRootFolderConfigs(): Promise<void> {
    try {
      const config = await this.rootConfigManager.loadRootConfig();
      
      // If no Host configs property, nothing to load
      if (!config.rootConfigs) {
        return;
      }
      
      // Update Host folder configurations
      for (const [rootPath, configs] of this.rootConfigs.entries()) {
        const rootConfig = config.rootConfigs[rootPath];
        if (rootConfig) {
          // Update the Host folder in the tree view
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
      
      this.log('Loaded Host folder configurations');
    } catch (error) {
      this.logError('Failed to load Host folder configurations', error);
    }
  }

  /**
   * Clear all running remotes and Host apps - used when the extension is reactivated
   */
  clearAllRunningApps(): void {
    this.runningRemotes.clear();
    this.runningRootApps.clear();
  }

  /**
   * Resolve the proper folder path for a remote using configured roots
   */
  private resolveRemoteFolderPath(remote: Remote): string {
    // First check if we have a fully qualified path already
    if (path.isAbsolute(remote.folder)) {
      return remote.folder;
    }
    
    // Try to find the remote in one of our configured roots
    for (const [rootPath, configs] of this.rootConfigs.entries()) {
      const remoteFolderPath = path.join(rootPath, remote.folder);
      try {
        if (fsSync.existsSync(remoteFolderPath) && fsSync.statSync(remoteFolderPath).isDirectory()) {
          this.log(`Resolved remote ${remote.name} folder path to: ${remoteFolderPath}`);
          return remoteFolderPath;
        }
      } catch (error) {
        // Ignore errors, just continue checking other roots
      }
    }
    
    // If no match found, use the first Host as default
    const rootPaths = Array.from(this.rootConfigs.keys());
    if (rootPaths.length > 0) {
      const defaultPath = path.join(rootPaths[0], remote.folder);
      this.log(`Using default folder path for remote ${remote.name}: ${defaultPath}`);
      return defaultPath;
    }
    
    // Fallback to workspace Host if available
    if (this.workspaceRoot) {
      const workspacePath = path.join(this.workspaceRoot, remote.folder);
      this.log(`Using workspace Host for remote ${remote.name}: ${workspacePath}`);
      return workspacePath;
    }
    
    // Last resort, just return the relative path
    return remote.folder;
  }

  /**
   * Save remote configuration in the unified Host config
   */
  async saveRemoteConfiguration(remote: Remote): Promise<void> {
    try {
      this.log(`Saving configuration for remote ${remote.name}`);
      
      // Get current config
      const config = await this.rootConfigManager.loadRootConfig();
      
      // Find the appropriate Host for this remote
      const resolvedFolderPath = this.resolveRemoteFolderPath(remote);
      let rootPath = '';
      
      // Find which Host contains this remote
      for (const configuredRoot of config.roots) {
        if (resolvedFolderPath.startsWith(configuredRoot)) {
          rootPath = configuredRoot;
          break;
        }
      }
      
      // If no matching Host found, use the first Host
      if (!rootPath && config.roots.length > 0) {
        rootPath = config.roots[0];
      }
      
      // Ensure rootConfigs exists
      if (!config.rootConfigs) {
        config.rootConfigs = {};
      }
      
      // Ensure the config for this Host exists
      if (!config.rootConfigs[rootPath]) {
        config.rootConfigs[rootPath] = {};
      }
      
      // Ensure remotes section exists for this Host
      if (!config.rootConfigs[rootPath].remotes) {
        config.rootConfigs[rootPath].remotes = {};
      }
      
      // Store remote configuration
      config.rootConfigs[rootPath].remotes![remote.name] = {
        name: remote.name,
        url: remote.url,
        folder: remote.folder, // Just the name, not full path
        packageManager: remote.packageManager,
        configType: remote.configType,
        startCommand: remote.startCommand,
        buildCommand: remote.buildCommand
      };
      
      // Save the config
      await this.rootConfigManager.saveRootConfig(config);
      
      this.log(`Saved configuration for remote ${remote.name} in Host ${rootPath}`);
    } catch (error) {
      this.logError(`Failed to save configuration for remote ${remote.name}`, error);
    }
  }

  /**
   * Load remote configurations from the unified Host config
   */
  async loadRemoteConfigurations(): Promise<void> {
    try {
      // Get current config
      const config = await this.rootConfigManager.loadRootConfig();
      
      // Check if rootConfigs section exists
      if (!config.rootConfigs) {
        this.log('No saved Host configurations found');
        return;
      }
      
      // Go through each Host configuration
      for (const [rootPath, rootConfig] of Object.entries(config.rootConfigs)) {
        // Skip if no remotes section
        if (!rootConfig.remotes) {
          continue;
        }
        
        // Process each remote in this Host
        for (const [remoteName, savedRemote] of Object.entries(rootConfig.remotes)) {
          // Find the remote in our configs
          for (const [configRootPath, configs] of this.rootConfigs.entries()) {
            for (const mfeConfig of configs) {
              for (const remote of mfeConfig.remotes) {
                if (remote.name === remoteName) {
                  this.log(`Updating remote ${remote.name} with saved configuration from Host ${rootPath}`);
                  // Update properties from saved config
                  remote.folder = savedRemote.folder || remote.name;
                  remote.url = savedRemote.url || remote.url;
                  remote.packageManager = savedRemote.packageManager || remote.packageManager;
                  remote.startCommand = savedRemote.startCommand || remote.startCommand;
                  remote.buildCommand = savedRemote.buildCommand || remote.buildCommand;
                }
              }
            }
          }
        }
      }
      
      this.log('Loaded remote configurations from unified config');
    } catch (error) {
      this.logError('Failed to load remote configurations', error);
    }
  }

  /**
   * Shows the dependency graph visualization
   */
  async showDependencyGraph(): Promise<void> {
    try {
      this.log('Generating dependency graph...');
      
      // Check if we have any configurations loaded
      if (this.rootConfigs.size === 0) {
        this.log('No Host configurations found for dependency graph');
        vscode.window.showInformationMessage('No Module Federation configurations found. Please add a Host folder first.');
        return;
      }
      
      // Debug log the currently loaded configurations
      let totalRemotes = 0;
      let totalExposes = 0;
      
      for (const [rootPath, configs] of this.rootConfigs.entries()) {
        for (const config of configs) {
          totalRemotes += config.remotes.length;
          totalExposes += config.exposes.length;
          this.log(`Configuration: ${config.name}, Remotes: ${config.remotes.length}, Exposes: ${config.exposes.length}`);
          
          if (config.remotes.length > 0) {
            this.log(`Remotes in ${config.name}: ${config.remotes.map(r => r.name).join(', ')}`);
          }
        }
      }
      
      this.log(`Total configurations: ${this.rootConfigs.size}, Total remotes: ${totalRemotes}, Total exposes: ${totalExposes}`);
      
      const graph = this.dependencyGraphManager.generateDependencyGraph(this.rootConfigs);
      this.log(`Generated graph with ${graph.nodes.length} nodes and ${graph.edges.length} edges`);
      
      // Show the graph
      this.dependencyGraphManager.showDependencyGraph(graph);
      this.log('Dependency graph opened');
    } catch (error) {
      this.logError('Failed to generate dependency graph', error);
      vscode.window.showErrorMessage(`Failed to generate dependency graph: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Resolve the file extension for a path without extension based on project type
   */
  public async resolveFileExtensionForPath(basePath: string): Promise<string> {
    try {
      this.log(`Resolving path: ${basePath}`);
      
      // If path already points to an existing file, return it directly
      if (fsSync.existsSync(basePath) && fsSync.statSync(basePath).isFile()) {
        return basePath;
      }
      
      // Check if the path exists and is a directory
      if (fsSync.existsSync(basePath) && fsSync.statSync(basePath).isDirectory()) {
        this.log(`Path is a directory: ${basePath}, scanning contents`);
        
        // Read the directory contents
        const dirContents = fsSync.readdirSync(basePath);
        
        // First, try to detect project type by looking for configuration files
        let projectType: 'react' | 'vue' | 'angular' | 'svelte' | 'unknown' = 'unknown';
        
        if (dirContents.some(file => file.includes('tsconfig.json'))) {
          if (dirContents.some(file => file.includes('angular.json') || file.includes('angular-cli.json'))) {
            projectType = 'angular';
          } else if (dirContents.some(file => file.includes('react-app-env.d.ts'))) {
            projectType = 'react';
          }
        }
        
        if (projectType === 'unknown' && dirContents.some(file => file.includes('package.json'))) {
          try {
            const packageJsonPath = path.join(basePath, 'package.json');
            const packageJson = JSON.parse(fsSync.readFileSync(packageJsonPath, 'utf8'));
            const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
            
            if (dependencies.react) {
              projectType = 'react';
            } else if (dependencies.vue) {
              projectType = 'vue';
            } else if (dependencies.angular || dependencies['@angular/core']) {
              projectType = 'angular';
            } else if (dependencies.svelte) {
              projectType = 'svelte';
            }
          } catch (err) {
            // Silently handle package.json parsing errors
            this.log(`Error parsing package.json: ${err}`);
          }
        }
        
        this.log(`Detected project type: ${projectType}`);
        
        // Order of file name patterns to check (priority order)
        const filePatterns = ['index', 'main', 'app', 'entry'];
        
        // Extensions ordered by priority based on project type
        const getExtensionPriority = () => {
          if (projectType === 'react') {
            return ['.tsx', '.jsx', '.ts', '.js'];
          } else if (projectType === 'vue') {
            return ['.vue', '.ts', '.js'];
          } else if (projectType === 'angular') {
            return ['.component.ts', '.component.html', '.ts', '.js'];
          } else if (projectType === 'svelte') {
            return ['.svelte', '.ts', '.js'];
          } else {
            return ['.ts', '.js', '.tsx', '.jsx', '.vue', '.svelte'];
          }
        };
        
        const prioritizedExtensions = getExtensionPriority();
        
        // First look for these specific filenames with priority extensions
        for (const pattern of filePatterns) {
          // Check for exact matches with prioritized extensions
          for (const ext of prioritizedExtensions) {
            const exactFilename = `${pattern}${ext}`;
            if (dirContents.includes(exactFilename)) {
              const match = path.join(basePath, exactFilename);
              this.log(`Found exact match: ${match}`);
              return match;
            }
          }
          
          // If no exact match, look for files starting with the pattern
          const matchingFiles = dirContents.filter(file => 
            file.startsWith(`${pattern}.`) || file === pattern);
            
          if (matchingFiles.length > 0) {
            // Sort by extension priority
            const sortedFiles = matchingFiles.sort((a, b) => {
              const extA = path.extname(a);
              const extB = path.extname(b);
              
              const indexA = prioritizedExtensions.indexOf(extA);
              const indexB = prioritizedExtensions.indexOf(extB);
              
              // If both have prioritized extensions, compare them
              if (indexA !== -1 && indexB !== -1) {
                return indexA - indexB;
              }
              
              // If only one has a prioritized extension, prefer it
              if (indexA !== -1) return -1;
              if (indexB !== -1) return 1;
              
              // Default alphabetical sort
              return a.localeCompare(b);
            });
            
            const bestMatch = path.join(basePath, sortedFiles[0]);
            this.log(`Found best matching file: ${bestMatch}`);
            return bestMatch;
          }
        }
        
        // If no standard pattern files found, look for any file with prioritized extensions
        for (const ext of prioritizedExtensions) {
          const filesWithExt = dirContents.filter(file => file.endsWith(ext));
          if (filesWithExt.length > 0) {
            // Sort alphabetically - typically would prioritize shorter names
            const sortedFiles = filesWithExt.sort((a, b) => {
              // Prefer shorter filenames (likely to be more "main" files)
              if (a.length !== b.length) {
                return a.length - b.length;
              }
              return a.localeCompare(b);
            });
            
            const bestMatch = path.join(basePath, sortedFiles[0]);
            this.log(`Found file with extension ${ext}: ${bestMatch}`);
            return bestMatch;
          }
        }
        
        // If no match found, return the directory itself
        this.log(`No suitable file found in directory, returning directory path`);
        return basePath;
      }
      
      // Not a directory or doesn't exist
      // If it doesn't have an extension, try to guess based on existing files in parent dir
      if (!path.extname(basePath)) {
        const dirPath = path.dirname(basePath);
        const baseName = path.basename(basePath);
        
        if (fsSync.existsSync(dirPath) && fsSync.statSync(dirPath).isDirectory()) {
          // Read directory contents
          const dirContents = fsSync.readdirSync(dirPath);
          
          // Try exact filename matches with common extensions
          const commonExts = ['.ts', '.js', '.tsx', '.jsx', '.vue', '.svelte', '.component.ts'];
          for (const ext of commonExts) {
            const candidateFile = `${baseName}${ext}`;
            if (dirContents.includes(candidateFile)) {
              const match = path.join(dirPath, candidateFile);
              this.log(`Found exact file match with extension: ${match}`);
              return match;
            }
          }
          
          // No exact extension match, try files that start with the basename
          const matchingFiles = dirContents.filter(file => 
            file.startsWith(`${baseName}.`) || file === baseName);
            
          if (matchingFiles.length > 0) {
            // Sort by extension preference
            const sortedFiles = matchingFiles.sort((a, b) => {
              // Prefer TypeScript over JavaScript
              const extA = path.extname(a);
              const extB = path.extname(b);
              
              // Predefined order of extensions
              const order = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte'];
              const indexA = order.indexOf(extA);
              const indexB = order.indexOf(extB);
              
              if (indexA !== -1 && indexB !== -1) {
                return indexA - indexB;
              }
              
              // If only one is in order, prefer it
              if (indexA !== -1) return -1;
              if (indexB !== -1) return 1;
              
              return a.localeCompare(b);
            });
            
            const bestMatch = path.join(dirPath, sortedFiles[0]);
            this.log(`Found matching file: ${bestMatch}`);
            return bestMatch;
          }
        }
        
        // Special case: Check if the path itself with a common extension exists
        const commonExts = ['.ts', '.js', '.tsx', '.jsx', '.vue', '.svelte', '.component.ts'];
        for (const ext of commonExts) {
          const pathWithExt = `${basePath}${ext}`;
          if (fsSync.existsSync(pathWithExt)) {
            this.log(`Found file with appended extension: ${pathWithExt}`);
            return pathWithExt;
          }
        }
      }
      
      // If no match found or the file already has an extension, return original path
      return basePath;
    } catch (error) {
      this.logError(`Failed to resolve file extension for path: ${basePath}`, error);
      return basePath;
    }
  }

  /**
   * Handles the drag event when an item is dragged in the tree view
   */
  handleDrag(source: readonly (FederationRoot | RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | LoadingPlaceholder | EmptyState)[], 
    dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
    // Only allow dragging root folders
    if (source.length === 1 && isRootFolder(source[0])) {
      // Set the drag data
      dataTransfer.set('application/vnd.code.tree.moduleFederation', 
        new vscode.DataTransferItem(source[0]));
    }
  }

  /**
   * Handles the drop event when an item is dropped in the tree view
   */
  async handleDrop(target: FederationRoot | RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | LoadingPlaceholder | EmptyState | undefined, 
    dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
    const draggedItem = dataTransfer.get('application/vnd.code.tree.moduleFederation')?.value;
    
    // Only allow reordering of root folders
    if (!draggedItem || !isRootFolder(draggedItem)) {
      return;
    }

    // Only allow dropping at the root level or onto another root folder
    if (target && !isRootFolder(target)) {
      return;
    }

    try {
      this.log(`Reordering root folder ${draggedItem.name}`);
      
      // Load the current configuration
      const rootConfig = await this.rootConfigManager.loadRootConfig();
      const rootPaths = [...rootConfig.roots];
      
      // Get the current indices
      const sourceIndex = rootPaths.findIndex(path => path === draggedItem.path);
      
      if (sourceIndex === -1) {
        this.log(`Cannot find the source root folder ${draggedItem.name} in configuration`);
        return;
      }

      // If target is undefined, move to the end
      let targetIndex = rootPaths.length - 1;
      
      // If target is defined, find its index
      if (target) {
        const newTargetIndex = rootPaths.findIndex(path => path === (target as RootFolder).path);
        if (newTargetIndex !== -1) {
          targetIndex = newTargetIndex;
        }
      }
      
      // Remove the item from the source position
      const [removedItem] = rootPaths.splice(sourceIndex, 1);
      
      // Adjust the target position if needed
      // If source was before target, the target index needs to be reduced by 1
      if (sourceIndex < targetIndex) {
        targetIndex--;
      }
      
      // Insert the item at the target position
      rootPaths.splice(targetIndex + 1, 0, removedItem);
      
      // Update the configuration
      rootConfig.roots = rootPaths;
      
      // Save the updated configuration
      await this.rootConfigManager.saveRootConfig(rootConfig);
      
      // Reload the configurations to reflect the changes
      await this.reloadConfigurations();
      
      this.log(`Root folder ${draggedItem.name} moved to position ${targetIndex + 1}`);
    } catch (error) {
      this.logError('Failed to reorder root folders', error);
      vscode.window.showErrorMessage('Failed to reorder root folders. See output panel for details.');
    }
  }
}
