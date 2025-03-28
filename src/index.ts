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