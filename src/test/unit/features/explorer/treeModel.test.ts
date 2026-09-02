import * as assert from 'assert';
import {
  buildRemoteExposedModulesIndex,
  getRemoteExposedModules,
  getRemoteExposedModulesFromIndex,
  getRootFolderChildren,
  getManifestChildren
} from '../../../../features/explorer/treeModel';
import type { ModuleFederationConfig } from '../../../../federation/types';
import type { RootFolder } from '../../../../features/explorer/types';
import type { ManifestRecord } from '../../../../federation/manifestTypes';

function manifest(): ManifestRecord {
  return {
    provenance: 'manifest',
    id: 'catalog-build',
    name: 'catalog',
    metadata: {
      types: { path: 'catalog.d.ts' },
      assets: [{ name: 'entry', path: 'catalog.js' }],
      disableAssetsAnalyze: false
    },
    shared: [{ name: 'react', assets: [{ path: 'react.js' }] }],
    remotes: [{ name: 'auth', aliases: ['authentication'], assets: [], types: { path: 'auth.d.ts' } }],
    exposes: [{ name: './Button', assets: [], types: { path: 'Button.d.ts' } }],
    source: { kind: 'local', location: '/workspace/catalog/mf-manifest.json' },
    manifestPath: '/workspace/catalog/mf-manifest.json',
    loadedAt: '2026-09-01T12:34:56.000Z',
    diagnostics: []
  };
}

function config(name: string, remotes: string[], exposes: string[]): ModuleFederationConfig {
  return {
    name,
    remotes: remotes.map(remoteName => ({
      name: remoteName,
      folder: `/workspace/${remoteName}`,
      packageManager: 'npm',
      configType: 'webpack'
    })),
    exposes: exposes.map(exposeName => ({
      name: exposeName,
      path: `./src/${exposeName}.tsx`,
      remoteName: name
    })),
    shared: [],
    provenance: 'static',
    detected: true,
    configType: 'webpack',
    configPath: `/workspace/${name}/webpack.config.ts`
  };
}

suite('Tree model', () => {
  test('builds manifest sections and preserves manifest-derived values', () => {
    const sections = getManifestChildren(manifest());

    assert.deepStrictEqual(sections.map(section => section.kind), ['exposes', 'remotes', 'shared', 'assets', 'types']);
    assert.deepStrictEqual(
      sections.find(section => section.kind === 'remotes')?.items[0],
      { type: 'manifestValue', value: manifest().remotes[0] }
    );
    assert.strictEqual(sections.find(section => section.kind === 'assets')?.items.length, 2);
    assert.strictEqual(sections.find(section => section.kind === 'types')?.items.length, 3);
  });

  test('builds remotes and exposes folders from all root configurations', () => {
    const rootFolder: RootFolder = {
      type: 'rootFolder',
      path: '/workspace/host',
      name: 'host',
      configs: [config('host', ['auth'], ['Shell']), config('host-vite', ['catalog'], ['Header'])]
    };

    const children = getRootFolderChildren(rootFolder);

    assert.deepStrictEqual(
      children.map(child => child.type),
      ['remotesFolder', 'exposesFolder']
    );
    assert.deepStrictEqual(children[0].type === 'remotesFolder' ? children[0].remotes.map(remote => remote.name) : [], [
      'auth',
      'catalog'
    ]);
    assert.deepStrictEqual(children[1].type === 'exposesFolder' ? children[1].exposes.map(expose => expose.name) : [], [
      'Shell',
      'Header'
    ]);
  });

  test('finds exposed modules for a remote across loaded configurations', () => {
    const hostConfig = config('host', ['auth'], []);
    hostConfig.exposes.push({ name: 'Login', path: './src/Login.tsx', remoteName: 'auth' });
    const configs = new Map([
      ['/workspace/one', [hostConfig]],
      ['/workspace/two', [config('shell', [], ['Home'])]]
    ]);

    assert.deepStrictEqual(
      getRemoteExposedModules(configs, 'auth').map(expose => expose.name),
      ['Login']
    );
  });

  test('builds an ordered remote expose index with isolated result arrays', () => {
    const hostConfig = config('host', ['auth'], []);
    hostConfig.exposes.push({ name: 'Login', path: './src/Login.tsx', remoteName: 'auth' });
    const configs = new Map([['/workspace/one', [hostConfig]]]);
    const index = buildRemoteExposedModulesIndex(configs);
    const firstResult = getRemoteExposedModulesFromIndex(index, 'auth');

    firstResult.pop();

    assert.deepStrictEqual(
      getRemoteExposedModulesFromIndex(index, 'auth').map(expose => expose.name),
      ['Login']
    );
    assert.deepStrictEqual(
      getRemoteExposedModules(configs, 'auth').map(expose => expose.name),
      ['Login']
    );
  });
});
