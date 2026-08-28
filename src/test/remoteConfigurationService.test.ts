import * as assert from 'assert';
import {
  ModuleFederationConfig,
  Remote,
  UnifiedRootConfig
} from '../types';
import {
  RemoteConfigurationService,
  RootConfigurationStore
} from '../remoteConfigurationService';

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
    log: () => {},
    logError: () => {}
  });
}

suite('RemoteConfigurationService', () => {
  test('persists remote settings under the matching configured root', async () => {
    const store = new FakeRootConfigurationStore({ roots: ['/workspace/host'] });
    const rootConfigs = new Map<string, ModuleFederationConfig[]>([
      ['/workspace/host', [config('host')]]
    ]);
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
    const rootConfigs = new Map<string, ModuleFederationConfig[]>([
      ['/workspace/host', [loadedConfig]]
    ]);
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
    assert.strictEqual(loadedConfig.remotes.some(item => item.name === 'catalog' && item.isExternal), true);
  });
});
