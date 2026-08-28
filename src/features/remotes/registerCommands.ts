import * as vscode from 'vscode';
import type { ExplorerApplication } from '../../app/explorerApplication';
import type { CommandRegistrar } from '../../app/commandTypes';
import { isRemote, isRemotesFolder } from '../explorer/treeItemFactory';

export function registerRemoteCommands(
  application: ExplorerApplication,
  register: CommandRegistrar
): vscode.Disposable[] {
  return [
    register('moduleFederation.startRemote', value => {
      if (isRemote(value)) return application.startRemote(value);
      return undefined;
    }),
    register('moduleFederation.stopRemote', value => {
      if (isRemote(value)) return application.stopRemote(value);
      return undefined;
    }),
    register('moduleFederation.editCommand', value => {
      if (isRemote(value)) return application.editRemoteCommands(value);
      return undefined;
    }),
    register('moduleFederation.addExternalRemote', value => {
      if (isRemotesFolder(value)) return application.addExternalRemote(value);
      return undefined;
    }),
    register('moduleFederation.removeExternalRemote', value => {
      if (isRemote(value)) return application.removeExternalRemote(value);
      return undefined;
    })
  ];
}
