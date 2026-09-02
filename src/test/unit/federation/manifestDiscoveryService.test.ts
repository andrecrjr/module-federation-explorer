import * as assert from 'node:assert/strict';
import { formatManifestSource, ManifestDiscoveryService } from '../../../federation/manifestDiscoveryService';
import type { ModuleFederationConfig } from '../../../federation/types';
import type { ManifestSourceConfig } from '../../../federation/manifestTypes';

function manifest(name: string, id = `${name}-id`): string {
  return JSON.stringify({ id, name, remotes: [], exposes: [], shared: [] });
}

function staticConfig(name: string, configPath: string): ModuleFederationConfig {
  return {
    name,
    remotes: [],
    exposes: [],
    shared: [],
    provenance: 'static',
    detected: true,
    configType: 'webpack',
    configPath
  };
}

suite('Manifest discovery service', () => {
  test('sanitizes URL credentials and query data in source labels', () => {
    assert.equal(
      formatManifestSource({
        kind: 'url',
        location: 'https://user:secret@example.test/manifest.json?token=redact#part'
      }),
      'https://example.test/manifest.json'
    );
  });

  test('discovers automatic and explicit sources in deterministic order and deduplicates them', async () => {
    const calls: ManifestSourceConfig[] = [];
    const files = new Map<string, string>([
      ['/workspace/apps/host/mf-manifest.json', manifest('host')],
      ['/workspace/apps/catalog/mf-manifest.json', manifest('catalog')],
      ['https://staging.example.test/mf-manifest.json', manifest('staging')]
    ]);
    const service = new ManifestDiscoveryService({
      workspaceRoot: '/workspace',
      now: () => '2026-09-01T00:00:00.000Z',
      findFiles: async (_rootPath, pattern, excludePattern) => {
        assert.equal(pattern, '**/mf-manifest.json');
        assert.equal(excludePattern, '**/node_modules/**');
        return ['/workspace/apps/host/mf-manifest.json', '/workspace/apps/host/../catalog/mf-manifest.json'];
      },
      loadSource: async source => {
        calls.push(source);
        const content = files.get(source.location);
        if (!content) throw new Error(`missing ${source.location}`);
        return content;
      }
    });

    const result = await service.discover(['/workspace/apps'], {
      sources: [
        { kind: 'local', location: 'apps/catalog/mf-manifest.json', environment: 'local' },
        { kind: 'url', location: 'https://staging.example.test/mf-manifest.json', environment: 'staging' },
        { kind: 'url', location: 'https://staging.example.test/mf-manifest.json', environment: 'duplicate' }
      ]
    });

    assert.deepEqual(result.errors, []);
    assert.deepEqual(
      result.manifests.map(item => item.name),
      ['catalog', 'staging', 'host']
    );
    assert.deepEqual(
      calls.map(source => source.location),
      [
        '/workspace/apps/catalog/mf-manifest.json',
        'https://staging.example.test/mf-manifest.json',
        '/workspace/apps/host/mf-manifest.json'
      ]
    );
    assert.equal(result.manifests[0]?.source.environment, 'local');
  });

  test('associates an exact federation name with a static config and keeps unmatched manifests', async () => {
    const service = new ManifestDiscoveryService({
      workspaceRoot: '/workspace',
      findFiles: async () => ['/workspace/apps/host/dist/mf-manifest.json', '/workspace/apps/other/mf-manifest.json'],
      loadSource: async source => (source.location.includes('/host/') ? manifest('host') : manifest('manifest-only'))
    });
    const staticConfigs = new Map<string, ModuleFederationConfig[]>([
      ['/workspace/apps/host', [staticConfig('host', '/workspace/apps/host/webpack.config.js')]]
    ]);

    const result = await service.discover(['/workspace/apps/host', '/workspace/apps/other'], { staticConfigs });

    assert.equal(result.manifests[0]?.rootPath, '/workspace/apps/host');
    assert.equal(result.manifests[0]?.configPath, '/workspace/apps/host/webpack.config.js');
    assert.equal(result.manifests[1]?.rootPath, '/workspace/apps/other');
    assert.equal(result.manifests[1]?.configPath, undefined);
  });

  test('reports source failures without discarding successful manifests', async () => {
    const service = new ManifestDiscoveryService({
      findFiles: async () => [],
      loadSource: async source => {
        if (source.location.includes('broken')) throw new Error('network unavailable');
        return manifest('valid');
      }
    });

    const result = await service.discover([], {
      sources: [
        { kind: 'url', location: 'https://example.test/valid.json' },
        { kind: 'url', location: 'https://example.test/broken.json' }
      ]
    });

    assert.deepEqual(
      result.manifests.map(item => item.name),
      ['valid']
    );
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]?.source.location, 'https://example.test/broken.json');
    assert.match(String(result.errors[0]?.error), /network unavailable/);
  });
});
