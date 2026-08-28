import * as vscode from 'vscode';
import type { ExplorerApplication } from './explorerApplication';
import type { CommandHandler } from './commandTypes';
import { registerExplorerCommands } from '../features/explorer/registerCommands';
import { registerRootCommands } from '../features/roots/registerCommands';
import { registerRemoteCommands } from '../features/remotes/registerCommands';
import { registerGraphCommands } from '../features/graph/registerCommands';

export const COMMAND_IDS = [
  'moduleFederation.reveal',
  'moduleFederation.openView',
  'moduleFederation.focus',
  'moduleFederation.showWelcome',
  'moduleFederation.showFeedback',
  'moduleFederation.rateExtension',
  'moduleFederation.refresh',
  'moduleFederation.addRoot',
  'moduleFederation.removeRoot',
  'moduleFederation.changeConfigFile',
  'moduleFederation.startRootApp',
  'moduleFederation.stopRootApp',
  'moduleFederation.configureRootApp',
  'moduleFederation.editRootAppCommand',
  'moduleFederation.showDependencyGraph',
  'moduleFederation.cleanupTerminals',
  'moduleFederation.startRemote',
  'moduleFederation.stopRemote',
  'moduleFederation.editCommand',
  'moduleFederation.addExternalRemote',
  'moduleFederation.removeExternalRemote'
] as const;

/** Registers command handlers against application workflows, never against the tree provider. */
export function registerCommands(
  context: vscode.ExtensionContext,
  application: ExplorerApplication
): vscode.Disposable[] {
  const register = (command: string, handler: CommandHandler): vscode.Disposable =>
    vscode.commands.registerCommand(command, handler);

  return [
    ...registerExplorerCommands(context, application, register),
    ...registerRootCommands(application, register),
    ...registerRemoteCommands(application, register),
    ...registerGraphCommands(application, register)
  ];
}
