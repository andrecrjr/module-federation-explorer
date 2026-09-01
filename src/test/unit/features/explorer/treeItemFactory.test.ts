import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  createTreeItem,
  isEmptyState,
  isExposedModule,
  isExposesFolder,
  isLoadingPlaceholder,
  isRemote,
  isRemotesFolder,
  isRootFolder
} from '../../../../features/explorer/treeItemFactory';
import type { ModuleFederationConfig } from '../../../../federation/types';
import type { RootFolder } from '../../../../features/explorer/types';

function config(configPath = '/workspace/host/webpack.config.ts'): ModuleFederationConfig {
  return {
    name: 'host',
    remotes: [],
    exposes: [],
    shared: [],
    provenance: 'static',
    detected: true,
    configType: 'webpack',
    configPath
  };
}

suite('TreeItemFactory', () => {
  test('renders an external remote with external context', () => {
    const item = createTreeItem(
      {
        name: 'auth',
        url: 'https://example.test/remoteEntry.js',
        folder: '',
        packageManager: '',
        configType: 'external',
        isExternal: true
      },
      () => false
    );

    assert.strictEqual(item.label, 'auth');
    assert.strictEqual(item.contextValue, 'externalRemote');
  });

  test('renders the loading placeholder', () => {
    const item = createTreeItem(
      {
        type: 'loadingPlaceholder',
        name: 'Loading configurations...'
      },
      () => false
    );

    assert.strictEqual(item.label, 'Loading Module Federation configurations...');
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });

  test('renders the empty state with guidance', () => {
    const item = createTreeItem(
      {
        type: 'emptyState',
        name: 'No hosts',
        description: 'Add a host to begin'
      },
      () => false
    );

    assert.strictEqual(item.label, 'No hosts');
    assert.strictEqual(item.description, 'Add a host to begin');
    assert.ok(item.tooltip instanceof vscode.MarkdownString);
  });

  test('uses distinct root contexts for plain, configurable, and running roots', () => {
    const roots: RootFolder[] = [
      { type: 'rootFolder', path: '/workspace/plain', name: 'plain', configs: [] },
      {
        type: 'rootFolder',
        path: '/workspace/configured',
        name: 'configured',
        configs: [config()],
        startCommand: 'npm start'
      },
      {
        type: 'rootFolder',
        path: '/workspace/running',
        name: 'running',
        configs: [config()],
        startCommand: 'npm start',
        isRunning: true
      }
    ];

    assert.strictEqual(createTreeItem(roots[0], () => false).contextValue, 'rootFolder');
    assert.strictEqual(createTreeItem(roots[1], () => false).contextValue, 'configurableRootApp');
    assert.strictEqual(createTreeItem(roots[2], () => false).contextValue, 'runningRootApp');
  });

  test('renders expandable and empty remotes and exposes folders', () => {
    const remote = {
      name: 'auth',
      folder: '/workspace/auth',
      packageManager: 'npm',
      configType: 'webpack' as const
    };
    const module = { name: 'Shell', path: './src/Shell.tsx', remoteName: 'host' };

    assert.strictEqual(
      createTreeItem({ type: 'remotesFolder', parentName: 'host', remotes: [remote] }, () => false).collapsibleState,
      vscode.TreeItemCollapsibleState.Expanded
    );
    assert.strictEqual(
      createTreeItem({ type: 'remotesFolder', parentName: 'host', remotes: [] }, () => false).collapsibleState,
      vscode.TreeItemCollapsibleState.None
    );
    assert.strictEqual(
      createTreeItem({ type: 'exposesFolder', parentName: 'host', exposes: [module] }, () => false).collapsibleState,
      vscode.TreeItemCollapsibleState.Expanded
    );
    assert.strictEqual(
      createTreeItem({ type: 'exposesFolder', parentName: 'host', exposes: [] }, () => false).collapsibleState,
      vscode.TreeItemCollapsibleState.None
    );
  });

  test('renders external, running, configured, and unconfigured remotes', () => {
    const external = createTreeItem(
      {
        name: 'catalog',
        url: 'https://example.test/remoteEntry.js',
        remoteEntry: 'https://example.test/remoteEntry.js',
        folder: '',
        packageManager: '',
        configType: 'external',
        isExternal: true
      },
      () => false
    );
    const running = createTreeItem(
      {
        name: 'auth',
        folder: '/workspace/auth',
        packageManager: 'npm',
        configType: 'webpack',
        startCommand: 'npm start'
      },
      key => key === 'remote-auth'
    );
    const configured = createTreeItem(
      {
        name: 'catalog',
        folder: '/workspace/catalog',
        packageManager: 'pnpm',
        configType: 'vite',
        startCommand: 'pnpm dev',
        buildCommand: 'pnpm build'
      },
      () => false
    );
    const unconfigured = createTreeItem(
      {
        name: 'payments',
        folder: '',
        packageManager: 'npm',
        configType: 'webpack'
      },
      () => false
    );

    assert.strictEqual(external.contextValue, 'externalRemote');
    assert.strictEqual(running.contextValue, 'runningRemote');
    assert.strictEqual(configured.contextValue, 'remote');
    assert.strictEqual(unconfigured.contextValue, 'unconfiguredRemote');
    assert.strictEqual(configured.description, undefined);
  });

  test('renders exposed modules and opens modules with a known source config', () => {
    const module = createTreeItem(
      {
        name: 'Shell',
        path: './src/Shell.tsx',
        remoteName: 'host',
        configSource: '/workspace/host/webpack.config.ts'
      },
      () => false
    );
    const sourceLessModule = createTreeItem(
      {
        name: 'Header',
        path: './src/Header.tsx',
        remoteName: 'host'
      },
      () => false
    );

    assert.strictEqual(module.label, 'Shell');
    assert.ok(module.command);
    assert.strictEqual(sourceLessModule.command, undefined);
  });

  test('rejects unknown tree elements and keeps type guards strict', () => {
    assert.strictEqual(isRootFolder(null), false);
    assert.strictEqual(isRemotesFolder([]), false);
    assert.strictEqual(isExposesFolder('folder'), false);
    assert.strictEqual(isLoadingPlaceholder({ type: 'rootFolder' }), false);
    assert.strictEqual(isEmptyState({ type: 'rootFolder' }), false);
    assert.strictEqual(isRemote({ type: 'remote' }), false);
    assert.strictEqual(isExposedModule({ name: 'remote' }), false);
    assert.throws(() => createTreeItem({} as never, () => false), /Unknown element type/);
  });
});
