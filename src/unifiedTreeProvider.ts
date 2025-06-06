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
    UnifiedRootConfig
} from './types';
import { extractConfigFromWebpack, extractConfigFromVite, extractConfigFromModernJS, extractConfigFromRSBuild } from './configExtractors';
import { RootConfigManager } from './rootConfigManager';
import { parse } from '@typescript-eslint/parser';
import { outputChannel, log } from './outputChannel';
import { DependencyGraphManager } from './dependencyGraph';
import { DialogUtils } from './dialogUtils';

// Type guard functions to narrow down types

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

export class UnifiedModuleFederationProvider implements vscode.TreeDataProvider<RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | LoadingPlaceholder | EmptyState>, 
  vscode.TreeDragAndDropController<RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | LoadingPlaceholder | EmptyState> {
  private _onDidChangeTreeData: vscode.EventEmitter<RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | LoadingPlaceholder | EmptyState | undefined> = 
    new vscode.EventEmitter<RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | LoadingPlaceholder | EmptyState | undefined>();
  
  readonly onDidChangeTreeData: vscode.Event<RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | LoadingPlaceholder | EmptyState | undefined> = 
    this._onDidChangeTreeData.event;
  
  // DragAndDrop properties required for the controller
  readonly dragMimeTypes = ['application/vnd.code.tree.moduleFederation'];
  readonly dropMimeTypes = ['application/vnd.code.tree.moduleFederation'];

  private rootConfigs: Map<string, ModuleFederationConfig[]> = new Map();
  private rootConfigManager: RootConfigManager;
  private isLoading = false;
  public runningRemotes: Map<string, { buildTerminal?: vscode.Terminal; startTerminal: vscode.Terminal }> = new Map();
  // Store running Host app information
  private runningRootApps: Map<string, { terminal: vscode.Terminal }> = new Map();
  
  private dependencyGraphManager: DependencyGraphManager;
  
  constructor(private readonly workspaceRoot: string | undefined, private readonly context: vscode.ExtensionContext) {
    this.rootConfigManager = new RootConfigManager(context);
    this.dependencyGraphManager = new DependencyGraphManager(context);
    this.log('Initializing Unified Module Federation Explorer...');
    
    // Check if root configuration exists with hosts first
    this.rootConfigManager.hasConfiguredRoots().then(hasRoots => {
      if (hasRoots) {
        // If we have roots configured, proceed with loading configurations
        this.loadConfigurations();
      } else {
        // Set context to show welcome view when no roots are configured
        vscode.commands.executeCommand('setContext', 'moduleFederation.hasRoots', false);
        this.log('No host directories configured yet. Waiting for user to set up configuration.');
      }
    });
  }

  /**
   * Get the workspace root path
   */
  getWorkspaceRoot(): string | undefined {
    return this.workspaceRoot;
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
          if (!rootConfig) {
            this.log('Failed to load root configuration for tree view');
            return;
          }
          const rootItems = rootConfig.roots.map(root => ({
            label: path.basename(root),
            description: root,
            rootPath: root
          }));
          
          const selectedRoot = await DialogUtils.showQuickPick(rootItems, {
            title: 'Remove Invalid Host',
            placeholder: 'Select a Host to remove'
          });
          
          if (selectedRoot && !Array.isArray(selectedRoot)) {
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
      DialogUtils.showError(userMessage, {
        actions: actions.map(a => ({ title: a.title }))
      }).then(selected => {
        const selectedAction = actions.find(a => a.title === selected);
        if (selectedAction) {
          selectedAction.action();
        }
      });
    } else {
      DialogUtils.showError(userMessage);
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
          if (!rootConfig) {
            this.log('Failed to load root configuration');
            return;
          }
          if (rootConfig.roots.length === 0) {
            this.log('No Host directories configured. Configure at least one Host directory.');
            // Set context to show welcome view when no roots are configured
            vscode.commands.executeCommand('setContext', 'moduleFederation.hasRoots', false);
            
            // Show informational message after a short delay
            setTimeout(() => {
              DialogUtils.showInfo(
                'No Host directories are configured.',
                {
                  detail: 'Use the Add Host button in the toolbar to configure your first Host, then add more Hosts.',
                  actions: [
                    { title: 'Add Host' },
                    { title: 'Later', isCloseAffordance: true }
                  ]
                }
              ).then(selection => {
                if (selection === 'Add Host') {
                  vscode.commands.executeCommand('moduleFederation.addRoot');
                }
              });
            }, 1000);
            
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

      // Find all webpack, vite, ModernJS, and RSBuild config files in this Host, excluding node_modules
      const [webpackFiles, viteFiles, modernJSFiles, rsbuildFiles] = await Promise.all([
        this.findFiles(rootPath, '**/{webpack.config.js,webpack.config.ts}', '**/node_modules/**'),
        this.findFiles(rootPath, '**/{vite.config.js,vite.config.ts}', '**/node_modules/**'),
        this.findFiles(rootPath, '**/module-federation.config.{js,ts}', '**/node_modules/**'),
        this.findFiles(rootPath, '**/{rsbuild.config.js,rsbuild.config.ts}', '**/node_modules/**')
      ]);

      this.log(`Found ${webpackFiles.length} webpack configs, ${viteFiles.length} vite configs, ${modernJSFiles.length} ModernJS configs, and ${rsbuildFiles.length} RSBuild configs in ${rootPath}`);

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
      
      // Process RSBuild configs
      const rsbuildConfigs = await this.processConfigFiles(
        rsbuildFiles,
        extractConfigFromRSBuild,
        'rsbuild',
        rootPath
      );
      
      // Store configs for this Host
      const configs = [...webpackConfigs, ...viteConfigs, ...modernJSConfigs, ...rsbuildConfigs];
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

  getTreeItem(element: RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | LoadingPlaceholder | EmptyState): vscode.TreeItem {
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
        '3. The extension will automatically scan for webpack, Vite, ModernJS, or RSBuild configurations'
      );
      return treeItem;
    }
    
    if (isRootFolder(element)) {
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
        tooltip.appendMarkdown(`\n**Serve build command:** \`${element.startCommand}\``);
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
      const isExternal = element.isExternal || element.configType === 'external';
      
      const treeItem = new vscode.TreeItem(
        element.name,
        vscode.TreeItemCollapsibleState.None
      );
      
      // Create rich tooltip with configuration details
      let tooltip = new vscode.MarkdownString(`## Remote: ${element.name}\n\n`);
      
      if (isExternal) {
        tooltip.appendMarkdown(`**Type:** External Remote\n\n`);
      }
      
      if (element.url) {
        tooltip.appendMarkdown(`**URL:** ${element.url}\n\n`);
      }
      
      if (element.remoteEntry) {
        tooltip.appendMarkdown(`**Remote entry:** ${element.remoteEntry}\n\n`);
      }
      
      if (element.folder && !isExternal) {
        tooltip.appendMarkdown(`**Folder:** ${element.folder}\n\n`);
      }
      
      if (element.startCommand && !isExternal) {
        tooltip.appendMarkdown(`**Serve build command:** \`${element.startCommand}\`\n\n`);
      }
      
      if (element.buildCommand && !isExternal) {
        tooltip.appendMarkdown(`**Build command:** \`${element.buildCommand}\`\n\n`);
      }
      
      tooltip.appendMarkdown(`**Config type:** ${element.configType}`);
      
      if (isExternal) {
        // External remotes have different styling and context
        treeItem.iconPath = new vscode.ThemeIcon('globe');
        treeItem.contextValue = 'externalRemote';
        tooltip.appendMarkdown(`\n\n$(globe) **External Remote**`);
      } else if (isRunning) {
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

      
      return treeItem;
    }
    
    throw new Error(`Unknown element type`);
  }

  getChildren(element?: RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | LoadingPlaceholder | EmptyState): Thenable<(RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | LoadingPlaceholder | EmptyState)[]> {
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
    if (!config) {
      this.log('Failed to load root configuration for tree view');
      return [];
    }
    
    for (const [rootPath, configs] of this.rootConfigs.entries()) {
      const rootFolderConfig = config.rootConfigs?.[rootPath];
      
      rootFolders.push({
        type: 'rootFolder',
        path: rootPath,
        name: path.basename(rootPath),
        configs: configs,
        startCommand: rootFolderConfig?.startCommand,
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
        // Try to reference the start terminal - if it's disposed, this will throw an error
        const disposedCheck = runningRemote.startTerminal.processId;
        return runningRemote.startTerminal;
      } catch (error) {
        // Terminal was disposed externally, clean up our reference
        this.log(`Detected disposed terminal for remote ${remoteKey}, cleaning up`);
        this.runningRemotes.delete(remoteKey);
        this._onDidChangeTreeData.fire(undefined);
        return undefined;
      }
    }
    
    return undefined;
  }
  
  /**
   * Set a remote as running
   */
  setRunningRemote(remoteKey: string, startTerminal: vscode.Terminal, buildTerminal?: vscode.Terminal): void {
    this.runningRemotes.set(remoteKey, { startTerminal, buildTerminal });
    this._onDidChangeTreeData.fire(undefined);
  }
  
  /**
   * Stop a running remote
   */
  stopRemote(remoteKey: string): void {
    const runningRemote = this.runningRemotes.get(remoteKey);
    if (runningRemote) {
      // Dispose both terminals if they exist
      if (runningRemote.buildTerminal) {
        runningRemote.buildTerminal.dispose();
      }
      runningRemote.startTerminal.dispose();
      this.runningRemotes.delete(remoteKey);
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  /**
   * Add a new Host to the configuration
   */
  async addRoot(): Promise<void> {
    try {
      // Make sure configuration is set up first
      if (!this.rootConfigManager.getConfigPath()) {
        // Configuration isn't set up, prompt user
        const result = await DialogUtils.showInfo(
          'You need to set up your configuration file before adding hosts.',
          {
            actions: [
              { title: 'Configure Settings' },
              { title: 'Cancel', isCloseAffordance: true }
            ]
          }
        );
        
        if (result === 'Configure Settings') {
          // Open configuration setup
          await this.changeConfigFile();
          
          // If still no config path, user cancelled
          if (!this.rootConfigManager.getConfigPath()) {
            return;
          }
        } else {
          return; // User cancelled
        }
      }

      // Now we should have a valid config path, ask user to select a host folder
      // Set default URI to parent of workspace root if available
      let defaultUri: vscode.Uri | undefined;
      if (this.workspaceRoot) {
        const parentPath = path.dirname(this.workspaceRoot);
        defaultUri = vscode.Uri.file(parentPath);
      }

      const rootPath = await DialogUtils.showFolderPicker({
        title: 'Select a folder to add to the Module Federation Explorer',
        openLabel: 'Select Host Folder',
        defaultUri: defaultUri
      });

      if (!rootPath) {
        return;
      }
      await this.rootConfigManager.addRoot(rootPath);
      
      // After adding a root, reload configurations to scan for Module Federation configs
      this.reloadConfigurations();
    } catch (error) {
      this.logError('Failed to add root', error);
      await DialogUtils.showError('Failed to add root', {
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Remove a Host from the configuration
   */
  async removeRoot(rootFolder: RootFolder): Promise<void> {
    try {
      this.log(`Removing Host ${rootFolder.path}`);
      
      // Confirm with user
      const confirmed = await DialogUtils.showConfirmation(
        `Are you sure you want to remove "${rootFolder.path}" from the configuration?`,
        {
          destructive: true,
          confirmText: 'Remove',
          cancelText: 'Cancel'
        }
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
      
      await DialogUtils.showSuccess(`Removed Host ${rootFolder.path} from configuration`);
    } catch (error) {
      this.logError(`Failed to remove Host ${rootFolder.path}`, error);
      await DialogUtils.showError('Failed to remove Host', {
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Change the configuration file
   */
  async changeConfigFile(): Promise<void> {
    try {
      const result = await this.rootConfigManager.changeConfigFile();
      
      if (result) {
        // Reload configurations
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
        await DialogUtils.showInfo(`Host app is already running: ${rootFolder.name}`);
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
      
      await DialogUtils.showSuccess(`Started Host app: ${rootFolder.name}`);
    } catch (error) {
      this.logError(`Failed to start Host app: ${rootFolder.name}`, error);
    }
  }

  /**
   * Edit the start command for a Host app
   */
  async editRootAppCommands(rootFolder: RootFolder): Promise<void> {
    try {
      const rootPath = rootFolder.path;
      this.log(`Editing commands for Host app: ${rootPath}`);
      
      // Get current package manager or detect it
      let packageManager = '';
      try {
        if (fsSync.existsSync(path.join(rootFolder.path, 'package-lock.json'))) {
          packageManager = 'npm';
        } else if (fsSync.existsSync(path.join(rootFolder.path, 'yarn.lock'))) {
          packageManager = 'yarn';
        } else if (fsSync.existsSync(path.join(rootFolder.path, 'pnpm-lock.yaml'))) {
          packageManager = 'pnpm';
        } else {
          packageManager = 'npm'; // Default to npm
        }
      } catch {
        packageManager = 'npm';
      }
      
      // Show quick pick for options to edit
      const options = [
        { label: '▶️ Edit Start Command - eg. npm run start, yarn dev, etc. the command to start the app', description: rootFolder.startCommand || 'Not configured' },
        { label: '📁 Change Project Folder', description: rootFolder.path || 'Not configured' },
        { label: '🔗 Add External Remote', description: 'Add an external remote to this host app' },
      ];
      
      const selectedOption = await DialogUtils.showQuickPick(options, {
        title: `Edit Configuration for ${rootFolder.name}`,
        placeholder: 'What would you like to edit?'
      });
      
      if (!selectedOption || Array.isArray(selectedOption)) {
        return; // User cancelled
      }
      
      // Handle folder change option
      if (selectedOption.label.includes('Change Project Folder')) {
        // Set default URI to parent of workspace root if available
        let defaultUri: vscode.Uri | undefined;
        const workspaceRoot = this.getWorkspaceRoot();
        if (workspaceRoot) {
          const parentPath = path.dirname(workspaceRoot);
          defaultUri = vscode.Uri.file(parentPath);
        }

        const newFolder = await DialogUtils.showFolderPicker({
          title: `Select New Project Folder for Host App "${rootFolder.name}"`,
          openLabel: `Select "${rootFolder.name}" Project Folder`,
          defaultUri: defaultUri,
          validateFolder: async (folderPath: string) => {
            const packageJsonPath = path.join(folderPath, 'package.json');
            if (!fsSync.existsSync(packageJsonPath)) {
              const continueAnyway = await DialogUtils.showConfirmation(
                'The selected folder doesn\'t contain a package.json file.',
                {
                  detail: `Folder: ${folderPath}\n\nThis might not be a valid Node.js project folder. Do you want to continue anyway?`,
                  confirmText: 'Continue Anyway',
                  cancelText: 'Select Different Folder'
                }
              );
              return { valid: continueAnyway, message: 'Invalid Node.js project folder' };
            }
            return { valid: true };
          }
        });

        if (!newFolder) {
          await DialogUtils.showWarning(
            `No folder selected for Host app "${rootFolder.name}".`,
            {
              detail: 'Folder configuration was not changed.'
            }
          );
          return;
        }
        
        // Update the root folder path
        const oldPath = rootFolder.path;
        rootFolder.path = newFolder;
        this.log(`Updated project folder for Host app ${rootFolder.name}: ${newFolder}`);
        
        // Update the rootConfigs map with the new path
        const configs = this.rootConfigs.get(oldPath);
        if (configs) {
          this.rootConfigs.delete(oldPath);
          this.rootConfigs.set(newFolder, configs);
        }
        
        // Re-detect package manager for the new folder
        if (fsSync.existsSync(path.join(newFolder, 'package-lock.json'))) {
          packageManager = 'npm';
        } else if (fsSync.existsSync(path.join(newFolder, 'yarn.lock'))) {
          packageManager = 'yarn';
        } else if (fsSync.existsSync(path.join(newFolder, 'pnpm-lock.yaml'))) {
          packageManager = 'pnpm';
        } else {
          packageManager = 'npm'; // Default to npm
        }
        
        // Save the updated configuration
        await this.saveRootFolderConfig(rootFolder);
        
        // Refresh the tree view to reflect changes
        this.refresh();
        
        await DialogUtils.showSuccess(`Updated project folder for ${rootFolder.name}`);
        return;
      }
      
      // Handle start command editing
      if (selectedOption.label.includes('Edit Start Command')) {
        // Ask user for start command using the enhanced command config dialog
        const startCommand = await DialogUtils.showCommandConfig({
          title: `Configure Start Command for ${rootFolder.name}`,
          commandType: 'start',
          currentCommand: rootFolder.startCommand,
          packageManager: packageManager,
          projectPath: rootFolder.path
        });
        
        if (startCommand !== undefined) { // Allow empty string but not undefined (cancelled)
          rootFolder.startCommand = startCommand;
          
          // Save the updated configuration
          await this.saveRootFolderConfig(rootFolder);
          
          // Refresh the tree view to reflect changes
          this.refresh();
          
          await DialogUtils.showSuccess(`Updated start command for ${rootFolder.name}`);
        }
      }

      // Handle add external remote option
      if (selectedOption.label.includes('Add External Remote')) {
        // Create a temporary RemotesFolder to use with the existing addExternalRemote method
        const remotesFolder: RemotesFolder = {
          type: 'remotesFolder',
          parentName: rootFolder.name,
          remotes: [] // Start with empty remotes array
        };

        // Call a modified version of addExternalRemote that uses the rootFolder.path directly
        await this.addExternalRemoteToHost(remotesFolder, rootFolder.path);
        return;
      }
    } catch (error) {
      this.logError(`Failed to edit commands for ${rootFolder.name}`, error);
      await DialogUtils.showError(`Failed to edit commands for ${rootFolder.name}`, {
        detail: error instanceof Error ? error.message : String(error)
      });
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
        await DialogUtils.showInfo(`Host app is not running: ${rootFolder.name}`);
        return;
      }
      
      // Dispose the terminal
      runningApp.terminal.dispose();
      this.runningRootApps.delete(rootPath);
      
      // Refresh the tree view
      this.refresh();
      
      await DialogUtils.showSuccess(`Stopped Host app: ${rootFolder.name}`);
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
      const startCommand = await DialogUtils.showInput({
        title: `Configure App Start Command for ${rootFolder.name}`,
        prompt: `Configure app start command for ${rootFolder.name}`,
        value: currentCommand || defaultCommand,
        placeholder: 'e.g., npm run start, yarn dev, etc. the command to start the app',
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
      
      await DialogUtils.showSuccess(`Configured app start command for ${rootFolder.name}: ${startCommand}`);
      return startCommand;
    } catch (error) {
      this.logError(`Failed to configure serve build command for ${rootFolder.name}`, error);
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
      if (!config) {
        this.logError(`Failed to save Host folder config for ${rootFolder.name}`, 'No configuration found');
        return;
      }
      
      // Create or update the configs property if it doesn't exist
      if (!config.rootConfigs) {
        config.rootConfigs = {};
      }
      
      // Preserve existing configuration and only update the startCommand
      if (!config.rootConfigs[rootFolder.path]) {
        config.rootConfigs[rootFolder.path] = {};
      }
      
      // Update just the startCommand while preserving other properties like remotes
      config.rootConfigs[rootFolder.path] = {
        ...config.rootConfigs[rootFolder.path],
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
      if (!config?.rootConfigs) {
        return;
      }
      
      // Update Host folder configurations
      for (const [rootPath, configs] of this.rootConfigs.entries()) {
        const rootFolderConfig = config?.rootConfigs[rootPath];
        if (rootFolderConfig) {
          // Update the Host folder in the tree view
          const rootFolder: RootFolder = {
            type: 'rootFolder',
            path: rootPath,
            name: path.basename(rootPath),
            configs: configs,
            startCommand: rootFolderConfig.startCommand,
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
   * Check for disposed terminals and clean them up
   */
  cleanupDisposedTerminals(): void {
    this.log('Checking for disposed terminals...');
    
    // Check remotes
    const remotesToRemove: string[] = [];
    for (const [remoteKey, remoteInfo] of this.runningRemotes.entries()) {
      try {
        // Try to access processId to check if terminal is still alive
        const startTerminalAlive = remoteInfo.startTerminal.processId !== undefined;
        const buildTerminalAlive = !remoteInfo.buildTerminal || remoteInfo.buildTerminal.processId !== undefined;
        
        if (!startTerminalAlive || !buildTerminalAlive) {
          this.log(`Found disposed terminal for remote ${remoteKey}`);
          remotesToRemove.push(remoteKey);
        }
      } catch (error) {
        this.log(`Found disposed terminal for remote ${remoteKey} (exception)`);
        remotesToRemove.push(remoteKey);
      }
    }
    
    // Check root apps
    const rootAppsToRemove: string[] = [];
    for (const [rootPath, appInfo] of this.runningRootApps.entries()) {
      try {
        const terminalAlive = appInfo.terminal.processId !== undefined;
        if (!terminalAlive) {
          this.log(`Found disposed terminal for root app ${rootPath}`);
          rootAppsToRemove.push(rootPath);
        }
      } catch (error) {
        this.log(`Found disposed terminal for root app ${rootPath} (exception)`);
        rootAppsToRemove.push(rootPath);
      }
    }
    
    // Remove disposed terminals
    let removedAny = false;
    for (const remoteKey of remotesToRemove) {
      this.runningRemotes.delete(remoteKey);
      removedAny = true;
    }
    
    for (const rootPath of rootAppsToRemove) {
      this.runningRootApps.delete(rootPath);
      removedAny = true;
    }
    
    if (removedAny) {
      this.log(`Cleaned up ${remotesToRemove.length} remotes and ${rootAppsToRemove.length} root apps`);
      this._onDidChangeTreeData.fire(undefined);
    } else {
      this.log('No disposed terminals found');
    }
  }

  /**
   * Handle terminal closure events to clean up running apps
   */
  handleTerminalClosed(closedTerminal: vscode.Terminal): void {
    this.log(`Terminal closed: ${closedTerminal.name}`);
    this.log(`Currently tracking ${this.runningRemotes.size} running remotes and ${this.runningRootApps.size} running root apps`);
    
    let foundMatch = false;
    
    // Helper function to compare terminals by name and process ID
    const terminalsMatch = (terminal1: vscode.Terminal, terminal2: vscode.Terminal): boolean => {
      try {
        // First try direct reference comparison
        if (terminal1 === terminal2) {
          return true;
        }
        
        // Then try comparing by name and process ID
        return terminal1.name === terminal2.name && 
               terminal1.processId === terminal2.processId;
      } catch (error) {
        // If there's an error accessing processId (terminal disposed), try name only
        return terminal1.name === terminal2.name;
      }
    };
    
    // Check if this terminal belongs to a running remote
    for (const [remoteKey, remoteInfo] of this.runningRemotes.entries()) {
      this.log(`Checking remote ${remoteKey}: start terminal name="${remoteInfo.startTerminal.name}", build terminal name="${remoteInfo.buildTerminal?.name || 'none'}"`);
      
      let shouldRemove = false;
      
      // Check if the closed terminal is either the build or start terminal
      if (terminalsMatch(remoteInfo.startTerminal, closedTerminal)) {
        this.log(`Start terminal closed for remote: ${remoteKey}`);
        shouldRemove = true;
        foundMatch = true;
      } else if (remoteInfo.buildTerminal && terminalsMatch(remoteInfo.buildTerminal, closedTerminal)) {
        this.log(`Build terminal closed for remote: ${remoteKey}`);
        shouldRemove = true;
        foundMatch = true;
      }
      
      if (shouldRemove) {
        this.log(`Removing remote ${remoteKey} from running list due to terminal closure`);
        this.runningRemotes.delete(remoteKey);
        this._onDidChangeTreeData.fire(undefined);
        break; // Exit loop since we found the terminal
      }
    }
    
    // Check if this terminal belongs to a running root app
    if (!foundMatch) {
      for (const [rootPath, appInfo] of this.runningRootApps.entries()) {
        this.log(`Checking root app ${rootPath}: terminal name="${appInfo.terminal.name}"`);
        
        if (terminalsMatch(appInfo.terminal, closedTerminal)) {
          this.log(`Root app terminal closed for: ${rootPath}`);
          this.runningRootApps.delete(rootPath);
          this._onDidChangeTreeData.fire(undefined);
          foundMatch = true;
          break; // Exit loop since we found the terminal
        }
      }
    }
    
    if (!foundMatch) {
      this.log(`No matching tracked terminal found for closed terminal: ${closedTerminal.name}`);
    }
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
      const defaultPath = path.resolve(rootPaths[0], remote.folder);
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
      if (!config) {
        this.logError(`Failed to save configuration for remote ${remote.name}`, 'No configuration found');
        return;
      }
      
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
      if (!config) {
        this.log('No root configuration found');
        return;
      }
      
      // Non-null assertion to help TypeScript understand
      const safeConfig: NonNullable<typeof config> = config;
      
      // Check if rootConfigs section exists
      if (!safeConfig.rootConfigs) {
        this.log('No saved Host configurations found');
        return;
      }
      
      // Go through each Host configuration
      for (const [rootPath, rootConfig] of Object.entries(safeConfig.rootConfigs)) {
        // Process regular remotes
        if (rootConfig.remotes) {
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

        // Process external remotes
        if (rootConfig.externalRemotes) {
          this.log(`Loading ${Object.keys(rootConfig.externalRemotes).length} external remotes for root ${rootPath}`);
          
          // Find the configurations for this root path
          const configs = this.rootConfigs.get(rootPath);
          if (configs) {
            // Add external remotes to each configuration in this root
            for (const [externalRemoteName, externalRemoteConfig] of Object.entries(rootConfig.externalRemotes)) {
              this.log(`Adding external remote ${externalRemoteName} to configurations in ${rootPath}`);
              
              // Create the external remote object
              const externalRemote: Remote = {
                name: externalRemoteConfig.name,
                url: externalRemoteConfig.url,
                folder: '', // External remotes don't have local folders
                configType: 'external',
                packageManager: '',
                isExternal: true
              };

              // Add to each configuration in this root (they should all see the same external remotes)
              for (const mfeConfig of configs) {
                // Check if this external remote already exists in the config
                const existingRemote = mfeConfig.remotes.find(r => r.name === externalRemoteName && r.isExternal);
                if (!existingRemote) {
                  mfeConfig.remotes.push(externalRemote);
                  this.log(`Added external remote ${externalRemoteName} to config ${mfeConfig.name}`);
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
        await DialogUtils.showInfo('No Module Federation configurations found. Please add a Host folder first.');
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
      await DialogUtils.showError('Failed to generate dependency graph', {
        detail: error instanceof Error ? error.message : String(error)
      });
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
  handleDrag(source: readonly (RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | LoadingPlaceholder | EmptyState)[], 
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
  async handleDrop(target: RootFolder | RemotesFolder | ExposesFolder | Remote | ExposedModule | LoadingPlaceholder | EmptyState | undefined, 
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
      if (!rootConfig) {
        this.logError('Failed to load root configuration for reordering', 'Configuration not found');
        return;
      }
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
      await DialogUtils.showError('Failed to reorder root folders', {
        detail: 'See output panel for details.'
      });
    }
  }

  /**
   * Edit the build and start commands for a remote
   */
  async editRemoteCommands(remote: Remote): Promise<void> {
    try {
      // Call the method to resolve the proper folder path
      const resolvedFolderPath = this.resolveRemoteFolderPath(remote);
      this.log(`Editing commands for remote ${remote.name}, folder: ${resolvedFolderPath || 'not set'}`);
      
      // Get current package manager or detect it
      let packageManager = remote.packageManager;
      if (resolvedFolderPath && !packageManager) {
        // Detect package manager
        if (fsSync.existsSync(path.join(resolvedFolderPath, 'package-lock.json'))) {
          packageManager = 'npm';
        } else if (fsSync.existsSync(path.join(resolvedFolderPath, 'yarn.lock'))) {
          packageManager = 'yarn';
        } else if (fsSync.existsSync(path.join(resolvedFolderPath, 'pnpm-lock.yaml'))) {
          packageManager = 'pnpm';
        } else {
          packageManager = 'npm'; // Default to npm
        }
        remote.packageManager = packageManager;
      }
      
      // Show quick pick for options to edit
      const options = [
        { label: '📁 Change Project Folder', description: resolvedFolderPath || 'Not configured' },
        { label: '🔨 Edit Build Command', description: remote.buildCommand || 'Not configured' },
        { label: '▶️ Edit Preview Build Command', description: remote.startCommand || 'Not configured' },
        { label: '⚙️ Edit Both Commands', description: 'Configure both build and start commands' }
      ];
      
      const selectedOption = await DialogUtils.showQuickPick(options, {
        title: `Edit Configuration for ${remote.name}`,
        placeholder: 'What would you like to edit?'
      });
      
      if (!selectedOption || Array.isArray(selectedOption)) {
        return; // User cancelled
      }
      
      // Handle folder change option
      if (selectedOption.label.includes('Change Project Folder')) {
        // Set default URI to parent of workspace root if available
        let defaultUri: vscode.Uri | undefined;
        const workspaceRoot = this.getWorkspaceRoot();
        if (workspaceRoot) {
          const parentPath = path.dirname(workspaceRoot);
          defaultUri = vscode.Uri.file(parentPath);
        }

        const newFolder = await DialogUtils.showFolderPicker({
          title: `Select New Project Folder for Remote "${remote.name}"`,
          openLabel: `Select "${remote.name}" Project Folder`,
          defaultUri: defaultUri,
          validateFolder: async (folderPath: string) => {
            const packageJsonPath = path.join(folderPath, 'package.json');
            if (!fsSync.existsSync(packageJsonPath)) {
              const continueAnyway = await DialogUtils.showConfirmation(
                'The selected folder doesn\'t contain a package.json file.',
                {
                  detail: `Folder: ${folderPath}\n\nThis might not be a valid Node.js project folder. Do you want to continue anyway?`,
                  confirmText: 'Continue Anyway',
                  cancelText: 'Select Different Folder'
                }
              );
              return { valid: continueAnyway, message: 'Invalid Node.js project folder' };
            }
            return { valid: true };
          }
        });

        if (!newFolder) {
          await DialogUtils.showWarning(
            `No folder selected for remote "${remote.name}".`,
            {
              detail: 'Folder configuration was not changed.'
            }
          );
          return;
        }
        
        // Update the remote folder
        remote.folder = newFolder;
        this.log(`Updated project folder for remote ${remote.name}: ${newFolder}`);
        
        // Re-detect package manager for the new folder
        if (fsSync.existsSync(path.join(newFolder, 'package-lock.json'))) {
          remote.packageManager = 'npm';
        } else if (fsSync.existsSync(path.join(newFolder, 'yarn.lock'))) {
          remote.packageManager = 'yarn';
        } else if (fsSync.existsSync(path.join(newFolder, 'pnpm-lock.yaml'))) {
          remote.packageManager = 'pnpm';
        } else {
          remote.packageManager = 'npm'; // Default to npm
        }
        
        // Save the updated configuration
        await this.saveRemoteConfiguration(remote);
        
        // Refresh the tree view to reflect changes
        this.refresh();
        
        await DialogUtils.showSuccess(`Updated project folder for ${remote.name}`);
        return;
      }
      
      // If folder is not set for command editing, show error and exit
      if (!resolvedFolderPath) {
        await DialogUtils.showError(`Cannot edit commands for ${remote.name}: Folder not configured`, {
          detail: 'Please configure the project folder first by selecting "Change Project Folder".'
        });
        return;
      }
      
      // Handle based on selection
      if (selectedOption.label.includes('Edit Build Command') || selectedOption.label.includes('Edit Both Commands')) {
        // Ask user for build command
        const buildCommand = await DialogUtils.showCommandConfig({
          title: `Configure Build Command for ${remote.name}`,
          commandType: 'build',
          currentCommand: remote.buildCommand,
          packageManager: packageManager,
          projectPath: resolvedFolderPath,
          configType: remote.configType
        });
        
        if (buildCommand !== undefined) { // Allow empty string but not undefined (cancelled)
          remote.buildCommand = buildCommand;
        } else if (selectedOption.label.includes('Edit Build Command')) {
          return; // User cancelled just the build command
        }
      }
      
      if (selectedOption.label.includes('Edit Preview Build Command') || selectedOption.label.includes('Edit Both Commands')) {
        // Ask user for start command
        const startCommand = await DialogUtils.showCommandConfig({
          title: `Configure Start Command for ${remote.name}`,
          commandType: 'start',
          currentCommand: remote.startCommand,
          packageManager: packageManager,
          projectPath: resolvedFolderPath,
          configType: remote.configType
        });
        
        if (startCommand !== undefined) { // Allow empty string but not undefined (cancelled)
          remote.startCommand = startCommand;
        } else if (selectedOption.label.includes('Edit Start Command')) {
          return; // User cancelled just the start command
        }
      }
      
      // Save the updated configuration
      await this.saveRemoteConfiguration(remote);
      
      // Refresh the tree view to reflect changes
      this.refresh();
      
      await DialogUtils.showSuccess(`Updated commands for ${remote.name}`);
    } catch (error) {
      this.logError(`Failed to edit commands for ${remote.name}`, error);
      await DialogUtils.showError(`Failed to edit commands for ${remote.name}`, {
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Add an external remote to the current host
   */
  async addExternalRemote(remotesFolder: RemotesFolder): Promise<void> {
    try {
      this.log(`Adding external remote for host ${remotesFolder.parentName}`);
      
      // Get the remote name from user
      const remoteName = await DialogUtils.showInput({
        title: 'Add External Remote',
        prompt: 'Enter the name of the external remote',
        placeholder: 'e.g., shared-components, auth-service, etc.',
        validateInput: (value: string) => {
          if (!value || value.trim() === '') {
            return 'Remote name is required';
          }
          if (!/^[a-zA-Z0-9_-]+$/.test(value.trim())) {
            return 'Remote name can only contain letters, numbers, hyphens, and underscores';
          }
          return undefined;
        }
      });

      if (!remoteName) {
        return; // User cancelled
      }

      // Get the remote URL from user
      const remoteUrl = await DialogUtils.showInput({
        title: 'Add External Remote',
        prompt: `Enter the URL for remote "${remoteName}"`,
        placeholder: 'e.g., http://localhost:3001/remoteEntry.js, https://my-remote.com/remoteEntry.js',
        validateInput: (value: string) => {
          if (!value || value.trim() === '') {
            return 'Remote URL is required';
          }
          try {
            new URL(value.trim());
            return undefined;
          } catch {
            return 'Please enter a valid URL';
          }
        }
      });

      if (!remoteUrl) {
        return; // User cancelled
      }

      // Find the root path for this remotes folder
      let targetRootPath = '';
      for (const [rootPath, configs] of this.rootConfigs.entries()) {
        for (const config of configs) {
          if (config.name === remotesFolder.parentName) {
            targetRootPath = rootPath;
            break;
          }
        }
        if (targetRootPath) break;
      }

      if (!targetRootPath) {
        await DialogUtils.showError('Failed to find host configuration', {
          detail: `Could not find configuration for host "${remotesFolder.parentName}"`
        });
        return;
      }

      // Check if remote name already exists
      const existingRemote = remotesFolder.remotes.find(r => r.name === remoteName.trim());
      if (existingRemote) {
        await DialogUtils.showError('Remote already exists', {
          detail: `A remote named "${remoteName.trim()}" already exists in host "${remotesFolder.parentName}"`
        });
        return;
      }

      // Create the external remote object
      const externalRemote: Remote = {
        name: remoteName.trim(),
        url: remoteUrl.trim(),
        folder: '', // External remotes don't have local folders
        configType: 'external',
        packageManager: '',
        isExternal: true
      };

      // Save the external remote to configuration
      await this.saveExternalRemoteConfiguration(targetRootPath, externalRemote);

      // Add the external remote to the current configuration in memory
      remotesFolder.remotes.push(externalRemote);

      // Refresh the tree view
      this.refresh();

      await DialogUtils.showSuccess(`Added external remote "${remoteName.trim()}" to host "${remotesFolder.parentName}"`);
    } catch (error) {
      this.logError('Failed to add external remote', error);
      await DialogUtils.showError('Failed to add external remote', {
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Save external remote configuration
   */
  private async saveExternalRemoteConfiguration(rootPath: string, externalRemote: Remote): Promise<void> {
    try {
      this.log(`Saving external remote configuration for ${externalRemote.name} in root ${rootPath}`);
      
      // Get current config
      const config = await this.rootConfigManager.loadRootConfig();
      if (!config) {
        throw new Error('No configuration found');
      }

      // Ensure rootConfigs exists
      if (!config.rootConfigs) {
        config.rootConfigs = {};
      }

      // Ensure the config for this root exists
      if (!config.rootConfigs[rootPath]) {
        config.rootConfigs[rootPath] = {};
      }

      // Ensure externalRemotes section exists for this root
      if (!config.rootConfigs[rootPath].externalRemotes) {
        config.rootConfigs[rootPath].externalRemotes = {};
      }

      // Store external remote configuration
      config.rootConfigs[rootPath].externalRemotes![externalRemote.name] = {
        name: externalRemote.name,
        url: externalRemote.url!,
        configType: 'external',
        isExternal: true
      };

      // Save the config
      await this.rootConfigManager.saveRootConfig(config);

      this.log(`Saved external remote configuration for ${externalRemote.name} in root ${rootPath}`);
    } catch (error) {
      this.logError(`Failed to save external remote configuration for ${externalRemote.name}`, error);
      throw error;
    }
  }

  /**
   * Remove an external remote
   */
  async removeExternalRemote(remote: Remote): Promise<void> {
    try {
      this.log(`Removing external remote ${remote.name}`);
      
      // Confirm with user
      const confirmed = await DialogUtils.showConfirmation(
        `Are you sure you want to remove external remote "${remote.name}"?`,
        {
          destructive: true,
          confirmText: 'Remove',
          cancelText: 'Cancel'
        }
      );

      if (!confirmed) {
        return;
      }

      // Find the root path that contains this external remote
      let targetRootPath = '';
      for (const [rootPath, configs] of this.rootConfigs.entries()) {
        for (const config of configs) {
          if (config.remotes.some(r => r.name === remote.name && r.isExternal)) {
            targetRootPath = rootPath;
            break;
          }
        }
        if (targetRootPath) break;
      }

      if (!targetRootPath) {
        await DialogUtils.showError('Failed to find external remote configuration', {
          detail: `Could not find configuration for external remote "${remote.name}"`
        });
        return;
      }

      // Remove from configuration file
      await this.removeExternalRemoteFromConfiguration(targetRootPath, remote.name);

      // Remove from memory configurations
      for (const [rootPath, configs] of this.rootConfigs.entries()) {
        for (const config of configs) {
          const remoteIndex = config.remotes.findIndex(r => r.name === remote.name && r.isExternal);
          if (remoteIndex !== -1) {
            config.remotes.splice(remoteIndex, 1);
            this.log(`Removed external remote ${remote.name} from config ${config.name}`);
          }
        }
      }

      // Refresh the tree view
      this.refresh();

      await DialogUtils.showSuccess(`Removed external remote "${remote.name}"`);
    } catch (error) {
      this.logError('Failed to remove external remote', error);
      await DialogUtils.showError('Failed to remove external remote', {
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Remove external remote from configuration file
   */
  private async removeExternalRemoteFromConfiguration(rootPath: string, remoteName: string): Promise<void> {
    try {
      this.log(`Removing external remote ${remoteName} from configuration in root ${rootPath}`);
      
      // Get current config
      const config = await this.rootConfigManager.loadRootConfig();
      if (!config) {
        throw new Error('No configuration found');
      }

      // Check if the configuration structure exists
      if (!config.rootConfigs || !config.rootConfigs[rootPath] || !config.rootConfigs[rootPath].externalRemotes) {
        this.log(`No external remotes configuration found for root ${rootPath}`);
        return;
      }

      // Remove the external remote
      delete config.rootConfigs[rootPath].externalRemotes![remoteName];

      // Clean up empty externalRemotes object if needed
      if (Object.keys(config.rootConfigs[rootPath].externalRemotes!).length === 0) {
        delete config.rootConfigs[rootPath].externalRemotes;
      }

      // Save the config
      await this.rootConfigManager.saveRootConfig(config);

      this.log(`Removed external remote ${remoteName} from configuration in root ${rootPath}`);
    } catch (error) {
      this.logError(`Failed to remove external remote ${remoteName} from configuration`, error);
      throw error;
    }
  }

  /**
   * Add an external remote to a specific host (when we already know the root path)
   */
  async addExternalRemoteToHost(remotesFolder: RemotesFolder, targetRootPath: string): Promise<void> {
    try {
      this.log(`Adding external remote for host ${remotesFolder.parentName} at path ${targetRootPath}`);
      
      // Get the remote name from user
      const remoteName = await DialogUtils.showInput({
        title: 'Add External Remote',
        prompt: 'Enter the name of the external remote',
        placeholder: 'e.g., shared-components, auth-service, etc.',
        validateInput: (value: string) => {
          if (!value || value.trim() === '') {
            return 'Remote name is required';
          }
          if (!/^[a-zA-Z0-9_-]+$/.test(value.trim())) {
            return 'Remote name can only contain letters, numbers, hyphens, and underscores';
          }
          return undefined;
        }
      });

      if (!remoteName) {
        return; // User cancelled
      }

      // Get the remote URL from user
      const remoteUrl = await DialogUtils.showInput({
        title: 'Add External Remote',
        prompt: `Enter the URL for remote "${remoteName}"`,
        placeholder: 'e.g., http://localhost:3001/remoteEntry.js, https://my-remote.com/remoteEntry.js',
        validateInput: (value: string) => {
          if (!value || value.trim() === '') {
            return 'Remote URL is required';
          }
          try {
            new URL(value.trim());
            return undefined;
          } catch {
            return 'Please enter a valid URL';
          }
        }
      });

      if (!remoteUrl) {
        return; // User cancelled
      }

      // Check if remote name already exists in any of the configurations for this root
      const configs = this.rootConfigs.get(targetRootPath);
      if (configs) {
        for (const config of configs) {
          const existingRemote = config.remotes.find(r => r.name === remoteName.trim());
          if (existingRemote) {
            await DialogUtils.showError('Remote already exists', {
              detail: `A remote named "${remoteName.trim()}" already exists in host "${remotesFolder.parentName}"`
            });
            return;
          }
        }
      }

      // Create the external remote object
      const externalRemote: Remote = {
        name: remoteName.trim(),
        url: remoteUrl.trim(),
        folder: '', // External remotes don't have local folders
        configType: 'external',
        packageManager: '',
        isExternal: true
      };

      // Save the external remote to configuration
      await this.saveExternalRemoteConfiguration(targetRootPath, externalRemote);

      // Add the external remote to all configurations in memory for this root
      if (configs) {
        for (const config of configs) {
          config.remotes.push(externalRemote);
        }
      }

      // Refresh the tree view
      this.refresh();

      await DialogUtils.showSuccess(`Added external remote "${remoteName.trim()}" to host "${remotesFolder.parentName}"`);
    } catch (error) {
      this.logError('Failed to add external remote', error);
      await DialogUtils.showError('Failed to add external remote', {
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
