import * as vscode from 'vscode';
import { ExplorerApplication, createDefaultExplorerApplicationServices } from './explorerApplication';
import { registerCommands } from './registerCommands';
import { registerTerminalLifecycle, scheduleOnboarding } from './lifecycle';
import { registerWatchers } from './registerWatchers';
import { ExplorerStore } from '../features/explorer/explorerStore';
import { UnifiedModuleFederationProvider } from '../features/explorer/unifiedTreeProvider';
import { initializeRatingState } from '../ratingPrompt';

export interface ExtensionComposition {
  application: ExplorerApplication;
  provider: UnifiedModuleFederationProvider;
}

/** Creates the application graph once; activation only composes and registers VS Code adapters. */
export function createCompositionRoot(context: vscode.ExtensionContext): ExtensionComposition {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const store = new ExplorerStore();
  const application = new ExplorerApplication(
    context,
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
