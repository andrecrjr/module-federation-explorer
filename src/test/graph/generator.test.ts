import * as assert from 'assert';
import { GraphGenerator } from '../../features/graph/generator';
import { AppCapability } from '../../features/graph/types';
import { ModuleFederationConfig, Remote } from '../../types';

function remote(name: string): Remote {
  return {
    name,
    folder: `/workspace/${name}`,
    packageManager: 'npm',
    configType: 'webpack'
  };
}

function config(
  name: string,
  remotes: Remote[] = [],
  exposes: string[] = [],
  shared: string[] = []
): ModuleFederationConfig {
  return {
    name,
    remotes,
    exposes: exposes.map(moduleName => ({
      name: moduleName,
      path: `./src/${moduleName}.tsx`,
      remoteName: name
    })),
    shared: shared.map(name => ({ name })),
    detected: true,
    configType: 'webpack',
    configPath: `/workspace/${name}/webpack.config.ts`
  };
}

function appCapabilities(entries: Array<[string, ModuleFederationConfig]>): Map<string, AppCapability> {
  return new Map(entries.map(([id, value]) => [id, {
    config: value,
    isHost: value.remotes.length > 0,
    isRemote: value.exposes.length > 0
  }]));
}

suite('GraphGenerator', () => {
  test('matches exact names without substring false positives', () => {
    const generator = new GraphGenerator();
    const capabilities = appCapabilities([
      ['auth-id', config('auth')],
      ['authentication-id', config('authentication')]
    ]);

    assert.strictEqual(generator.findAppIdByName('auth', capabilities), 'auth-id');
    assert.strictEqual(generator.findAppIdByName('AUTHENTICATION', capabilities), 'authentication-id');
    assert.strictEqual(generator.findAppIdByName('auth-service', capabilities), undefined);
  });

  test('preserves both directions when applications consume each other', () => {
    const generator = new GraphGenerator();
    const result = generator.generate(new Map([
      ['/workspace/a', [config('a', [remote('b')], ['A'])]],
      ['/workspace/b', [config('b', [remote('a')], ['B'])]]
    ]));

    const appEdges = result.graph.edges.filter(edge => edge.type === 'consumes');
    assert.strictEqual(appEdges.length, 2);
    assert.notStrictEqual(appEdges[0].from, appEdges[0].to);
    assert.deepStrictEqual(
      new Set(appEdges.map(edge => `${edge.from}->${edge.to}`)).size,
      2
    );
    assert.ok(appEdges.every(edge => edge.bidirectional));
  });

  test('deduplicates shared dependencies and calculates metadata', () => {
    const generator = new GraphGenerator();
    const result = generator.generate(new Map([
      ['/workspace/a', [config('a', [], [], ['react'])]],
      ['/workspace/b', [config('b', [], [], ['react'])]]
    ]));

    assert.strictEqual(result.graph.nodes.filter(node => node.type === 'shared-dependency').length, 1);
    assert.strictEqual(result.graph.metadata?.totalSharedDeps, 1);
    assert.strictEqual(result.graph.metadata?.totalHosts, 2);
  });

  test('keeps same-named configs from the same root as distinct graph nodes', () => {
    const generator = new GraphGenerator();
    const first = config('shell');
    const second = config('shell');
    second.configPath = '/workspace/shell/vite.config.ts';

    const result = generator.generate(new Map([
      ['/workspace/shell', [first, second]]
    ]));

    assert.strictEqual(result.graph.nodes.filter(node => node.label === 'shell').length, 2);
    assert.strictEqual(new Set(result.graph.nodes.filter(node => node.label === 'shell').map(node => node.id)).size, 2);
  });

  test('returns diagnostics for invalid configuration snapshots', () => {
    const generator = new GraphGenerator();
    const result = generator.generate(new Map([
      ['/workspace/invalid', [config('')]]
    ]));

    assert.strictEqual(result.graph.nodes.length, 0);
    assert.deepStrictEqual(result.diagnostics, [{
      code: 'missing-config-name',
      severity: 'warning',
      message: 'Skipping config without name in /workspace/invalid',
      rootPath: '/workspace/invalid'
    }]);
  });
});
