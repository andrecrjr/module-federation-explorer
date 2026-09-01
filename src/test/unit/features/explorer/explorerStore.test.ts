import * as assert from 'assert';
import { ExplorerStore } from '../../../../features/explorer/explorerStore';
import type { ModuleFederationConfig } from '../../../../federation/types';
import type { RootFolder } from '../../../../features/explorer/types';

function config(name: string): ModuleFederationConfig {
  return {
    name,
    remotes: [],
    exposes: [],
    shared: [],
    provenance: 'static',
    detected: true,
    configType: 'webpack',
    configPath: `/workspace/${name}/webpack.config.ts`
  };
}

suite('ExplorerStore', () => {
  test('owns the configuration snapshot and notifies subscribers', () => {
    const store = new ExplorerStore();
    const changes: number[] = [];
    const unsubscribe = store.subscribe(() => changes.push(1));
    const configs = new Map<string, ModuleFederationConfig[]>([['/workspace/host', [config('host')]]]);
    const rootFolders: RootFolder[] = [
      {
        type: 'rootFolder',
        path: '/workspace/host',
        name: 'host',
        configs: configs.get('/workspace/host')!
      }
    ];

    store.setLoading(true);
    store.replace(configs);
    store.setRootFolders(rootFolders);
    store.setLoading(false);

    const snapshot = store.getSnapshot();
    assert.strictEqual(snapshot.configs, configs);
    assert.deepStrictEqual(snapshot.rootFolders, rootFolders);
    assert.strictEqual(snapshot.isLoading, false);
    assert.strictEqual(changes.length, 4);

    unsubscribe();
    store.clear();
    assert.strictEqual(store.getSnapshot().configs.size, 0);
    assert.strictEqual(changes.length, 4);
  });

  test('returns a read-only snapshot shape to tree consumers', () => {
    const store = new ExplorerStore();
    store.replace(new Map([['/workspace/host', [config('host')]]]));

    const snapshot = store.getSnapshot();
    assert.strictEqual(typeof snapshot.configs.get, 'function');
    assert.strictEqual(typeof snapshot.rootFolders.map, 'function');
  });
});
