import * as vscode from 'vscode';
import type { ExplorerApplication } from '../../app/explorerApplication';
import type { CommandRegistrar } from '../../app/commandTypes';
import { isRootFolder } from '../explorer/treeItemFactory';

export function registerRootCommands(
  application: ExplorerApplication,
  register: CommandRegistrar
): vscode.Disposable[] {
  return [
    register('moduleFederation.addRoot', () => application.addRoot()),
    register('moduleFederation.removeRoot', value => {
      if (isRootFolder(value)) return application.removeRoot(value);
      return undefined;
    }),
    register('moduleFederation.changeConfigFile', () => application.changeConfigFile()),
    register('moduleFederation.startRootApp', value => {
      if (isRootFolder(value)) return application.startRootApp(value);
      return undefined;
    }),
    register('moduleFederation.stopRootApp', value => {
      if (isRootFolder(value)) return application.stopRootApp(value);
      return undefined;
    }),
    register('moduleFederation.configureRootApp', value => {
      if (isRootFolder(value)) return application.configureRootAppStartCommand(value);
      return undefined;
    }),
    register('moduleFederation.editRootAppCommand', value => {
      if (isRootFolder(value)) return application.editRootAppCommands(value);
      return undefined;
    })
  ];
}
