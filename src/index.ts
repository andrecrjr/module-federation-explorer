import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Remote } from './types';
import { UnifiedModuleFederationProvider } from './unifiedTreeProvider';

/**
 * Activate the extension
 */
export function activate(context: vscode.ExtensionContext) {
  try {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    
    // Create the unified provider instead of the old one
    const provider = new UnifiedModuleFederationProvider(workspaceRoot, context);
    
    // Clear any previously running remotes (in case of extension restart)
    provider.clearAllRunningApps();
    
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
      vscode.commands.registerCommand('moduleFederation.changeConfigFile', () => provider.changeConfigFile()),
      
      // Root app commands
      vscode.commands.registerCommand('moduleFederation.startRootApp', (rootFolder) => provider.startRootApp(rootFolder)),
      vscode.commands.registerCommand('moduleFederation.stopRootApp', (rootFolder) => provider.stopRootApp(rootFolder)),
      vscode.commands.registerCommand('moduleFederation.configureRootApp', (rootFolder) => provider.configureRootAppStartCommand(rootFolder)),
      
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
          // Call the provider's method to resolve the proper folder path
          const resolvedFolderPath = (provider as any).resolveRemoteFolderPath(remote);
          provider.log(`Starting remote ${remote.name}, folder: ${resolvedFolderPath || 'not set'}`);
          
          // First, let the user select or confirm the remote folder
          let folder = resolvedFolderPath;
          
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
            
            // Save the folder configuration using the unified provider
            await (provider as any).saveRemoteConfiguration(remote);
            
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
              
              // Save the folder configuration using the unified provider
              await (provider as any).saveRemoteConfiguration(remote);
              
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
            
            // Save the updated configuration using the unified provider
            await (provider as any).saveRemoteConfiguration(remote);
            
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
          terminal.sendText(`cd "${folder}" && ${remote.buildCommand} && ${remote.startCommand}`);
          
          // Store running remote info
          provider.setRunningRemote(remoteKey, terminal);
          provider.refresh();
          
          vscode.window.showInformationMessage(`Started remote ${remote.name}`);
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to start remote ${remote.name}: ${error}`);
        }
      }),

      vscode.commands.registerCommand('moduleFederation.configureRemote', async (remote: Remote) => {
        try {
          // Call the provider's method to resolve the proper folder path
          const resolvedFolderPath = (provider as any).resolveRemoteFolderPath(remote);
          let folder = resolvedFolderPath;
          
          // First, let the user select a folder if not already configured
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
          
          // Save configuration using the unified provider
          await (provider as any).saveRemoteConfiguration(remote);
          
          // Refresh the tree view
          provider.reloadConfigurations();
          
          vscode.window.showInformationMessage(`Updated configuration for ${remote.name}`);
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to configure commands for ${remote.name}: ${error}`);
        }
      }),

      vscode.commands.registerCommand('moduleFederation.showWelcome', () => {
        // Create and show welcome page instead of just an information message
        showWelcomePage(context);
      }),

      // Add command to open the exposed module path
      vscode.commands.registerCommand('moduleFederation.openExposedPath', async (exposedModule) => {
        try {
          // Get the module path
          const modulePath = exposedModule.path;
          if (!modulePath) {
            return vscode.window.showErrorMessage(`Cannot open path for module ${exposedModule.name}: Path not defined`);
          }

          // First try to find the file using workspace search
          const uris = await vscode.workspace.findFiles(`**/${modulePath}`, '**/node_modules/**');
          
          if (uris.length > 0) {
            // Open the first matching file
            await vscode.window.showTextDocument(uris[0]);
            return;
          }
          
          // If we have configSource, try to use it to create an absolute path
          if (exposedModule.configSource) {
            // Get the directory containing the config file
            const configDir = path.dirname(exposedModule.configSource);
            let absolutePath = path.resolve(configDir, modulePath);
            
            try {
              // Check if the file exists
              if (fs.existsSync(absolutePath)) {
                await vscode.window.showTextDocument(vscode.Uri.file(absolutePath));
                return;
              }
              
              // If path doesn't have extension, try to resolve it using provider's helper
              if (!path.extname(absolutePath)) {
                const resolvedPath = await provider.resolveFileExtensionForPath(absolutePath);
                if (resolvedPath !== absolutePath && fs.existsSync(resolvedPath)) {
                  await vscode.window.showTextDocument(vscode.Uri.file(resolvedPath));
                  return;
                }
              }
            } catch (error) {
              // Continue to other methods if this fails
              provider.log(`Error resolving absolute path: ${error}`);
            }
          }
          
          // If no results, try to resolve the path against the workspace root
          if (vscode.workspace.workspaceFolders?.length) {
            for (const folder of vscode.workspace.workspaceFolders) {
              let fullPath = vscode.Uri.joinPath(folder.uri, modulePath);
              
              try {
                const stat = await vscode.workspace.fs.stat(fullPath);
                if (stat) {
                  // If file exists, open it
                  await vscode.window.showTextDocument(fullPath);
                  return;
                }
              } catch (error) {
                // File not found at this path, try with extension resolution
                
                if (!path.extname(fullPath.fsPath)) {
                  const resolvedPath = await provider.resolveFileExtensionForPath(fullPath.fsPath);
                  if (resolvedPath !== fullPath.fsPath && fs.existsSync(resolvedPath)) {
                    await vscode.window.showTextDocument(vscode.Uri.file(resolvedPath));
                    return;
                  }
                }
              }
            }
          }
          
          vscode.window.showErrorMessage(`Could not find file matching path: ${modulePath}`);
        } catch (error) {
          vscode.window.showErrorMessage(`Error opening exposed path: ${error}`);
        }
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
  // Create and show panel
  const panel = vscode.window.createWebviewPanel(
    'moduleFederationWelcome',
    'Welcome to Module Federation Explorer',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
    }
  );

  // Set HTML content
  panel.webview.html = getWelcomePageHtml(context, panel.webview);
}

/**
 * Returns the HTML content for the welcome page
 */
function getWelcomePageHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  // You can add CSS styles and even images from your extension's media folder
  const stylePath = vscode.Uri.joinPath(context.extensionUri, 'media', 'welcome.css');
  const styleUri = webview.asWebviewUri(stylePath);
  
  // You could also add a logo image
  const logoPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'logo.png');
  const logoUri = webview.asWebviewUri(logoPath);

  return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Module Federation Explorer</title>
        <link rel="stylesheet" href="${styleUri}">
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; 
            line-height: 1.6; 
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            max-width: 800px; 
            margin: 0 auto; 
            padding: 20px; 
          }
          .container { 
            padding: 20px; 
            border-radius: 6px; 
          }
          h1, h2, h3, h4 { 
            color: var(--vscode-foreground); 
            font-weight: 600;
          }
          .content { 
            margin: 20px 0; 
          }
          .tip { 
            background-color: var(--vscode-notifications-background);
            color: var(--vscode-notifications-foreground); 
            border-left: 4px solid var(--vscode-notificationLink-foreground); 
            padding: 10px 16px; 
            margin: 20px 0; 
          }
          .feature-section { 
            margin-bottom: 24px; 
          }
          code { 
            background-color: var(--vscode-textPreformat-background); 
            color: var(--vscode-textPreformat-foreground);
            padding: 2px 4px; 
            border-radius: 3px; 
            font-family: 'Courier New', monospace; 
          }
          .card { 
            border: 1px solid var(--vscode-widget-border); 
            background-color: var(--vscode-editor-background);
            border-radius: 6px; 
            padding: 16px; 
            margin-bottom: 16px; 
          }
          .card h4 { 
            margin-top: 0; 
            color: var(--vscode-editor-foreground);
          }
          ul, ol {
            color: var(--vscode-foreground);
          }
          a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
          }
          a:hover {
            text-decoration: underline;
            color: var(--vscode-textLink-activeForeground);
          }
          p, li {
            color: var(--vscode-foreground);
          }
          footer {
            margin-top: 30px;
            border-top: 1px solid var(--vscode-widget-border);
            padding-top: 16px;
          }
        </style>
    </head>
    <body>
        <div class="container">
            <header>
                <img src="${logoUri}" alt="Module Federation Logo" width="80" height="80">
                <h1>Welcome to Module Federation Explorer</h1>
            </header>
            
            <section class="content">
                <p>
                    Module Federation Explorer helps you visualize, configure, and manage Module Federation setups
                    across multiple projects, supporting webpack, Vite, and ModernJS configurations.
                </p>
                
                <div class="feature-section">
                    <h2>Key Features</h2>
                    <div class="card">
                        <h4>Multi-Root Support</h4>
                        <p>Manage Module Federation across multiple project roots in your workspace:</p>
                        <ul>
                            <li>Add or remove project roots</li>
                            <li>Automatically discovers webpack, Vite, and ModernJS configurations</li>
                            <li>Configured roots are saved in <code>.vscode/mf-explorer.roots.json</code></li>
                        </ul>
                    </div>
                    
                    <div class="card">
                        <h4>Remote Management</h4>
                        <p>Start and manage your Module Federation remotes:</p>
                        <ul>
                            <li>Configure build and start commands for each remote</li>
                            <li>Start and stop remotes directly from VS Code</li>
                            <li>Automatically detects package manager (npm, yarn, pnpm)</li>
                            <li>Navigate to exposed module source files</li>
                        </ul>
                    </div>
                    
                    <div class="card">
                        <h4>Configuration Visualization</h4>
                        <p>Explore your Module Federation configurations:</p>
                        <ul>
                            <li>View all exposed modules</li>
                            <li>See which remotes are currently running</li>
                            <li>Auto-detects configuration changes</li>
                        </ul>
                    </div>
                </div>
                
                <h2>Getting Started</h2>
                <ol>
                    <li>Open the Module Federation Explorer view in the sidebar</li>
                    <li>Use the "Add Root" command to add your first project root</li>
                    <li>The extension will automatically scan for Module Federation configurations</li>
                    <li>Right-click on remotes to start, stop, or configure them</li>
                    <li>Click on exposed modules to navigate to their source code</li>
                </ol>
                
                <div class="tip">
                    <h4>Commands You Can Use:</h4>
                    <ul>
                        <li><code>moduleFederation.refresh</code> - Reload all configurations</li>
                        <li><code>moduleFederation.addRoot</code> - Add a new project root</li>
                        <li><code>moduleFederation.removeRoot</code> - Remove a project root</li>
                        <li><code>moduleFederation.startRemote</code> - Start a remote app</li>
                        <li><code>moduleFederation.stopRemote</code> - Stop a running remote</li>
                        <li><code>moduleFederation.configureRemote</code> - Set build and start commands</li>
                    </ul>
                </div>
                
                <div class="tip">
                    <h4>Automatic Updates:</h4>
                    <p>The extension automatically watches for changes in your configuration files:</p>
                    <ul>
                        <li>webpack.config.js/ts</li>
                        <li>vite.config.js/ts</li>
                        <li>module-federation.config.js/ts</li>
                        <li>.vscode/mf-explorer.roots.json</li>
                    </ul>
                </div>
            </section>
            
            <footer>
                <p>For issues or feature requests, please visit the <a href="https://github.com/your-repo/module-federation-explorer">GitHub repository</a>.</p>
            </footer>
        </div>
    </body>
    </html>`;
}