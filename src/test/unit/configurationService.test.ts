import * as assert from 'assert';
import { ConfigurationService, ConfigFileType } from '../../configurationService';
import type { ModuleFederationConfig } from '../../federation/types';

function config(name: string, configPath: string): ModuleFederationConfig {
  return {
    name,
    remotes: [],
    exposes: [],
    shared: [],
    detected: true,
    configType: 'webpack',
    configPath
  };
}

suite('ConfigurationService', () => {
  test('discovers all supported config types, including Rspack', async () => {
    const discoveredTypes: ConfigFileType[] = [];
    const service = new ConfigurationService({
      findFiles: async (_rootPath, pattern) => {
        const type = pattern.includes('rspack')
          ? 'rspack'
          : pattern.includes('webpack')
            ? 'webpack'
            : pattern.includes('vite')
              ? 'vite'
              : pattern.includes('module-federation')
                ? 'modernjs'
                : 'rsbuild';
        discoveredTypes.push(type);
        return [`/workspace/${type}.config.ts`];
      },
      parseConfigFile: async filePath => config(filePath.split('/').pop()!, filePath)
    });

    const snapshot = await service.load(['/workspace']);

    assert.deepStrictEqual(discoveredTypes.sort(), ['modernjs', 'rsbuild', 'rspack', 'vite', 'webpack']);
    assert.strictEqual(snapshot.configs.get('/workspace')?.length, 5);
  });

  test('keeps valid configs when one config file cannot be parsed', async () => {
    const service = new ConfigurationService({
      findFiles: async (_rootPath, pattern) =>
        pattern.includes('vite') ? ['/workspace/valid.config.ts', '/workspace/broken.config.ts'] : [],
      parseConfigFile: async filePath => {
        if (filePath.includes('broken')) throw new Error('invalid syntax');
        return config('valid', filePath);
      }
    });

    const snapshot = await service.load(['/workspace']);

    assert.strictEqual(snapshot.configs.get('/workspace')?.length, 1);
    assert.strictEqual(snapshot.errors.length, 1);
    assert.strictEqual(snapshot.errors[0].filePath, '/workspace/broken.config.ts');
  });

  test('returns a fresh snapshot without roots that no longer produce configs', async () => {
    const service = new ConfigurationService({
      findFiles: async rootPath => (rootPath === '/workspace/active' ? ['/workspace/active/vite.config.ts'] : []),
      parseConfigFile: async filePath => config('active', filePath)
    });

    const snapshot = await service.load(['/workspace/active', '/workspace/removed']);

    assert.deepStrictEqual([...snapshot.configs.keys()], ['/workspace/active']);
  });
});
