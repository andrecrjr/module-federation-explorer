import * as vscode from 'vscode';
import type { ExplorerApplication } from '../../app/explorerApplication';
import type { CommandRegistrar } from '../../app/commandTypes';

export function registerGraphCommands(
  application: ExplorerApplication,
  register: CommandRegistrar
): vscode.Disposable[] {
  return [
    register('moduleFederation.showDependencyGraph', () => application.showDependencyGraph()),
    register('moduleFederation.cleanupTerminals', () => application.cleanupDisposedTerminals())
  ];
}
