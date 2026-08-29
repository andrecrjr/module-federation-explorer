import * as assert from 'assert';
import {
  CONFIG_FILE_DEFINITIONS,
  FederationDiscoveryService
} from '../federation/configFileRegistry';
import { ConfigParseError, parseConfigText } from '../parser/parseConfigFile';
import { extractConfigFromWebpack } from '../extractors/webpack';
import { extractConfigFromVite } from '../extractors/vite';
import { extractConfigFromModernJS } from '../extractors/modernjs';
import { extractConfigFromRSBuild } from '../extractors/rsbuild';

suite('Federation discovery pipeline', () => {
  test('uses one registry for every supported bundler', () => {
    assert.deepStrictEqual(
      CONFIG_FILE_DEFINITIONS.map(definition => definition.type),
      ['webpack', 'vite', 'modernjs', 'rsbuild', 'rspack']
    );
  });

  test('parses webpack federation without package-manager or UI side effects', async () => {
    const config = await parseConfigText(
      `new ModuleFederationPlugin({
        name: 'host',
        remotes: { auth: 'auth@http://localhost:3001/remoteEntry.js' },
        exposes: { './App': './src/App.tsx' },
        shared: ['react']
      })`,
      '/workspace/webpack.config.ts',
      (ast, workspaceRoot) => extractConfigFromWebpack(ast, workspaceRoot)
    );

    assert.strictEqual(config.detected, true);
    assert.strictEqual(config.name, 'host');
    assert.strictEqual(config.remotes[0].name, 'auth');
    assert.strictEqual(config.exposes[0].path, './src/App.tsx');
    assert.deepStrictEqual(config.shared.map(dependency => dependency.name), ['react']);
  });

  test('returns structured diagnostics for invalid config text', async () => {
    await assert.rejects(
      () => parseConfigText('new ModuleFederationPlugin({', '/workspace/webpack.config.ts', extractConfigFromWebpack),
      (error: unknown) => {
        assert.ok(error instanceof ConfigParseError);
        assert.strictEqual(error.diagnostics[0].filePath, '/workspace/webpack.config.ts');
        assert.strictEqual(error.diagnostics[0].severity, 'error');
        return true;
      }
    );
  });

  test('extracts federation options from Vite, Modern.js, RSBuild, and Rspack shapes', async () => {
    const cases = [
      [`export default defineConfig({ plugins: [federation({ name: 'vite-host' })] })`, extractConfigFromVite, 'vite-host'],
      [`export default createModuleFederationConfig({ name: 'modern-host' })`, extractConfigFromModernJS, 'modern-host'],
      [`export default { moduleFederation: { options: { name: 'rsbuild-host' } } }`, extractConfigFromRSBuild, 'rsbuild-host'],
      [`new ModuleFederationPlugin({ name: 'rspack-host' })`, (ast: Parameters<typeof extractConfigFromWebpack>[0], root: string) => extractConfigFromWebpack(ast, root, 'rspack'), 'rspack-host']
    ] as const;

    for (const [source, extractor, expectedName] of cases) {
      const config = await parseConfigText(source, `/workspace/${expectedName}.config.ts`, extractor);
      assert.strictEqual(config.detected, true);
      assert.strictEqual(config.name, expectedName);
    }
  });

  test('preserves dynamic remote values and shared dependency options', async () => {
    const config = await parseConfigText([
      "new ModuleFederationPlugin({",
      "  name: 'host',",
      "  remotes: {",
      "    catalog: 'catalog@https://example.test/remoteEntry.js',",
      "    dynamic: process.env.REMOTE_URL,",
      "    templated: `https://${REMOTE_HOST}/remoteEntry.js`,",
      "    configured: { url: 'configured@https://example.test/configured.js' }",
      "  },",
      "  exposes: {",
      "    './App': process.env.APP_PATH,",
      "    './Fallback': getExposePath()",
      "  },",
      "  shared: {",
      "    react: {",
      "      singleton: true,",
      "      eager: false,",
      "      strictVersion: true,",
      "      version: '18.3.0',",
      "      requiredVersion: '^18.0.0',",
      "      ignored: 42",
      "    },",
      "    lodash: '4.17.21'",
      "  }",
      "})"
    ].join('\n'),
      '/workspace/webpack.config.ts',
      (ast, workspaceRoot) => extractConfigFromWebpack(ast, workspaceRoot)
    );

    assert.deepStrictEqual(config.remotes.map(remote => remote.name), ['catalog', 'dynamic', 'templated', 'configured']);
    assert.strictEqual(config.remotes[0].url, 'https://example.test/remoteEntry.js');
    assert.strictEqual(config.remotes[1].url, '[ENV: env.REMOTE_URL]');
    assert.strictEqual(config.remotes[2].url, 'https://[EXPR]/remoteEntry.js');
    assert.strictEqual(config.remotes[3].name, 'configured');
    assert.strictEqual(config.exposes[0].path, '[ENV: env.APP_PATH]');
    assert.strictEqual(config.exposes[1].path, '[FUNC: getExposePath()]');
    assert.deepStrictEqual(config.shared, [
      {
        name: 'react',
        singleton: true,
        eager: false,
        strictVersion: true,
        version: '18.3.0',
        requiredVersion: '^18.0.0'
      },
      { name: 'lodash' }
    ]);
  });

  test('supports imported Vite aliases and RSBuild plugin object syntax', async () => {
    const vite = await parseConfigText(
      `import { federation as mf } from '@originjs/vite-plugin-federation';
       export default { plugins: [mf({ name: 'vite-alias' })] }`,
      '/workspace/vite.config.ts',
      extractConfigFromVite
    );
    const rsbuild = await parseConfigText(
      `export default {
        plugins: { federation: pluginModuleFederation({ name: 'rsbuild-plugin' }) }
      }`,
      '/workspace/rsbuild.config.ts',
      extractConfigFromRSBuild
    );

    assert.strictEqual(vite.detected, true);
    assert.strictEqual(vite.name, 'vite-alias');
    assert.strictEqual(rsbuild.detected, true);
    assert.strictEqual(rsbuild.name, 'rsbuild-plugin');
  });

  test('returns undetected configs for unsupported plugin shapes', async () => {
    const vite = await parseConfigText(
      `export default { plugins: [otherPlugin({ name: 'not-federation' })] }`,
      '/workspace/vite.config.ts',
      extractConfigFromVite
    );
    const rsbuild = await parseConfigText(
      `export default { plugins: [] }`,
      '/workspace/rsbuild.config.ts',
      extractConfigFromRSBuild
    );

    assert.strictEqual(vite.detected, false);
    assert.strictEqual(rsbuild.detected, false);
  });

  test('discovery service deduplicates overlapping registry matches', async () => {
    const service = new FederationDiscoveryService({
      findFiles: async (_rootPath, pattern) => pattern.includes('modern')
        ? ['/workspace/modern.config.ts']
        : pattern.includes('module-federation')
          ? ['/workspace/modern.config.ts']
          : [],
      parseConfigFile: async filePath => ({
        name: 'modern',
        remotes: [],
        exposes: [],
        shared: [],
        detected: true,
        configType: 'modernjs',
        configPath: filePath
      })
    });

    const result = await service.discover(['/workspace']);
    assert.strictEqual(result.configurations.length, 1);
    assert.strictEqual(result.configurations[0].filePath, '/workspace/modern.config.ts');
  });
});
