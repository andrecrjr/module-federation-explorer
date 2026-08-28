import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { ExplorerApplication, type ExplorerApplicationServices } from './explorerApplication';
import type { AsyncFileSystemPort, ApplicationHostPort, FileSystemPort, PathPort, StoragePort, WorkspacePort } from './ports';
import { registerCommands } from './registerCommands';
import { registerTerminalLifecycle, scheduleOnboarding } from './lifecycle';
import { registerWatchers } from './registerWatchers';
import { ExplorerStore } from '../features/explorer/explorerStore';
import { UnifiedModuleFederationProvider } from '../features/explorer/unifiedTreeProvider';
import { ConfigurationService } from '../configurationService';
import { DependencyGraphManager } from '../features/graph/dependencyGraph';
import { DialogUtils } from '../infrastructure/vscode/dialogUtils';
import { outputChannel } from '../infrastructure/vscode/outputChannel';
import { PathResolver } from '../infrastructure/node/pathResolver';
import { detectPackageManagerAndStartCommand } from '../infrastructure/node/packageManager';
import { TerminalManager } from '../infrastructure/vscode/terminalManager';
import { RootConfigManager } from '../features/roots/rootConfigManager';
import { JsonRootConfigRepository } from '../infrastructure/node/rootConfigRepository';
import { trackSuccessAndPrompt } from '../ratingPrompt';
import { initializeRatingState } from '../ratingPrompt';

export interface ExtensionComposition {
  application: ExplorerApplication;
  provider: UnifiedModuleFederationProvider;
}

export function createDefaultExplorerApplicationServices(
  context: vscode.ExtensionContext
): ExplorerApplicationServices {
  const fileSystem: FileSystemPort = {
    existsSync: filePath => fs.existsSync(filePath),
    statSync: filePath => fs.statSync(filePath),
    readdirSync: directoryPath => fs.readdirSync(directoryPath),
    readFileSync: filePath => fs.readFileSync(filePath, 'utf8')
  };
  const asyncFileSystem: AsyncFileSystemPort = {
    isDirectory: async filePath => {
      try {
        return (await fsPromises.stat(filePath)).isDirectory();
      } catch {
        return false;
      }
    },
    readDirectory: directoryPath => fsPromises.readdir(directoryPath)
  };
  const nodePath: PathPort = {
    join: (...parts) => path.join(...parts),
    dirname: filePath => path.dirname(filePath),
    basename: filePath => path.basename(filePath),
    resolve: (...parts) => path.resolve(...parts),
    isAbsolute: filePath => path.isAbsolute(filePath)
  };
  const storage: StoragePort = {
    get: <T>(key: string) => context.workspaceState.get<T>(key),
    update: <T>(key: string, value: T) => context.workspaceState.update(key, value)
  };
  const workspace: WorkspacePort = {
    folders: (vscode.workspace.workspaceFolders ?? []).map(folder => ({
      name: folder.name,
      path: folder.uri.fsPath
    })),
    asRelativePath: filePath => vscode.workspace.asRelativePath(filePath),
    showOpenFile: async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { 'JSON files': ['json'] },
        title: 'Select Module Federation Explorer Configuration File',
        openLabel: 'Select Configuration'
      });
      return uris?.[0]?.fsPath;
    }
  };
  const host: ApplicationHostPort = {
    executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
    setContext: (key, value) => vscode.commands.executeCommand('setContext', key, value),
    withProgress: (title, task) => vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: false
      },
      progress => task(progress)
    ),
    showErrorMessage: message => vscode.window.showErrorMessage(message),
    schedule: (task, delayMs) => {
      const timer = setTimeout(task, delayMs);
      context.subscriptions.push(new vscode.Disposable(() => clearTimeout(timer)));
    }
  };
  const logger = {
    log: (message: string) => outputChannel.appendLine(message),
    logError: (message: string, error: unknown) => outputChannel.appendLine(`${message}: ${String(error)}`)
  };

  return {
    rootConfigManager: new RootConfigManager({
      storage,
      workspace,
      fileSystem: asyncFileSystem,
      path: nodePath,
      dialogs: DialogUtils,
      logger,
      repository: new JsonRootConfigRepository()
    }),
    configurationService: new ConfigurationService(),
    dependencyGraphManager: new DependencyGraphManager(context, message => outputChannel.appendLine(message)),
    terminalManager: new TerminalManager(),
    pathResolver: new PathResolver({ fileSystem, log: logger.log, logError: logger.logError }),
    dialogs: DialogUtils,
    detectPackageManager: detectPackageManagerAndStartCommand,
    logger,
    fileSystem,
    path: nodePath,
    host,
    trackSuccess: event => trackSuccessAndPrompt(context, event)
  };
}

/** Creates the application graph once; activation only composes and registers VS Code adapters. */
export function createCompositionRoot(context: vscode.ExtensionContext): ExtensionComposition {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const store = new ExplorerStore();
  const application = new ExplorerApplication(
    workspaceRoot,
    store,
    createDefaultExplorerApplicationServices(context)
  );
  const provider = new UnifiedModuleFederationProvider(store, {
    isRemoteRunning: remoteKey => application.getRunningRemoteTerminal(remoteKey) !== undefined,
    log: message => application.log(message),
    reorderRoots: (dragged, target) => application.reorderRoots(dragged, target)
  });

  return { application, provider };
}

/** VS Code activation entry point. Business workflows are registered by app modules. */
export async function activate(context: vscode.ExtensionContext): Promise<ExtensionComposition> {
  try {
    const { application, provider } = createCompositionRoot(context);
    context.subscriptions.push(provider);

    const viewId = 'moduleFederation';
    context.subscriptions.push(vscode.window.registerTreeDataProvider(viewId, provider));
    context.subscriptions.push(vscode.window.createTreeView(viewId, {
      treeDataProvider: provider,
      showCollapseAll: true,
      dragAndDropController: provider
    }));

    context.subscriptions.push(...registerCommands(context, application));
    context.subscriptions.push(...registerWatchers(application));
    registerTerminalLifecycle(context, application);
    scheduleOnboarding(context, application);
    await initializeRatingState(context);
    void application.initialize();

    vscode.window.showInformationMessage('Module Federation Explorer is now active!');
    application.log('Extension activated successfully');
    return { application, provider };
  } catch (error) {
    vscode.window.showErrorMessage(
      `Module Federation Explorer failed to activate: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}
