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
