import * as assert from 'assert';
import { ExplorerStore } from '../../../../features/explorer/explorerStore';
import { UnifiedModuleFederationProvider } from '../../../../features/explorer/unifiedTreeProvider';
import type { ModuleFederationConfig } from '../../../../federation/types';
import type { RootFolder } from '../../../../features/explorer/types';
import type { TreeElement } from '../../../../features/explorer/treeItemFactory';
import type { CancellationToken, DataTransfer, DataTransferItem } from 'vscode';

function createConfig(): ModuleFederationConfig {
  return {
    name: 'host',
    remotes: [
      {
        name: 'auth',
        folder: '/workspace/auth',
        packageManager: 'npm',
        configType: 'webpack'
      }
    ],
    exposes: [{ name: 'Shell', path: './src/Shell.tsx', remoteName: 'host' }],
    shared: [],
    provenance: 'static',
    detected: true,
    configType: 'webpack',
    configPath: '/workspace/host/webpack.config.ts'
  };
}

function createProvider(store = new ExplorerStore()): UnifiedModuleFederationProvider {
  return new UnifiedModuleFederationProvider(store, {
    isRemoteRunning: () => false,
    log: () => {},
    reorderRoots: async () => {}
  });
}

suite('UnifiedModuleFederationProvider', () => {
  test('keeps tree behavior behind the provider facade', async () => {
    const provider = createProvider();
    const rootFolder: RootFolder = {
      type: 'rootFolder',
      path: '/workspace/host',
      name: 'host',
      configs: [createConfig()]
    };

    const children = await provider.getChildren(rootFolder);
    assert.deepStrictEqual(
      children.map(child => ('type' in child ? child.type : 'remote')),
      ['remotesFolder', 'exposesFolder']
    );
    assert.strictEqual(provider.getTreeItem(rootFolder).label, 'host');
  });

  test('refreshes when the explorer store snapshot changes', () => {
    const store = new ExplorerStore();
    const provider = createProvider(store);
    let refreshes = 0;
    const subscription = provider.onDidChangeTreeData(() => refreshes++);

    store.replace(new Map());

    assert.strictEqual(refreshes, 1);
    subscription.dispose();
    provider.dispose();
  });

  test('returns a loading placeholder while configurations are being loaded', async () => {
    const store = new ExplorerStore();
    store.setLoading(true);
    const provider = createProvider(store);

    const children = await provider.getChildren();

    assert.deepStrictEqual(children, [{ type: 'loadingPlaceholder', name: 'Loading configurations...' }]);
    provider.dispose();
  });

  test('serves every supported child shape from the store', async () => {
    const store = new ExplorerStore();
    const rootFolder: RootFolder = {
      type: 'rootFolder',
      path: '/workspace/host',
      name: 'host',
      configs: [createConfig()]
    };
    rootFolder.configs[0].exposes.push({ name: 'Auth', path: './src/Auth.tsx', remoteName: 'auth' });
    store.setRootFolders([rootFolder]);
    store.replace(new Map([['/workspace/host', rootFolder.configs]]));
    const provider = createProvider(store);
    const rootChildren = await provider.getChildren(rootFolder);
    const remotesFolder = rootChildren[0];
    const exposesFolder = rootChildren[1];
    const remote = rootFolder.configs[0].remotes[0];
    const exposedModule = rootFolder.configs[0].exposes[0];

    assert.strictEqual((await provider.getChildren())[0], rootFolder);
    assert.strictEqual((await provider.getChildren(remotesFolder)).length, 1);
    assert.strictEqual((await provider.getChildren(exposesFolder)).length, 2);
    assert.strictEqual((await provider.getChildren(remote)).length, 1);
    assert.deepStrictEqual(await provider.getChildren(exposedModule), []);
    assert.deepStrictEqual(await provider.getChildren({} as TreeElement), []);
    provider.dispose();
  });

  test('only drags roots and accepts drops onto roots', async () => {
    const provider = createProvider();
    const root: RootFolder = {
      type: 'rootFolder',
      path: '/workspace/host',
      name: 'host',
      configs: []
    };
    const otherRoot: RootFolder = {
      type: 'rootFolder',
      path: '/workspace/other',
      name: 'other',
      configs: []
    };
    let dragged: unknown;
    const transfer = {
      set: (_mime: string, item: DataTransferItem) => {
        dragged = item.value;
      }
    } as unknown as DataTransfer;

    provider.handleDrag([root], transfer, {} as CancellationToken);
    assert.strictEqual(dragged, root);
    dragged = undefined;
    provider.handleDrag([root, otherRoot], transfer, {} as CancellationToken);
    assert.strictEqual(dragged, undefined);

    const reordered: Array<{ dragged: RootFolder; target?: RootFolder }> = [];
    const dropProvider = new UnifiedModuleFederationProvider(new ExplorerStore(), {
      isRemoteRunning: () => false,
      log: () => {},
      reorderRoots: async (source, target) => {
        reordered.push({ dragged: source, target });
      }
    });
    const dropTransfer = {
      get: () => ({ value: root })
    } as unknown as DataTransfer;
    await dropProvider.handleDrop(otherRoot, dropTransfer, {} as CancellationToken);
    await dropProvider.handleDrop({} as TreeElement, dropTransfer, {} as CancellationToken);
    assert.deepStrictEqual(reordered, [{ dragged: root, target: otherRoot }]);
    dropProvider.dispose();
    provider.dispose();
  });
});
