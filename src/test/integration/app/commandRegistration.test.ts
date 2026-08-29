import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { registerExplorerCommands } from '../../../features/explorer/registerCommands';
import { registerGraphCommands } from '../../../features/graph/registerCommands';
import { registerRemoteCommands } from '../../../features/remotes/registerCommands';
import { registerRootCommands } from '../../../features/roots/registerCommands';
import type { ExplorerApplication } from '../../../app/explorerApplication';
import type { CommandHandler, CommandRegistrar } from '../../../app/commandTypes';
import type { Remote } from '../../../federation/types';
import type { RemotesFolder, RootFolder } from '../../../features/explorer/types';

function captureHandlers(
  registerCommands: (register: CommandRegistrar) => vscode.Disposable[]
): Map<string, CommandHandler> {
  const handlers = new Map<string, CommandHandler>();
  const register: CommandRegistrar = (command, handler) => {
    handlers.set(command, handler);
    return new vscode.Disposable(() => {});
  };
  const disposables = registerCommands(register);
  disposables.forEach(disposable => disposable.dispose());
  return handlers;
}

function createApplicationSpy(): {
  application: ExplorerApplication;
  calls: Array<{ method: string; value: unknown }>;
} {
  const calls: Array<{ method: string; value: unknown }> = [];
  const application = {
    addRoot: async () => {
      calls.push({ method: 'addRoot', value: undefined });
    },
    removeRoot: async (value: RootFolder) => {
      calls.push({ method: 'removeRoot', value });
    },
    changeConfigFile: async () => {
      calls.push({ method: 'changeConfigFile', value: undefined });
    },
    startRootApp: async (value: RootFolder) => {
      calls.push({ method: 'startRootApp', value });
    },
    stopRootApp: async (value: RootFolder) => {
      calls.push({ method: 'stopRootApp', value });
    },
    configureRootAppStartCommand: async (value: RootFolder) => {
      calls.push({ method: 'configureRootAppStartCommand', value });
    },
    editRootAppCommands: async (value: RootFolder) => {
      calls.push({ method: 'editRootAppCommands', value });
    },
    startRemote: async (value: Remote) => {
      calls.push({ method: 'startRemote', value });
    },
    stopRemote: async (value: Remote) => {
      calls.push({ method: 'stopRemote', value });
    },
    editRemoteCommands: async (value: Remote) => {
      calls.push({ method: 'editRemoteCommands', value });
    },
    addExternalRemote: async (value: RemotesFolder) => {
      calls.push({ method: 'addExternalRemote', value });
    },
    removeExternalRemote: async (value: Remote) => {
      calls.push({ method: 'removeExternalRemote', value });
    },
    showDependencyGraph: async () => {
      calls.push({ method: 'showDependencyGraph', value: undefined });
    },
    cleanupDisposedTerminals: () => {
      calls.push({ method: 'cleanupDisposedTerminals', value: undefined });
    },
    reloadConfigurations: async () => {
      calls.push({ method: 'reloadConfigurations', value: undefined });
    },
    openFeedback: async () => {
      calls.push({ method: 'openFeedback', value: undefined });
    },
    openMarketplaceReview: async () => {
      calls.push({ method: 'openMarketplaceReview', value: undefined });
    }
  } as unknown as ExplorerApplication;
  return { application, calls };
}

const root: RootFolder = {
  type: 'rootFolder',
  path: '/workspace/host',
  name: 'host',
  configs: []
};

const remote: Remote = {
  name: 'auth',
  folder: '/workspace/auth',
  packageManager: 'npm',
  configType: 'webpack'
};

const remotesFolder: RemotesFolder = {
  type: 'remotesFolder',
  parentName: 'host',
  parentPath: '/workspace/host',
  remotes: []
};

suite('Command registration', () => {
  test('guards root commands with the root-folder type predicate', async () => {
    const harness = createApplicationSpy();
    const handlers = captureHandlers(register => registerRootCommands(harness.application, register));

    await handlers.get('moduleFederation.startRootApp')!({ name: 'not-a-root' });
    await handlers.get('moduleFederation.startRootApp')!(root);

    assert.deepEqual(
      harness.calls.map(call => call.method),
      ['startRootApp']
    );
  });

  test('guards remote and remotes-folder commands before delegating', async () => {
    const harness = createApplicationSpy();
    const handlers = captureHandlers(register => registerRemoteCommands(harness.application, register));

    await handlers.get('moduleFederation.startRemote')!({ type: 'remote' });
    await handlers.get('moduleFederation.startRemote')!(remote);
    await handlers.get('moduleFederation.addExternalRemote')!({ name: 'not-a-folder' });
    await handlers.get('moduleFederation.addExternalRemote')!(remotesFolder);

    assert.deepEqual(
      harness.calls.map(call => call.method),
      ['startRemote', 'addExternalRemote']
    );
  });

  test('registers graph actions against the application boundary', async () => {
    const harness = createApplicationSpy();
    const handlers = captureHandlers(register => registerGraphCommands(harness.application, register));

    await handlers.get('moduleFederation.showDependencyGraph')!();
    handlers.get('moduleFederation.cleanupTerminals')!();

    assert.deepEqual(
      harness.calls.map(call => call.method),
      ['showDependencyGraph', 'cleanupDisposedTerminals']
    );
  });

  test('routes feedback commands through the application boundary', async () => {
    const harness = createApplicationSpy();
    const handlers = captureHandlers(register =>
      registerExplorerCommands({} as vscode.ExtensionContext, harness.application, register)
    );

    await handlers.get('moduleFederation.showFeedback')!();
    await handlers.get('moduleFederation.rateExtension')!();

    assert.deepEqual(
      harness.calls.map(call => call.method),
      ['openFeedback', 'openMarketplaceReview']
    );
  });
});
