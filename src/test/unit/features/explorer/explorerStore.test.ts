import * as assert from 'assert';
import { ExplorerStore } from '../../../../features/explorer/explorerStore';
import type { ModuleFederationConfig } from '../../../../federation/types';
import type { ManifestLoadError, ManifestRecord } from '../../../../federation/manifestTypes';
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
  test('keeps manifest records and diagnostics separate from static configurations', () => {
    const store = new ExplorerStore();
    const record: ManifestRecord = {
      provenance: 'manifest',
      id: 'host-id',
      name: 'host',
      metadata: { assets: [], disableAssetsAnalyze: false },
      shared: [],
      remotes: [],
      exposes: [],
      source: { kind: 'local', location: '/workspace/host/mf-manifest.json' },
      manifestPath: '/workspace/host/mf-manifest.json',
      loadedAt: '2026-09-01T00:00:00.000Z',
      diagnostics: []
    };
    const error: ManifestLoadError = {
      source: { kind: 'url', location: 'https://example.test/mf-manifest.json' },
      error: new Error('offline'),
      diagnostics: []
    };

    store.replaceManifests([record], [error]);

    assert.deepStrictEqual(store.getSnapshot().manifests, [record]);
    assert.deepStrictEqual(store.getSnapshot().manifestErrors, [error]);
    assert.deepStrictEqual(store.getManifests(), [record]);
    assert.deepStrictEqual(store.getManifestErrors(), [error]);
    assert.equal(store.getSnapshot().configs.size, 0);
  });

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
    store.setManifestLoading(true);
    store.replace(configs);
    store.setRootFolders(rootFolders);
    store.setLoading(false);

    const snapshot = store.getSnapshot();
    assert.strictEqual(snapshot.configs, configs);
    assert.deepStrictEqual(snapshot.rootFolders, rootFolders);
    assert.strictEqual(snapshot.isLoading, false);
    assert.strictEqual(snapshot.isManifestLoading, true);
    assert.strictEqual(changes.length, 5);

    unsubscribe();
    store.clear();
    assert.strictEqual(store.getSnapshot().configs.size, 0);
    assert.strictEqual(changes.length, 5);
  });

  test('returns a read-only snapshot shape to tree consumers', () => {
    const store = new ExplorerStore();
    store.replace(new Map([['/workspace/host', [config('host')]]]));

    const snapshot = store.getSnapshot();
    assert.strictEqual(typeof snapshot.configs.get, 'function');
    assert.strictEqual(typeof snapshot.rootFolders.map, 'function');
  });
});
