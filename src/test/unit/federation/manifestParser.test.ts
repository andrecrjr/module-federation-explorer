import * as assert from 'node:assert/strict';
import { parseManifestText } from '../../../federation/manifestParser';

suite('Manifest parser', () => {
  test('normalizes identity, metadata, remote entries, types, assets, aliases, and shared dependencies', () => {
    const result = parseManifestText(
      JSON.stringify({
        id: 'host-id',
        name: 'host',
        metaData: {
          type: 'app',
          buildVersion: '1.2.3',
          publicPath: 'https://cdn.example.test/',
          remoteEntry: { name: 'remoteEntry.js', path: 'https://cdn.example.test/remoteEntry.js', type: 'global' },
          types: { name: 'host.d.ts', path: 'https://cdn.example.test/host.d.ts', type: 'global' },
          assets: { js: { sync: ['https://cdn.example.test/host.js'], async: [] } }
        },
        shared: [{ id: 'react', name: 'react', version: '18.3.1', requiredVersion: '^18.0.0', singleton: true }],
        remotes: [
          {
            id: 'catalog-id',
            name: 'catalog',
            alias: 'catalogAlias',
            entry: {
              name: 'mf-manifest.json',
              path: 'https://catalog.example.test/mf-manifest.json',
              type: 'manifest'
            },
            types: { name: 'catalog.d.ts', path: 'https://catalog.example.test/catalog.d.ts' },
            assets: { js: { sync: ['https://catalog.example.test/catalog.js'], async: [] } }
          }
        ],
        exposes: [
          {
            id: './Button',
            name: './Button',
            path: './src/Button',
            types: { name: 'Button.d.ts', path: 'https://cdn.example.test/Button.d.ts' },
            assets: { js: { sync: ['https://cdn.example.test/Button.js'], async: [] } }
          }
        ]
      }),
      {
        source: { kind: 'url', location: 'https://cdn.example.test/mf-manifest.json', environment: 'staging' },
        loadedAt: '2026-09-01T00:00:00.000Z'
      }
    );

    assert.equal(result.diagnostics.length, 0);
    assert.ok(result.manifest);
    assert.equal(result.manifest.provenance, 'manifest');
    assert.equal(result.manifest.id, 'host-id');
    assert.equal(result.manifest.name, 'host');
    assert.equal(result.manifest.metadata.buildVersion, '1.2.3');
    assert.deepEqual(result.manifest.metadata.remoteEntry, {
      name: 'remoteEntry.js',
      path: 'https://cdn.example.test/remoteEntry.js',
      type: 'global'
    });
    assert.deepEqual(result.manifest.remotes[0]?.aliases, ['catalogAlias']);
    assert.equal(result.manifest.remotes[0]?.remoteEntry?.path, 'https://catalog.example.test/mf-manifest.json');
    assert.equal(result.manifest.remotes[0]?.types?.path, 'https://catalog.example.test/catalog.d.ts');
    assert.deepEqual(result.manifest.remotes[0]?.assets, [
      { type: 'js', mode: 'sync', path: 'https://catalog.example.test/catalog.js' }
    ]);
    assert.equal(result.manifest.exposes[0]?.path, './src/Button');
    assert.equal(result.manifest.exposes[0]?.types?.path, 'https://cdn.example.test/Button.d.ts');
    assert.deepEqual(result.manifest.shared, [
      {
        id: 'react',
        name: 'react',
        version: '18.3.1',
        requiredVersion: '^18.0.0',
        singleton: true,
        assets: []
      }
    ]);
    assert.equal(result.manifest.source.environment, 'staging');
    assert.equal(result.manifest.loadedAt, '2026-09-01T00:00:00.000Z');
  });

  test('retains valid records and reports field-specific diagnostics for partial manifests', () => {
    const result = parseManifestText(
      JSON.stringify({
        id: 'partial-id',
        name: 'partial',
        metaData: { disableAssetsAnalyze: true },
        remotes: [{ name: 'valid-remote', entry: 'https://example.test/remote.json' }, { entry: 42 }],
        exposes: [
          { name: './Valid', path: './src/Valid' },
          { name: './Invalid', path: 42 }
        ],
        shared: [{ name: 'react' }, { name: 17 }]
      })
    );

    assert.ok(result.manifest);
    assert.deepEqual(
      result.manifest.remotes.map(remote => remote.name),
      ['valid-remote']
    );
    assert.deepEqual(
      result.manifest.exposes.map(expose => expose.name),
      ['./Valid']
    );
    assert.deepEqual(
      result.manifest.shared.map(dependency => dependency.name),
      ['react']
    );
    assert.deepEqual(result.manifest.remotes[0]?.assets, []);
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'INVALID_REMOTE'));
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'INVALID_EXPOSE'));
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'INVALID_SHARED_DEPENDENCY'));
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'ASSETS_OMITTED'));
    assert.ok(result.diagnostics.every(diagnostic => diagnostic.path.startsWith('$')));
  });

  test('rejects malformed JSON, non-object values, and unusable identity', () => {
    const malformed = parseManifestText('{"id":');
    assert.equal(malformed.manifest, undefined);
    assert.equal(malformed.diagnostics[0]?.code, 'MALFORMED_JSON');

    const array = parseManifestText('[]');
    assert.equal(array.manifest, undefined);
    assert.equal(array.diagnostics[0]?.code, 'INVALID_ROOT');

    const missingIdentity = parseManifestText(JSON.stringify({ exposes: [] }));
    assert.equal(missingIdentity.manifest, undefined);
    assert.equal(missingIdentity.diagnostics[0]?.code, 'MISSING_IDENTITY');
    assert.equal(missingIdentity.diagnostics[0]?.path, '$.id');
  });

  test('ignores unknown fields without executing or retaining them', () => {
    const result = parseManifestText(
      JSON.stringify({
        id: 'known-id',
        name: 'known',
        arbitraryCode: 'do-not-run()',
        metaData: {},
        shared: [],
        remotes: [{ name: 'remote', entry: 'https://example.test/remote.json', unknown: { secret: true } }],
        exposes: []
      })
    );

    assert.ok(result.manifest);
    assert.equal(Object.prototype.hasOwnProperty.call(result.manifest, 'arbitraryCode'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result.manifest.remotes[0]!, 'unknown'), false);
    assert.equal(result.diagnostics.length, 0);
  });

  test('reports missing required sections while retaining a usable identity', () => {
    const result = parseManifestText(JSON.stringify({ id: 'incomplete-id', name: 'incomplete' }));

    assert.ok(result.manifest);
    assert.deepEqual(
      result.diagnostics.map(diagnostic => diagnostic.code),
      ['INVALID_METADATA', 'INVALID_REMOTE', 'INVALID_EXPOSE', 'INVALID_SHARED_DEPENDENCY']
    );
    assert.ok(result.diagnostics.every(diagnostic => diagnostic.severity === 'warning'));
  });

  test('accepts generated metadata, remote identity fields, and shared assets', () => {
    const result = parseManifestText(
      JSON.stringify({
        id: 'shell-build',
        name: 'shell',
        metaData: {
          name: 'shell',
          type: 'app',
          buildInfo: { buildVersion: '2.0.0', buildName: 'shell-build' },
          remoteEntry: { name: 'remoteEntry.js', path: '/remoteEntry.js', type: 'global' },
          ssrRemoteEntry: { name: 'remoteEntry.ssr.js', path: '/remoteEntry.ssr.js', type: 'commonjs' },
          types: { name: 'types.zip', path: '/types.zip', api: '/types.api.json', zip: '/types.zip' }
        },
        shared: [
          {
            id: 'shell:react',
            name: 'react',
            version: '18.3.1',
            assets: { js: { sync: ['/react.js'], async: [] }, css: { sync: ['/react.css'], async: [] } }
          }
        ],
        remotes: [
          {
            moduleName: 'catalog',
            federationContainerName: 'catalogContainer',
            alias: 'catalogAlias',
            entry: 'https://example.test/catalog/mf-manifest.json'
          }
        ],
        exposes: []
      })
    );

    assert.ok(result.manifest);
    assert.equal(result.manifest.metadata.buildInfo?.buildVersion, '2.0.0');
    assert.equal(result.manifest.metadata.ssrRemoteEntry?.path, '/remoteEntry.ssr.js');
    assert.equal(result.manifest.metadata.types?.api, '/types.api.json');
    assert.deepEqual(result.manifest.shared[0]?.assets, [
      { type: 'js', mode: 'sync', path: '/react.js' },
      { type: 'css', mode: 'sync', path: '/react.css' }
    ]);
    assert.equal(result.manifest.remotes[0]?.name, 'catalog');
    assert.equal(result.manifest.remotes[0]?.moduleName, 'catalog');
    assert.equal(result.manifest.remotes[0]?.federationContainerName, 'catalogContainer');
    assert.equal(result.manifest.remotes[0]?.entry, 'https://example.test/catalog/mf-manifest.json');
    assert.deepEqual(result.diagnostics, []);
  });
});
