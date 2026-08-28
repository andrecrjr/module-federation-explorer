import * as assert from 'assert';
import { ExplorerStore } from '../features/explorer/explorerStore';
import { UnifiedModuleFederationProvider } from '../unifiedTreeProvider';
import { ModuleFederationConfig, RootFolder } from '../types';

function createConfig(): ModuleFederationConfig {
  return {
    name: 'host',
    remotes: [{
      name: 'auth',
      folder: '/workspace/auth',
      packageManager: 'npm',
      configType: 'webpack'
    }],
    exposes: [{ name: 'Shell', path: './src/Shell.tsx', remoteName: 'host' }],
    shared: [],
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
      children.map(child => 'type' in child ? child.type : 'remote'),
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
});
