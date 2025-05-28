import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Remote } from './types';
import { UnifiedModuleFederationProvider } from './unifiedTreeProvider';
import { DialogUtils } from './dialogUtils';

/**
 * Activate the extension
 */
export function activate(context: vscode.ExtensionContext) {
  try {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    
    // Check if this is the first time the extension is being activated
    const hasShownWelcomePage = context.globalState.get('mfExplorer.hasShownWelcomePage', false);
    if (!hasShownWelcomePage) {
      // Show welcome page
      showWelcomePage(context);
      // Mark as shown
      context.globalState.update('mfExplorer.hasShownWelcomePage', true);
    }
    
    // Create the unified provider instead of the old one
    const provider = new UnifiedModuleFederationProvider(workspaceRoot, context);
    
    // Clear any previously running remotes (in case of extension restart)
    provider.clearAllRunningApps();
    
    // Show initial welcome message
    vscode.window.showInformationMessage('Module Federation Explorer is now active!');
    provider.log('Extension activated successfully');

    // Guide the user through the setup process after a short delay
    setTimeout(() => {
      showSetupGuide(provider);
    }, 2000);
    
    // Register the tree data provider and create tree view
    const viewId = 'moduleFederation';
    vscode.window.registerTreeDataProvider(viewId, provider);
    
    // Create a tree view that will be shown in the explorer
    const treeView = vscode.window.createTreeView(viewId, {
      treeDataProvider: provider,
      showCollapseAll: true,
      dragAndDropController: provider
    });
    context.subscriptions.push(treeView);
    
    // Register the reveal command to show the Module Federation Explorer view
    context.subscriptions.push(
      vscode.commands.registerCommand('moduleFederation.reveal', () => {
        // This command opens the Explorer view and then focuses on our view
        vscode.commands.executeCommand('workbench.view.explorer');
        // Directly open the Module Federation view by ID
        vscode.commands.executeCommand('moduleFederation.focus');
      })
    );
    
    // Add a direct command to open the view within explorer
    context.subscriptions.push(
      vscode.commands.registerCommand('moduleFederation.openView', () => {
        // First show the explorer
        vscode.commands.executeCommand('workbench.view.explorer');
        // Try to focus specifically on our view using its id
        setTimeout(() => {
          // Try multiple approaches to ensure compatibility across different VS Code versions
          const viewId = 'moduleFederationExplorer';
          vscode.commands.executeCommand(`${viewId}.focus`);
        }, 300);
      })
    );
    
    // Register focus command to focus the Module Federation view
    context.subscriptions.push(
      vscode.commands.registerCommand('moduleFederation.focus', () => {
        // Simply open the explorer view where our view is contained
        vscode.commands.executeCommand('workbench.view.explorer');
      })
    );

    // Register welcome command explicitly
    const welcomeCommand = vscode.commands.registerCommand('moduleFederation.showWelcome', () => {
      showWelcomePage(context);
    });
    context.subscriptions.push(welcomeCommand);
    
    // Register commands and watchers
    const disposables = [
      vscode.commands.registerCommand('moduleFederation.refresh', () => provider.reloadConfigurations()),
      
      // Root management commands
      vscode.commands.registerCommand('moduleFederation.addRoot', () => provider.addRoot()),
      vscode.commands.registerCommand('moduleFederation.removeRoot', (rootFolder) => provider.removeRoot(rootFolder)),
      vscode.commands.registerCommand('moduleFederation.changeConfigFile', () => provider.changeConfigFile()),
      
      // Root app commands
      vscode.commands.registerCommand('moduleFederation.startRootApp', (rootFolder) => provider.startRootApp(rootFolder)),
      vscode.commands.registerCommand('moduleFederation.stopRootApp', (rootFolder) => provider.stopRootApp(rootFolder)),
      vscode.commands.registerCommand('moduleFederation.configureRootApp', (rootFolder) => provider.configureRootAppStartCommand(rootFolder)),
      vscode.commands.registerCommand('moduleFederation.editRootAppCommand', (rootFolder) => provider.editRootAppCommands(rootFolder)),
      
      // New Dependency Graph command
      vscode.commands.registerCommand('moduleFederation.showDependencyGraph', () => provider.showDependencyGraph()),
      
      // Remote commands
      vscode.commands.registerCommand('moduleFederation.stopRemote', async (remote: Remote) => {
        try {
          const remoteKey = `remote-${remote.name}`;
          provider.log(`Stopping remote ${remote.name}`);
          provider.stopRemote(remoteKey);
          provider.refresh();
          await DialogUtils.showSuccess(`Stopped remote ${remote.name}`);
        } catch (error) {
          await DialogUtils.showError(`Failed to stop remote ${remote.name}`, {
            detail: error instanceof Error ? error.message : String(error)
          });
        }
      }),

      // Start remote command
      vscode.commands.registerCommand('moduleFederation.startRemote', async (remote: Remote) => {
        try {
          provider.log(`Starting remote ${remote.name}`);
          
          // Check if remote is already user-configured (has both folder and start command)
          const isUserConfigured = !!(remote.folder && remote.startCommand);
          
          let folder: string;
          
          if (!isUserConfigured) {
            // Remote is not configured yet - show dialog to configure it
            provider.log(`Remote ${remote.name} is not configured yet, showing configuration dialog`);
            
            // Show informative message first
            const proceed = await DialogUtils.showInfo(
              `Remote "${remote.name}" needs a project folder to be configured.`,
              {
                modal: true,
                detail: 'This should be the folder containing the package.json file for this remote application.',
                actions: [
                  { title: 'Browse for Folder' },
                  { title: 'Cancel', isCloseAffordance: true }
                ]
              }
            );

            if (proceed !== 'Browse for Folder') {
              return;
            }

            // Set default URI to parent of workspace root if available
            let defaultUri: vscode.Uri | undefined;
            const workspaceRoot = provider.getWorkspaceRoot();
            if (workspaceRoot) {
              const parentPath = path.dirname(workspaceRoot);
              defaultUri = vscode.Uri.file(parentPath);
            }

            const selectedFolder = await DialogUtils.showFolderPicker({
              title: `Select Project Folder for Remote "${remote.name}"`,
              openLabel: `Select "${remote.name}" Project Folder`,
              defaultUri: defaultUri,
              validateFolder: async (folderPath: string) => {
                const packageJsonPath = path.join(folderPath, 'package.json');
                if (!fs.existsSync(packageJsonPath)) {
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

            if (!selectedFolder) {
              await DialogUtils.showWarning(
                `No folder selected for remote "${remote.name}".`,
                {
                  detail: 'You can configure this later by right-clicking the remote and selecting "Edit Commands".'
                }
              );
              return;
            }
            
            folder = selectedFolder;
            remote.folder = folder;
            provider.log(`User selected root project folder for remote ${remote.name}: ${folder}`);
            
            // Save the folder configuration using the unified provider
            await (provider as any).saveRemoteConfiguration(remote);
            
            // Refresh the tree view to reflect folder changes
            provider.reloadConfigurations();
          } else {
            // Remote is already configured - use the configured folder automatically
            const resolvedFolderPath = (provider as any).resolveRemoteFolderPath(remote);
            
            if (!resolvedFolderPath || !fs.existsSync(resolvedFolderPath)) {

              
              // Set default URI to parent of workspace root if available
              let defaultUri: vscode.Uri | undefined;
              const workspaceRoot = provider.getWorkspaceRoot();
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
                  if (!fs.existsSync(packageJsonPath)) {
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
                    detail: 'You can configure this later by right-clicking the remote and selecting "Edit Commands".'
                  }
                );
                return;
              }
              
              folder = newFolder;
              remote.folder = folder;
              provider.log(`User selected new project folder for remote ${remote.name}: ${folder}`);
              
              // Save the folder configuration using the unified provider
              await (provider as any).saveRemoteConfiguration(remote);
              
              // Refresh the tree view to reflect folder changes
              provider.reloadConfigurations();
            } else {
              // Folder exists and is valid, use it automatically
              folder = resolvedFolderPath;
              provider.log(`Using existing configured folder for remote ${remote.name}: ${folder}`);
            }
          }
          
          // Check if build and start commands are configured
          if (!remote.buildCommand || !remote.startCommand) {
            provider.log(`Build or start command not configured for remote ${remote.name}`);
            // Get current package manager or detect it
            let packageManager = remote.packageManager;
            if (!packageManager) {
              // Detect package manager
              if (fs.existsSync(path.join(folder, 'package-lock.json'))) {
                packageManager = 'npm';
              } else if (fs.existsSync(path.join(folder, 'yarn.lock'))) {
                packageManager = 'yarn';
              } else if (fs.existsSync(path.join(folder, 'pnpm-lock.yaml'))) {
                packageManager = 'pnpm';
              } else {
                packageManager = 'npm'; // Default to npm
              }
              remote.packageManager = packageManager;
              provider.log(`Detected package manager for remote ${remote.name}: ${packageManager}`);
            }
            
            // Ask user for build command
            const buildCommand = await DialogUtils.showCommandConfig({
              title: `Configure Build Command for ${remote.name}`,
              commandType: 'build',
              currentCommand: remote.buildCommand,
              packageManager: packageManager,
              projectPath: folder,
              configType: remote.configType
            });
            
            if (!buildCommand) {
              await DialogUtils.showInfo('Build command not provided, remote configuration canceled.');
              return;
            }
            
            // Ask user for start command
            const startCommand = await DialogUtils.showCommandConfig({
              title: `Configure Start Command for ${remote.name}`,
              commandType: 'preview',
              currentCommand: remote.startCommand,
              packageManager: packageManager,
              projectPath: folder,
              configType: remote.configType
            });
            
            if (!startCommand) {
              await DialogUtils.showInfo('Start command not provided, remote configuration canceled.');
              return;
            }
            
            // Update remote configuration
            remote.buildCommand = buildCommand;
            remote.startCommand = startCommand;
            
            // Save the updated configuration using the unified provider
            await (provider as any).saveRemoteConfiguration(remote);
            
            // Refresh view to reflect new command configuration
            provider.reloadConfigurations();
            
            await DialogUtils.showSuccess(`Commands configured for remote "${remote.name}"`);
          }

          // Check if a terminal for this remote is already running
          const remoteKey = `remote-${remote.name}`;
          provider.log(`Checking if remote ${remote.name} is already running (key: ${remoteKey})`);
          const existingTerminal = provider.getRunningRemoteTerminal(remoteKey);
          if (existingTerminal) {
            provider.log(`Remote ${remote.name} is already running, showing existing terminal`);
            existingTerminal.show();
            await DialogUtils.showInfo(`Remote ${remote.name} is already running`);
            return;
          }
          
          provider.log(`Remote ${remote.name} is not running, creating new terminal`);

          // Create a new terminal and start the remote
          const terminal = vscode.window.createTerminal(`Remote: ${remote.name}`);
          terminal.show();
          
          // Run build and serve commands
          terminal.sendText(`cd "${folder}" && ${remote.buildCommand} && ${remote.startCommand}`);
          
          // Store running remote info
          provider.setRunningRemote(remoteKey, terminal);
          provider.refresh();
          
          await DialogUtils.showSuccess(`Started remote ${remote.name}`);
        } catch (error) {
          await DialogUtils.showError(`Failed to start remote ${remote.name}`, {
            detail: error instanceof Error ? error.message : String(error)
          });
        }
      }),



      // Add command to edit commands for a remote
      vscode.commands.registerCommand('moduleFederation.editCommand', async (remote: Remote) => {
        try {
          provider.log(`Edit command triggered for remote ${remote.name}`);
          await (provider as any).editRemoteCommands(remote);
        } catch (error) {
          await DialogUtils.showError(`Failed to edit commands for ${remote.name}`, {
            detail: error instanceof Error ? error.message : String(error)
          });
        }
      }),


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
    
    // Watch for webpack, vite, and ModernJS config changes
    const fileWatcher = vscode.workspace.createFileSystemWatcher(
      '**/{webpack,vite}.config.{js,ts},**/module-federation.config.{js,ts}',
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
 * Shows a welcome page explaining how Module Federation Explorer works
 */
function showWelcomePage(context: vscode.ExtensionContext) {
  // Create and show welcome panel
  const panel = vscode.window.createWebviewPanel(
    'moduleFederationWelcome',
    'Welcome to Module Federation Explorer',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'media')
      ]
    }
  );

  // Set HTML content
  panel.webview.html = getWelcomePageHtml(context, panel.webview);
  
  // Handle webview messages
  panel.webview.onDidReceiveMessage(
    message => {
      switch (message.command) {
        case 'openExtensionExplorer':
          // Use the direct view opener command
          vscode.commands.executeCommand('moduleFederation.openView');
          return;
        case 'openDocs':
          vscode.env.openExternal(vscode.Uri.parse('https://github.com/andrecrjr/module-federation-explorer'));
          return;
      }
    },
    undefined,
    context.subscriptions
  );
}

/**
 * Returns the HTML content for the welcome page
 */
function getWelcomePageHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  // Get path to the extension media assets
  const extensionUri = context.extensionUri;
  const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'mfe-explorer-logo-big.png'));
  const graphPngUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'dependency-graph.png'));

  return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Module Federation Explorer</title>
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; 
            color: var(--vscode-foreground);
        padding: 20px;
        max-width: 900px;
            margin: 0 auto; 
        line-height: 1.5;
          }
          .container { 
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
      }
      .logo {
        max-width: 150px;
        margin-bottom: 20px;
      }
      h1 {
        font-size: 2em;
        margin-bottom: 0.5em;
        color: var(--vscode-editor-foreground);
      }
      h2 {
        font-size: 1.5em;
        margin-top: 1.5em;
        margin-bottom: 0.5em;
        color: var(--vscode-editor-foreground);
      }
      .feature-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 20px;
        margin: 30px 0;
        text-align: left;
      }
      .feature-card {
        background-color: var(--vscode-editor-background);
        border-radius: 8px;
        padding: 20px;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
        transition: transform 0.2s;
      }
      .feature-card:hover {
        transform: translateY(-5px);
      }
      .feature-card h3 {
            margin-top: 0; 
        margin-bottom: 10px;
        color: var(--vscode-textLink-foreground);
      }
      .button {
        display: inline-block;
        padding: 8px 16px;
        margin: 10px;
        background-color: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
            text-decoration: none;
        border-radius: 4px;
        border: none;
        cursor: pointer;
        font-weight: 500;
      }
      .button:hover {
        background-color: var(--vscode-button-hoverBackground);
      }
      .step {
        display: flex;
        align-items: flex-start;
        margin-bottom: 15px;
        text-align: left;
      }
      .step-number {
            display: flex;
        justify-content: center;
            align-items: center;
        width: 30px;
        height: 30px;
        background-color: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-radius: 50%;
        margin-right: 15px;
        flex-shrink: 0;
      }
      .step-content {
        flex: 1;
      }
      code {
        font-family: 'Courier New', Courier, monospace;
        background-color: var(--vscode-textCodeBlock-background);
        padding: 2px 5px;
        border-radius: 3px;
        font-size: 0.9em;
          }
        </style>
    </head>
    <body>
        <div class="container">
        <img src="${logoUri}" alt="Module Federation Logo" class="logo" />
        <h1>Welcome to Module Federation Explorer</h1>
        <p>A powerful tool to visualize, manage with Terminals, and interact with your Module Federation architecture.</p>
        
      <div style="margin: 30px 0 30px 0;">
        <button class="button" id="openExplorerBtn">Open Module Federation Explorer</button>
        <button class="button" id="openDocsBtn">Documentation</button>
      </div>
      <div class="feature-grid">
        <div class="feature-card">
          <h3>📦 Discover MFE Modules</h3>
          <p>Automatically detect and visualize Module Federation configurations in your workspace.</p>
                    </div>
        <div class="feature-card">
          <h3>🔄 Start/Stop Remotes</h3>
          <p>Launch and manage remote applications directly from VS Code.</p>
                    </div>
        <div class="feature-card">
          <h3>🔍 Dependency Graph</h3>
          <p>Visualize the relationships between hosts and remotes with an interactive graph.</p>
                    </div>
        <div class="feature-card">
          <h3>⚙️ Auto-Configuration</h3>
          <p>Supports Webpack, Vite, and ModernJS Module Federation configurations.</p>
                    </div>
                </div>
                
        <h2>Dependency Graph Visualization</h2>
        <div style="margin: 20px 0; text-align: center;">
          <img src="${graphPngUri}" alt="Module Federation Dependency Graph Example" style="max-width: 70%; border-radius: 8px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);" />
          <p style="margin-top: 10px; font-style: italic;">Example of a Module Federation dependency graph</p>
        </div>

      <h2>Getting Started</h2>
      
      <div style="max-width: 700px; margin: 0 auto;">
        <div class="step">
          <div class="step-number">1</div>
          <div class="step-content">
            <strong>Configure your settings</strong>
            <p>First, set up where your configuration file will be stored by clicking on the gear icon in the Module Federation Explorer view.</p>
          </div>
        </div>
        
        <div class="step">
          <div class="step-number">2</div>
          <div class="step-content">
            <strong>Add a Host folder</strong>
            <p>After setting up your configuration, click the "+" button in the extension view to add your first Module Federation host folder.</p>
          </div>
        </div>
                
        <div class="step">
          <div class="step-number">3</div>
          <div class="step-content">
            <strong>Configure and start remotes</strong>
            <p>Click on any detected remote to set up its folder location and start commands.</p>
          </div>
        </div>
        
        <div class="step">
          <div class="step-number">4</div>
          <div class="step-content">
            <strong>View the dependency graph</strong>
            <p>Click the graph icon in the toolbar to visualize your Module Federation architecture.</p>
          </div>
        </div>
      </div>
      
      <p style="margin-top: 20px; font-size: 0.9em;">
        You can also open the Module Federation Explorer view by clicking on
        <a href="#" id="directViewLink">Module Federation in the Explorer view</a>.
      </p>

      <a href="https://ko-fi.com/andrecrjr">
        <img src="https://cdn.prod.website-files.com/5c14e387dab576fe667689cf/670f5a01c01ea9191809398c_support_me_on_kofi_blue-p-500.png" alt="KoFi Donation" width="200"/>
      </a>

    </div>

    <script>
      const vscode = acquireVsCodeApi();
      
      document.getElementById('openExplorerBtn').addEventListener('click', () => {
        vscode.postMessage({ command: 'openExtensionExplorer' });
      });
      
      document.getElementById('openDocsBtn').addEventListener('click', () => {
        vscode.postMessage({ command: 'openDocs' });
      });
      
      document.getElementById('directViewLink').addEventListener('click', (e) => {
        e.preventDefault();
        vscode.postMessage({ command: 'openExtensionExplorer' });
      });
    </script>
    </body>
    </html>`;
}

/**
 * Show a setup guide for first-time users
 */
function showSetupGuide(provider: UnifiedModuleFederationProvider) {
  // Check if configuration exists and has any roots
  (provider as any).rootConfigManager.hasConfiguredRoots().then((hasRoots: boolean) => {
    // Only show the guide if there are no configured roots
    if (!hasRoots) {
      // Check if the config file exists at all
      const configPath = (provider as any).rootConfigManager.getConfigPath();
      if (!configPath || !fs.existsSync(configPath)) {
        // Show guide message to help users get started
        DialogUtils.showSetupGuide({
          title: 'Getting Started with Module Federation Explorer',
          steps: [
            {
              title: 'Create Settings',
              description: 'Set up your configuration file to store Module Federation settings',
              action: async () => {
                await vscode.commands.executeCommand('moduleFederation.changeConfigFile');
              }
            },
            {
              title: 'Show Welcome Page',
              description: 'View the welcome page with detailed setup instructions',
              action: async () => {
                await vscode.commands.executeCommand('moduleFederation.showWelcome');
              }
            }
          ]
        });
      }
    }
  }).catch((error: unknown) => {
    console.error('[Module Federation] Failed to check for configured roots:', error);
  });
}