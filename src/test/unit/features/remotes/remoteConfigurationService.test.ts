import * as assert from 'assert';
import type { ModuleFederationConfig, Remote } from '../../../../federation/types';
import type { UnifiedRootConfig } from '../../../../features/roots/types';
import {
  RemoteConfigurationService,
  RootConfigurationStore
} from '../../../../features/remotes/remoteConfigurationService';
import type { FileSystemPort, PathPort } from '../../../../app/ports';

const testFileSystem: Pick<FileSystemPort, 'existsSync' | 'statSync'> = {
  existsSync: () => false,
  statSync: () => ({ isFile: () => false, isDirectory: () => false })
};

const testPath: Pick<PathPort, 'isAbsolute' | 'resolve' | 'dirname'> = {
  isAbsolute: filePath => filePath.startsWith('/'),
  resolve: (...parts) => parts.join('/').replace(/\/+/g, '/'),
  dirname: filePath => filePath.slice(0, filePath.lastIndexOf('/')) || '/'
};

class FakeRootConfigurationStore implements RootConfigurationStore {
  constructor(public config: UnifiedRootConfig | null) {}

  async loadRootConfig(): Promise<UnifiedRootConfig | null> {
    return this.config;
  }

  async saveRootConfig(config: UnifiedRootConfig): Promise<void> {
    this.config = config;
  }
}

function config(name: string, remotes: Remote[] = []): ModuleFederationConfig {
  return {
    name,
    remotes,
    exposes: [],
    shared: [],
    detected: true,
    configType: 'webpack',
    configPath: `/workspace/${name}/webpack.config.ts`
  };
}

function service(
  store: FakeRootConfigurationStore,
  rootConfigs: Map<string, ModuleFederationConfig[]>
): RemoteConfigurationService {
  return new RemoteConfigurationService({
    rootConfigurationStore: store,
    getRootConfigs: () => rootConfigs,
    fileSystem: testFileSystem,
    path: testPath,
    log: () => {},
    logError: () => {}
  });
}

suite('RemoteConfigurationService', () => {
  test('persists remote settings under the matching configured root', async () => {
    const store = new FakeRootConfigurationStore({ roots: ['/workspace/host'] });
    const rootConfigs = new Map<string, ModuleFederationConfig[]>([['/workspace/host', [config('host')]]]);
    const remote: Remote = {
      name: 'auth',
      folder: '/workspace/host/auth',
      packageManager: 'npm',
      configType: 'webpack',
      buildCommand: 'npm run build'
    };

    await service(store, rootConfigs).saveRemoteConfiguration(remote);

    assert.strictEqual(store.config?.rootConfigs?.['/workspace/host']?.remotes?.auth?.buildCommand, 'npm run build');
  });

  test('hydrates regular and external remotes into loaded configurations', async () => {
    const remote: Remote = {
      name: 'auth',
      folder: 'old-folder',
      packageManager: 'npm',
      configType: 'webpack'
    };
    const loadedConfig = config('host', [remote]);
    const rootConfigs = new Map<string, ModuleFederationConfig[]>([['/workspace/host', [loadedConfig]]]);
    const store = new FakeRootConfigurationStore({
      roots: ['/workspace/host'],
      rootConfigs: {
        '/workspace/host': {
          remotes: {
            auth: {
              name: 'auth',
              folder: 'auth',
              packageManager: 'pnpm',
              configType: 'webpack',
              startCommand: 'pnpm dev'
            }
          },
          externalRemotes: {
            catalog: {
              name: 'catalog',
              url: 'https://example.test/remoteEntry.js',
              configType: 'external',
              isExternal: true
            }
          }
        }
      }
    });

    await service(store, rootConfigs).loadRemoteConfigurations();

    assert.strictEqual(remote.folder, 'auth');
    assert.strictEqual(remote.packageManager, 'pnpm');
    assert.strictEqual(remote.startCommand, 'pnpm dev');
    assert.strictEqual(
      loadedConfig.remotes.some(item => item.name === 'catalog' && item.isExternal),
      true
    );
  });

  test('matches saved roots once and does not duplicate saved external remotes', async () => {
    const existingExternal: Remote = {
      name: 'catalog',
      url: 'https://old.example/remoteEntry.js',
      folder: '',
      packageManager: '',
      configType: 'external',
      isExternal: true
    };
    const discoveredConfigs = new Map([
      ['/workspace/host/', [config('host', [existingExternal])]],
      ['/workspace/other', [config('other')]]
    ]);
    const store = new FakeRootConfigurationStore({
      roots: ['/workspace/host'],
      rootConfigs: {
        '/workspace/host': {
          externalRemotes: {
            catalog: {
              name: 'catalog',
              url: 'https://catalog.example/remoteEntry.js',
              configType: 'external',
              isExternal: true
            },
            auth: {
              name: 'auth',
              url: 'https://auth.example/remoteEntry.js',
              configType: 'external',
              isExternal: true
            }
          }
        }
      }
    });

    const hydrated = await service(store, new Map()).hydrateRemoteConfigurations(discoveredConfigs);
    const hostRemotes = hydrated.get('/workspace/host/')?.[0].remotes ?? [];

    assert.deepStrictEqual(
      hostRemotes.filter(remote => remote.isExternal).map(remote => remote.name),
      ['catalog', 'auth']
    );
    assert.strictEqual(hydrated.get('/workspace/other')?.[0].remotes.length, 0);
  });
});
