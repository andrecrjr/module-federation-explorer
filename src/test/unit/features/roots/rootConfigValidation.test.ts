import * as assert from 'assert';
import { migrateLegacyRootConfig, parseRootConfig } from '../../../../features/roots/rootConfigSchema';

suite('Root configuration validation', () => {
  test('accepts the supported root configuration shape', () => {
    const value = parseRootConfig({
      roots: ['/workspace/host'],
      rootConfigs: {
        '/workspace/host': {
          startCommand: 'npm run dev'
        }
      }
    });

    assert.deepStrictEqual(value?.roots, ['/workspace/host']);
    assert.strictEqual(value?.rootConfigs?.['/workspace/host']?.startCommand, 'npm run dev');
  });

  test('accepts optional local and URL manifest sources', () => {
    const value = parseRootConfig({
      roots: ['/workspace/host'],
      manifestSources: [
        { kind: 'local', location: 'apps/catalog/mf-manifest.json', environment: 'local' },
        { kind: 'url', location: 'https://staging.example.test/mf-manifest.json', environment: 'staging' }
      ]
    });

    assert.deepStrictEqual(value?.manifestSources, [
      { kind: 'local', location: 'apps/catalog/mf-manifest.json', environment: 'local' },
      { kind: 'url', location: 'https://staging.example.test/mf-manifest.json', environment: 'staging' }
    ]);
  });

  test('rejects malformed manifest source entries', () => {
    assert.strictEqual(parseRootConfig({ roots: [], manifestSources: [{ kind: 'file', location: 'manifest.json' }] }), undefined);
    assert.strictEqual(parseRootConfig({ roots: [], manifestSources: [{ kind: 'local' }] }), undefined);
    assert.strictEqual(
      parseRootConfig({ roots: [], manifestSources: [{ kind: 'url', location: 'https://example.test', environment: 42 }] }),
      undefined
    );
  });

  test('rejects arbitrary path-looking keys instead of guessing roots', () => {
    assert.strictEqual(parseRootConfig({ projectPath: '/workspace/host' }), undefined);
    assert.strictEqual(parseRootConfig({ roots: ['/workspace/host', 42] }), undefined);
  });

  test('rejects malformed nested root configuration entries', () => {
    assert.strictEqual(
      parseRootConfig({ roots: ['/workspace/host'], rootConfigs: { '/workspace/host': 'invalid' } }),
      undefined
    );
  });

  test('migrates only explicit legacy path arrays', () => {
    assert.deepStrictEqual(migrateLegacyRootConfig({ paths: ['/workspace/host'] }), { roots: ['/workspace/host'] });
    assert.deepStrictEqual(migrateLegacyRootConfig({ directories: ['/workspace/remote'] }), {
      roots: ['/workspace/remote']
    });
    assert.strictEqual(migrateLegacyRootConfig({ projectPath: '/workspace/host' }), undefined);
  });
});
