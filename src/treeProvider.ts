import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Remote, ExposedModule, ModuleFederationStatus, ModuleFederationConfig } from './types';
import { extractConfigFromWebpack, extractConfigFromVite } from './configExtractors';
import { parse } from '@typescript-eslint/parser';

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
        const [webpackFiles, viteFiles] = await Promise.all([
          vscode.workspace.findFiles(
            '**/{webpack.config.js,webpack.config.ts}',
            '**/node_modules/**'
          ),
          vscode.workspace.findFiles(
            '**/{vite.config.js,vite.config.ts}',
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
      // This is a ModuleFederationStatus
      const treeItem = new vscode.TreeItem(
        'Module Federation',
        vscode.TreeItemCollapsibleState.Expanded
      );
      
      const statusText = element.hasConfig 
        ? `Configured (${element.configType}) - ${element.remotesCount} remote${element.remotesCount !== 1 ? 's' : ''}, ${element.exposesCount} expose${element.exposesCount !== 1 ? 's' : ''}`
        : 'Not configured';
      
      treeItem.description = statusText;
      treeItem.tooltip = element.hasConfig 
        ? `Module Federation is configured using ${element.configType}.\nConfig file: ${element.configPath}\nRemotes: ${element.remotesCount}\nExposes: ${element.exposesCount}`
        : 'Module Federation is not configured in this project.';
      treeItem.iconPath = new vscode.ThemeIcon('server');
      treeItem.contextValue = 'moduleFederationStatus';
      return treeItem;
    } else if ('remoteName' in element) {
      // This is an ExposedModule
      const treeItem = new vscode.TreeItem(
        element.name,
        vscode.TreeItemCollapsibleState.None
      );
      
      treeItem.description = element.path;
      treeItem.tooltip = `Exposed Module: ${element.name}\nPath: ${element.path}\nRemote: ${element.remoteName}\nSource: ${element.configSource}`;
      treeItem.iconPath = new vscode.ThemeIcon('export');
      treeItem.contextValue = 'exposedModule';
      return treeItem;
    } else {
      // This is a Remote
      const treeItem = new vscode.TreeItem(
        element.name, 
        vscode.TreeItemCollapsibleState.Collapsed
      );
      
      treeItem.description = element.url;
      treeItem.tooltip = `Remote: ${element.name}\nURL: ${element.url || 'Not specified'}\nFolder: ${element.folder}\nSource: ${element.configSource}`;
      treeItem.iconPath = new vscode.ThemeIcon('server');
      treeItem.contextValue = 'remote';
      
      treeItem.command = {
        command: 'moduleFederation.startRemote',
        title: 'Start Remote',
        arguments: [element]
      };
      
      return treeItem;
    }
  }

  getChildren(element?: Remote | ModuleFederationStatus | ExposedModule): Thenable<(Remote | ModuleFederationStatus | ExposedModule)[]> {
    if (!element) {
      // Root level - show status
      return Promise.resolve([this.status]);
    } else if ('hasConfig' in element) {
      // Status node - show all remotes and exposes
      const allRemotes = this.configs.flatMap(config => config.remotes);
      const allExposes = this.configs.flatMap(config => config.exposes);
      return Promise.resolve([...allRemotes, ...allExposes]);
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