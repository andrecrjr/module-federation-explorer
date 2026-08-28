import * as assert from 'assert';
import { ModuleFederationConfig, Remote, UnifiedRootConfig } from '../types';
import { RemoteConfigurationService } from '../features/remotes/remoteConfigurationService';
import { findContainingRoot, normalizePath } from '../infrastructure/node/pathUtils';
import type { FileSystemPort, PathPort } from '../app/ports';

const testFileSystem: Pick<FileSystemPort, 'existsSync' | 'statSync'> = {
  existsSync: () => false,
  statSync: () => ({ isFile: () => false, isDirectory: () => false })
};

const testPath: Pick<PathPort, 'isAbsolute' | 'resolve' | 'dirname'> = {
  isAbsolute: filePath => filePath.startsWith('/'),
  resolve: (...parts) => parts.join('/').replace(/\/+/g, '/'),
  dirname: filePath => filePath.slice(0, filePath.lastIndexOf('/')) || '/'
};

class MemoryRootConfigStore {
  constructor(public config: UnifiedRootConfig) {}

  async loadRootConfig(): Promise<UnifiedRootConfig> {
    return this.config;
  }

  async saveRootConfig(config: UnifiedRootConfig): Promise<void> {
    this.config = config;
  }
}

function remote(name: string, folder: string): Remote {
  return {
    name,
    folder,
    packageManager: 'npm',
    configType: 'webpack'
  };
}

function config(name: string, remoteValue: Remote, configPath: string): ModuleFederationConfig {
  return {
    name,
    remotes: [remoteValue],
    exposes: [],
    shared: [],
    detected: true,
    configType: 'webpack',
    configPath
  };
}

suite('Root and remote state boundaries', () => {
  test('matches path components, not unsafe string prefixes', () => {
    assert.strictEqual(findContainingRoot('/workspace/host-app', ['/workspace/host']), undefined);
    assert.strictEqual(findContainingRoot('/workspace/host/apps/auth', ['/workspace/host']), '/workspace/host');
    assert.strictEqual(normalizePath('/workspace/host/../host/apps/auth'), '/workspace/host/apps/auth');
  });

  test('hydrates duplicate remote names within their own root', async () => {
    const first = remote('auth', 'apps/auth');
    const second = remote('auth', 'apps/auth');
    const discovered = new Map([
      ['/workspace/host-a', [config('host-a', first, '/workspace/host-a/webpack.config.ts')]],
      ['/workspace/host-b', [config('host-b', second, '/workspace/host-b/webpack.config.ts')]]
    ]);
    const store = new MemoryRootConfigStore({
      roots: ['/workspace/host-a', '/workspace/host-b'],
      rootConfigs: {
        '/workspace/host-a': {
          remotes: {
            auth: { ...remote('auth', 'apps/auth'), packageManager: 'pnpm', startCommand: 'pnpm dev' }
          }
        },
        '/workspace/host-b': {
          remotes: {
            auth: { ...remote('auth', 'apps/auth'), packageManager: 'yarn', startCommand: 'yarn dev' }
          }
        }
      }
    });
    const service = new RemoteConfigurationService({
      rootConfigurationStore: store,
      getRootConfigs: () => discovered,
      fileSystem: testFileSystem,
      path: testPath,
      log: () => {},
      logError: () => {}
    });

    const hydrated = await service.hydrateRemoteConfigurations(discovered);
    assert.strictEqual(hydrated.get('/workspace/host-a')?.[0].remotes[0].packageManager, 'pnpm');
    assert.strictEqual(hydrated.get('/workspace/host-b')?.[0].remotes[0].packageManager, 'yarn');
    assert.strictEqual(first.packageManager, 'npm');
    assert.strictEqual(second.packageManager, 'npm');
  });

  test('adds external remotes only to owning root during hydration', async () => {
    const discovered = new Map([
      ['/workspace/host-a', [config('host-a', remote('auth', 'auth'), '/workspace/host-a/webpack.config.ts')]],
      ['/workspace/host-b', [config('host-b', remote('auth', 'auth'), '/workspace/host-b/webpack.config.ts')]]
    ]);
    const store = new MemoryRootConfigStore({
      roots: ['/workspace/host-a', '/workspace/host-b'],
      rootConfigs: {
        '/workspace/host-a': {
          externalRemotes: {
            catalog: { name: 'catalog', url: 'https://example.test/remoteEntry.js', configType: 'external', isExternal: true }
          }
        }
      }
    });
    const service = new RemoteConfigurationService({
      rootConfigurationStore: store,
      getRootConfigs: () => discovered,
      fileSystem: testFileSystem,
      path: testPath,
      log: () => {},
      logError: () => {}
    });

    const hydrated = await service.hydrateRemoteConfigurations(discovered);
    assert.strictEqual(hydrated.get('/workspace/host-a')?.[0].remotes.some(item => item.name === 'catalog'), true);
    assert.strictEqual(hydrated.get('/workspace/host-b')?.[0].remotes.some(item => item.name === 'catalog'), false);
  });

  test('does not guess a root when missing remote folder is ambiguous', async () => {
    const store = new MemoryRootConfigStore({ roots: ['/workspace/host-a', '/workspace/host-b'] });
    const service = new RemoteConfigurationService({
      rootConfigurationStore: store,
      getRootConfigs: () => new Map(),
      fileSystem: testFileSystem,
      path: testPath,
      log: () => {},
      logError: () => {}
    });

    await service.saveRemoteConfiguration(remote('auth', 'missing-auth-folder'));
    assert.strictEqual(store.config.rootConfigs, undefined);
  });
});
