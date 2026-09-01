import * as assert from 'assert';
import { GraphGenerator } from '../../../../features/graph/generator';
import { AppCapability, GraphDiagnostic } from '../../../../features/graph/types';
import type { ModuleFederationConfig, Remote } from '../../../../federation/types';

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
    provenance: 'static',
    detected: true,
    configType: 'webpack',
    configPath: `/workspace/${name}/webpack.config.ts`
  };
}

function appCapabilities(entries: Array<[string, ModuleFederationConfig]>): Map<string, AppCapability> {
  return new Map(
    entries.map(([id, value]) => [
      id,
      {
        config: value,
        isHost: value.remotes.length > 0,
        isRemote: value.exposes.length > 0
      }
    ])
  );
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

  test('reports ambiguous case-insensitive matches without changing exact-match precedence', () => {
    const generator = new GraphGenerator();
    const capabilities = appCapabilities([
      ['first-auth-id', config('Auth')],
      ['second-auth-id', config('auth')]
    ]);
    const diagnostics: GraphDiagnostic[] = [];

    assert.strictEqual(generator.findAppIdByName('AUTH', capabilities, diagnostics), undefined);
    assert.deepStrictEqual(diagnostics, [
      {
        code: 'ambiguous-app-name',
        severity: 'warning',
        message: "Ambiguous app name 'AUTH' matched 2 configurations"
      }
    ]);
    assert.strictEqual(generator.findAppIdByName('Auth', capabilities), 'first-auth-id');
  });

  test('preserves both directions when applications consume each other', () => {
    const generator = new GraphGenerator();
    const result = generator.generate(
      new Map([
        ['/workspace/a', [config('a', [remote('b')], ['A'])]],
        ['/workspace/b', [config('b', [remote('a')], ['B'])]]
      ])
    );

    const appEdges = result.graph.edges.filter(edge => edge.type === 'consumes');
    assert.strictEqual(appEdges.length, 2);
    assert.notStrictEqual(appEdges[0].from, appEdges[0].to);
    assert.deepStrictEqual(new Set(appEdges.map(edge => `${edge.from}->${edge.to}`)).size, 2);
    assert.ok(appEdges.every(edge => edge.bidirectional));
  });

  test('deduplicates shared dependencies and calculates metadata', () => {
    const generator = new GraphGenerator();
    const result = generator.generate(
      new Map([
        ['/workspace/a', [config('a', [], [], ['react'])]],
        ['/workspace/b', [config('b', [], [], ['react'])]]
      ])
    );

    assert.strictEqual(result.graph.nodes.filter(node => node.type === 'shared-dependency').length, 1);
    assert.strictEqual(result.graph.metadata?.totalSharedDeps, 1);
    assert.strictEqual(result.graph.metadata?.totalHosts, 2);
  });

  test('keeps the first equally detailed shared dependency configuration', () => {
    const generator = new GraphGenerator();
    const first = config('first', [], [], []);
    first.shared = [
      { name: 'react', version: '18' },
      { name: 'react', version: '19', singleton: true }
    ];
    const second = config('second', [], [], []);
    second.shared = [{ name: 'react', version: '17' }];

    const result = generator.generate(
      new Map([
        ['/workspace/first', [first]],
        ['/workspace/second', [second]]
      ])
    );

    assert.strictEqual(result.graph.nodes.find(node => node.type === 'shared-dependency')?.version, '18');
  });

  test('preserves ambiguous remote diagnostics while creating the external edge', () => {
    const generator = new GraphGenerator();
    const result = generator.generate(
      new Map([
        ['/workspace/host', [config('host', [remote('AUTH')])]],
        ['/workspace/first', [config('Auth', [], ['AuthModule'])]],
        ['/workspace/second', [config('auth', [], ['AuthModule'])]]
      ])
    );

    assert.strictEqual(result.graph.edges.filter(edge => edge.type === 'consumes').length, 1);
    assert.strictEqual(result.diagnostics.filter(diagnostic => diagnostic.code === 'ambiguous-app-name').length, 2);
  });

  test('keeps same-named configs from the same root as distinct graph nodes', () => {
    const generator = new GraphGenerator();
    const first = config('shell');
    const second = config('shell');
    second.configPath = '/workspace/shell/vite.config.ts';

    const result = generator.generate(new Map([['/workspace/shell', [first, second]]]));

    assert.strictEqual(result.graph.nodes.filter(node => node.label === 'shell').length, 2);
    assert.strictEqual(new Set(result.graph.nodes.filter(node => node.label === 'shell').map(node => node.id)).size, 2);
  });

  test('returns diagnostics for invalid configuration snapshots', () => {
    const generator = new GraphGenerator();
    const result = generator.generate(new Map([['/workspace/invalid', [config('')]]]));

    assert.strictEqual(result.graph.nodes.length, 0);
    assert.deepStrictEqual(result.diagnostics, [
      {
        code: 'missing-config-name',
        severity: 'warning',
        message: 'Skipping config without name in /workspace/invalid',
        rootPath: '/workspace/invalid'
      }
    ]);
  });
});
