import * as vscode from 'vscode';
import type { ExplorerApplication } from '../../app/explorerApplication';
import type { CommandRegistrar } from '../../app/commandTypes';
import { showWelcomePage } from '../../app/welcome';

export function registerExplorerCommands(
  context: vscode.ExtensionContext,
  application: ExplorerApplication,
  register: CommandRegistrar
): vscode.Disposable[] {
  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  const focusTimerOwner = new vscode.Disposable(() => {
    if (focusTimer) clearTimeout(focusTimer);
  });

  return [
    focusTimerOwner,
    register('moduleFederation.reveal', () => {
      void vscode.commands.executeCommand('workbench.view.explorer');
      void vscode.commands.executeCommand('moduleFederation.focus');
    }),
    register('moduleFederation.openView', () => {
      void vscode.commands.executeCommand('workbench.view.explorer');
      if (focusTimer) clearTimeout(focusTimer);
      focusTimer = setTimeout(() => {
        focusTimer = undefined;
        void vscode.commands.executeCommand('moduleFederation.focus');
      }, 300);
    }),
    register('moduleFederation.focus', () => vscode.commands.executeCommand('workbench.view.explorer')),
    register('moduleFederation.showWelcome', () => showWelcomePage(context)),
    register('moduleFederation.showFeedback', () => application.openFeedback()),
    register('moduleFederation.rateExtension', () => application.openMarketplaceReview()),
    register('moduleFederation.refresh', () => application.reloadConfigurations())
  ];
}
