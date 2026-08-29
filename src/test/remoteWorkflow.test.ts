import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import type {
  CommandConfigOptions,
  DialogMessageOptions,
  DialogService,
  FolderPickerOptions,
  InputBoxOptions,
  PackageManagerDetector,
  ProgressReporter,
  QuickPickItem,
  QuickPickOptions
} from '../app/ports';
import { RemoteConfigurationService, RootConfigurationStore } from '../features/remotes/remoteConfigurationService';
import { RemoteWorkflow, RemoteWorkflowDependencies } from '../features/remotes/remoteWorkflow';
import type { ModuleFederationConfig, Remote, UnifiedRootConfig } from '../types';

class TestDialogs implements DialogService {
  private readonly inputs: Array<string | undefined> = [];
  infoResult: string | undefined;
  warningResult: string | undefined;
  folderResult: string | undefined;
  quickPickResult: QuickPickItem | QuickPickItem[] | undefined;
  readonly commandResults: Array<string | undefined> = [];
  confirmationResult = false;
  readonly infos: string[] = [];
  readonly warnings: string[] = [];
  readonly errors: string[] = [];
  readonly successes: string[] = [];
  readonly inputOptions: InputBoxOptions[] = [];
  readonly folderOptions: FolderPickerOptions[] = [];
  readonly commandOptions: CommandConfigOptions[] = [];

  queueInputs(...values: Array<string | undefined>): void {
    this.inputs.push(...values);
  }

  async showInfo(message: string, _options?: DialogMessageOptions): Promise<string | undefined> {
    this.infos.push(message);
    return this.infoResult;
  }
  async showWarning(message: string, _options?: DialogMessageOptions): Promise<string | undefined> {
    this.warnings.push(message);
    return this.warningResult;
  }

  async showError(message: string, _options?: DialogMessageOptions): Promise<string | undefined> {
    this.errors.push(message);
    return undefined;
  }

  async showSuccess(message: string, _detail?: string): Promise<void> {
    this.successes.push(message);
  }

  async showInput(options: InputBoxOptions): Promise<string | undefined> {
    this.inputOptions.push(options);
    return this.inputs.shift();
  }

  async showQuickPick<T extends QuickPickItem>(_items: T[], _options: QuickPickOptions): Promise<T | T[] | undefined> {
    return this.quickPickResult as T | T[] | undefined;
  }
  async showFolderPicker(options: FolderPickerOptions): Promise<string | undefined> {
    this.folderOptions.push(options);
    return this.folderResult;
  }
  async showConfirmation(_message: string): Promise<boolean> { return this.confirmationResult; }
  async showCommandConfig(options: CommandConfigOptions): Promise<string | undefined> {
    this.commandOptions.push(options);
    return this.commandResults.shift();
  }

  async withProgress<T>(_title: string, task: (progress: ProgressReporter) => Promise<T>): Promise<T> {
    return task({ report: () => {} });
  }
}

class MemoryRootConfigurationStore implements RootConfigurationStore {
  constructor(public config: UnifiedRootConfig | null) {}

  async loadRootConfig(): Promise<UnifiedRootConfig | null> {
    return this.config;
  }

  async saveRootConfig(config: UnifiedRootConfig): Promise<void> {
    this.config = config;
  }
}

function createRemote(name: string, isExternal = false): Remote {
  return {
    name,
    url: isExternal ? `https://example.test/${name}/remoteEntry.js` : undefined,
    folder: isExternal ? '' : `/workspace/host/${name}`,
    packageManager: isExternal ? '' : 'npm',
    configType: isExternal ? 'external' : 'webpack',
    isExternal
  };
}

function createHostConfig(remotes: Remote[] = []): ModuleFederationConfig {
  return {
    name: 'host',
    remotes,
    exposes: [],
    shared: [],
    configType: 'webpack',
    configPath: '/workspace/host/webpack.config.js'
  };
}

function createHarness(configs: Map<string, ModuleFederationConfig[]>): {
  workflow: RemoteWorkflow;
  dialogs: TestDialogs;
  store: MemoryRootConfigurationStore;
  fileSystem: {
    existsSync: (filePath: string) => boolean;
    statSync: (filePath: string) => { isFile(): boolean; isDirectory(): boolean };
  };
  refreshed: () => number;
} {
  const dialogs = new TestDialogs();
  const store = new MemoryRootConfigurationStore({ roots: ['/workspace/host'] });
  const fileSystem: {
    existsSync: (filePath: string) => boolean;
    statSync: (filePath: string) => { isFile(): boolean; isDirectory(): boolean };
  } = {
    existsSync: () => true,
    statSync: () => ({ isFile: () => false, isDirectory: () => true })
  };
  const pathPort = {
    dirname: (filePath: string) => path.posix.dirname(filePath),
    join: (...parts: string[]) => path.posix.join(...parts)
  };
  const remoteConfigurationService = new RemoteConfigurationService({
    rootConfigurationStore: store,
    getRootConfigs: () => configs,
    fileSystem,
    path: {
      ...pathPort,
      isAbsolute: filePath => path.posix.isAbsolute(filePath),
      resolve: (...parts: string[]) => path.posix.resolve(...parts)
    },
    log: () => {},
    logError: () => {}
  });
  let refreshCount = 0;
  const dependencies: RemoteWorkflowDependencies = {
    fileSystem,
    path: pathPort,
    dialogs,
    detectPackageManager: (async () => ({ packageManager: 'npm', startCommand: 'npm start' })) as PackageManagerDetector,
    getRootConfigs: () => configs,
    remoteConfigurationService,
    refresh: () => { refreshCount++; },
    log: () => {},
    logError: () => {}
  };
  return {
    workflow: new RemoteWorkflow(dependencies),
    dialogs,
    store,
    fileSystem,
    refreshed: () => refreshCount
  };
}

suite('RemoteWorkflow', () => {
  test('adds an external remote to the host selected by its path', async () => {
    const hostConfig: ModuleFederationConfig = {
      name: 'host',
      remotes: [],
      exposes: [],
      shared: [],
      configType: 'webpack',
      configPath: '/workspace/host/webpack.config.js'
    };
    const configs = new Map([['/workspace/host', [hostConfig]]]);
    const harness = createHarness(configs);
    harness.dialogs.queueInputs('catalog', 'https://example.test/remoteEntry.js');

    await harness.workflow.addExternalRemote({
      type: 'remotesFolder',
      parentName: 'host',
      parentPath: '/workspace/host',
      remotes: []
    });

    assert.equal(hostConfig.remotes[0]?.name, 'catalog');
    assert.equal(hostConfig.remotes[0]?.isExternal, true);
    assert.equal(harness.store.config?.rootConfigs?.['/workspace/host']?.externalRemotes?.catalog?.url, 'https://example.test/remoteEntry.js');
    assert.equal(harness.refreshed(), 1);
    assert.deepEqual(harness.dialogs.successes, ['Added external remote "catalog" to host "host"']);
  });

  test('rejects an external remote that already exists in the selected folder', async () => {
    const existing = createRemote('catalog', true);
    const hostConfig: ModuleFederationConfig = {
      name: 'host',
      remotes: [existing],
      exposes: [],
      shared: [],
      configType: 'webpack',
      configPath: '/workspace/host/webpack.config.js'
    };
    const configs = new Map([['/workspace/host', [hostConfig]]]);
    const harness = createHarness(configs);
    harness.dialogs.queueInputs('catalog', 'https://example.test/remoteEntry.js');

    await harness.workflow.addExternalRemote({
      type: 'remotesFolder',
      parentName: 'host',
      parentPath: '/workspace/host',
      remotes: [existing]
    });

    assert.deepEqual(harness.dialogs.errors, ['Remote already exists']);
    assert.equal(harness.refreshed(), 0);
  });

  test('removes a confirmed external remote from memory and persistence', async () => {
    const external = createRemote('catalog', true);
    const hostConfig: ModuleFederationConfig = {
      name: 'host',
      remotes: [external],
      exposes: [],
      shared: [],
      configType: 'webpack',
      configPath: '/workspace/host/webpack.config.js'
    };
    const configs = new Map([['/workspace/host', [hostConfig]]]);
    const harness = createHarness(configs);
    harness.dialogs.confirmationResult = true;
    harness.store.config = {
      roots: ['/workspace/host'],
      rootConfigs: {
        '/workspace/host': {
          externalRemotes: {
            catalog: {
              name: 'catalog',
              url: external.url || '',
              configType: 'external',
              isExternal: true
            }
          }
        }
      }
    };

    await harness.workflow.removeExternalRemote(external);

    assert.deepEqual(hostConfig.remotes, []);
    assert.equal(harness.store.config?.rootConfigs?.['/workspace/host']?.externalRemotes, undefined);
    assert.deepEqual(harness.dialogs.successes, ['Removed external remote "catalog"']);
    assert.equal(harness.refreshed(), 1);
  });

  test('edits a remote folder, detects its package manager, and persists the change', async () => {
    const configs = new Map([['/workspace/host', [createHostConfig()]]]);
    const harness = createHarness(configs);
    harness.dialogs.quickPickResult = { label: '📁 Change Project Folder' };
    harness.dialogs.folderResult = '/workspace/host/auth-new';
    const target = createRemote('auth');

    await harness.workflow.editRemoteCommands(target);

    assert.strictEqual(target.folder, '/workspace/host/auth-new');
    assert.strictEqual(target.packageManager, 'npm');
    assert.strictEqual(harness.store.config?.rootConfigs?.['/workspace/host']?.remotes?.auth?.folder, '/workspace/host/auth-new');
    assert.deepStrictEqual(harness.dialogs.successes, ['Updated project folder for auth']);
    assert.strictEqual(harness.refreshed(), 1);
  });

  test('validates a changed folder and supports build, preview, and both command edits', async () => {
    const configs = new Map([['/workspace/host', [createHostConfig()]]]);
    const harness = createHarness(configs);
    harness.dialogs.quickPickResult = { label: '🔨 Edit Build Command' };
    harness.dialogs.commandResults.push('pnpm build');
    const target = createRemote('auth');
    target.startCommand = 'npm start';

    await harness.workflow.editRemoteCommands(target);
    assert.strictEqual(target.buildCommand, 'pnpm build');

    harness.dialogs.quickPickResult = { label: '▶️ Edit Preview Build Command' };
    harness.dialogs.commandResults.push('pnpm dev');
    await harness.workflow.editRemoteCommands(target);
    assert.strictEqual(target.startCommand, 'pnpm dev');

    harness.dialogs.quickPickResult = { label: '⚙️ Edit Both Commands' };
    harness.dialogs.commandResults.push('yarn build', 'yarn dev');
    await harness.workflow.editRemoteCommands(target);
    assert.strictEqual(target.buildCommand, 'yarn build');
    assert.strictEqual(target.startCommand, 'yarn dev');

    harness.fileSystem.existsSync = () => false;
    harness.dialogs.quickPickResult = { label: '📁 Change Project Folder' };
    harness.dialogs.folderResult = '/workspace/host/auth-other';
    harness.dialogs.confirmationResult = false;
    await harness.workflow.editRemoteCommands(target);
    const validation = harness.dialogs.folderOptions.at(-1)?.validateFolder;
    assert.ok(validation);
    assert.deepStrictEqual(await validation!('/workspace/host/auth-other'), {
      valid: false,
      message: 'Invalid Node.js project folder'
    });
  });

  test('handles canceled command edits and remotes without a configured folder', async () => {
    const configs = new Map([['/workspace/host', [createHostConfig()]]]);
    const harness = createHarness(configs);
    const target = createRemote('auth');
    harness.dialogs.quickPickResult = { label: '🔨 Edit Build Command' };
    harness.dialogs.commandResults.push(undefined);
    await harness.workflow.editRemoteCommands(target);

    assert.deepStrictEqual(harness.dialogs.successes, []);
    harness.dialogs.quickPickResult = { label: '🔨 Edit Build Command' };
    await harness.workflow.editRemoteCommands(createRemote('missing', false));
    const emptyHarness = createHarness(new Map());
    emptyHarness.dialogs.quickPickResult = { label: '🔨 Edit Build Command' };
    const missing = createRemote('missing', false);
    missing.folder = '';
    await emptyHarness.workflow.editRemoteCommands(missing);
    assert.deepStrictEqual(emptyHarness.dialogs.errors, ['Cannot edit commands for missing: Folder not configured']);
  });

  test('does not persist a canceled preview command edit', async () => {
    const configs = new Map([['/workspace/host', [createHostConfig()]]]);
    const harness = createHarness(configs);
    const target = createRemote('auth');
    target.startCommand = 'npm start';
    harness.dialogs.quickPickResult = { label: '▶️ Edit Preview Build Command' };
    harness.dialogs.commandResults.push(undefined);

    await harness.workflow.editRemoteCommands(target);

    assert.equal(target.startCommand, 'npm start');
    assert.deepEqual(harness.dialogs.successes, []);
  });

  test('reports invalid external-remote prompts and missing host ownership', async () => {
    const configs = new Map([['/workspace/host', [createHostConfig()]]]);
    const harness = createHarness(configs);
    harness.dialogs.queueInputs('catalog', 'https://example.test/remoteEntry.js');
    await harness.workflow.addExternalRemote({
      type: 'remotesFolder', parentName: 'unknown', parentPath: undefined, remotes: []
    });

    assert.deepStrictEqual(harness.dialogs.errors, ['Failed to find host configuration']);
    assert.strictEqual(harness.dialogs.inputOptions[0].validateInput?.('bad name!'), 'Remote name can only contain letters, numbers, hyphens, and underscores');
    assert.strictEqual(harness.dialogs.inputOptions[0].validateInput?.('catalog'), undefined);
    assert.strictEqual(harness.dialogs.inputOptions[1].validateInput?.('not-a-url'), 'Please enter a valid URL');
    assert.strictEqual(harness.dialogs.inputOptions[1].validateInput?.('https://example.test/remote.js'), undefined);
  });

  test('falls back to host-name lookup and supports adding to an explicit host', async () => {
    const hostConfig = createHostConfig();
    const configs = new Map([['/workspace/host', [hostConfig]]]);
    const harness = createHarness(configs);
    harness.dialogs.queueInputs('catalog', 'https://example.test/remoteEntry.js');
    await harness.workflow.addExternalRemote({
      type: 'remotesFolder', parentName: 'host', remotes: []
    });
    assert.strictEqual(hostConfig.remotes[0]?.name, 'catalog');

    harness.dialogs.queueInputs('payments', 'https://example.test/payments.js');
    await harness.workflow.addExternalRemoteToHost({
      type: 'remotesFolder', parentName: 'host', parentPath: '/workspace/host', remotes: []
    }, '/workspace/host');
    assert.strictEqual(hostConfig.remotes.some(remote => remote.name === 'payments'), true);
    assert.strictEqual(harness.refreshed(), 2);

    harness.dialogs.queueInputs('catalog', 'https://example.test/duplicate.js');
    await harness.workflow.addExternalRemoteToHost({
      type: 'remotesFolder', parentName: 'host', remotes: hostConfig.remotes
    }, '/workspace/host');
    assert.strictEqual(harness.dialogs.errors.at(-1), 'Remote already exists');
  });

  test('handles canceled and unowned external-remote removals', async () => {
    const external = createRemote('catalog', true);
    const hostConfig = createHostConfig([external]);
    const harness = createHarness(new Map([['/workspace/host', [hostConfig]]]));
    harness.dialogs.confirmationResult = false;
    await harness.workflow.removeExternalRemote(external);
    assert.strictEqual(hostConfig.remotes.length, 1);

    harness.dialogs.confirmationResult = true;
    await harness.workflow.removeExternalRemote(createRemote('missing', true));
    assert.deepStrictEqual(harness.dialogs.errors, ['Failed to find external remote configuration']);

    const noConfigHarness = createHarness(new Map([['/workspace/host', [createHostConfig()]]]));
    noConfigHarness.store.config = null;
    noConfigHarness.dialogs.queueInputs('catalog', 'https://example.test/remoteEntry.js');
    await noConfigHarness.workflow.addExternalRemote({
      type: 'remotesFolder', parentName: 'host', parentPath: '/workspace/host', remotes: []
    });
    assert.deepStrictEqual(noConfigHarness.dialogs.errors, ['Failed to add external remote']);
  });
});
