import * as assert from 'node:assert/strict';
import type {
  AsyncFileSystemPort,
  DialogService,
  Logger,
  PathPort,
  QuickPickItem,
  StoragePort,
  WorkspacePort
} from '../app/ports';
import { RootConfigManager } from '../features/roots/rootConfigManager';
import type { RootConfigRepository } from '../infrastructure/node/rootConfigRepository';
import type { UnifiedRootConfig } from '../types';

class MemoryStorage implements StoragePort {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  async update<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
}

class MemoryRepository implements RootConfigRepository {
  readonly files = new Map<string, unknown>();
  writeCount = 0;

  async exists(filePath: string): Promise<boolean> {
    return this.files.has(filePath);
  }

  async read(filePath: string): Promise<unknown> {
    return this.files.get(filePath);
  }

  async write(filePath: string, config: UnifiedRootConfig): Promise<void> {
    this.writeCount++;
    this.files.set(filePath, JSON.parse(JSON.stringify(config)) as UnifiedRootConfig);
  }
}

class TestDialogs implements DialogService {
  infoResult: string | undefined;
  quickPickResult: QuickPickItem | QuickPickItem[] | undefined;
  readonly quickPickResults: Array<QuickPickItem | QuickPickItem[] | undefined> = [];
  inputResult: string | undefined;
  readonly successes: string[] = [];
  readonly errors: string[] = [];

  async showInfo(_message: string): Promise<string | undefined> {
    return this.infoResult;
  }

  async showWarning(_message: string): Promise<string | undefined> {
    return undefined;
  }

  async showError(message: string): Promise<string | undefined> {
    this.errors.push(message);
    return undefined;
  }

  async showSuccess(message: string): Promise<void> {
    this.successes.push(message);
  }

  async showInput(_options: Parameters<DialogService['showInput']>[0]): Promise<string | undefined> {
    return this.inputResult;
  }

  async showQuickPick<T extends QuickPickItem>(
    _items: T[],
    _options: Parameters<DialogService['showQuickPick']>[1]
  ): Promise<T | T[] | undefined> {
    return (this.quickPickResults.length > 0 ? this.quickPickResults.shift() : this.quickPickResult) as T | T[] | undefined;
  }

  async showFolderPicker(_options: Parameters<DialogService['showFolderPicker']>[0]): Promise<string | undefined> {
    return undefined;
  }

  async showConfirmation(_message: string): Promise<boolean> {
    return false;
  }

  async showCommandConfig(_options: Parameters<DialogService['showCommandConfig']>[0]): Promise<string | undefined> {
    return undefined;
  }

  async withProgress<T>(_title: string, task: (progress: import('../app/ports').ProgressReporter) => Promise<T>): Promise<T> {
    return task({ report: () => {} });
  }
}

class TestLogger implements Logger {
  readonly messages: string[] = [];
  readonly errors: string[] = [];

  log(message: string): void {
    this.messages.push(message);
  }

  logError(message: string, error: unknown): void {
    this.errors.push(`${message}: ${String(error)}`);
  }
}

const pathPort: PathPort = {
  join: (...parts) => parts.join('/').replace(/\/+/g, '/'),
  dirname: filePath => filePath.slice(0, filePath.lastIndexOf('/')) || '/',
  basename: filePath => filePath.slice(filePath.lastIndexOf('/') + 1),
  resolve: (...parts) => parts.join('/').replace(/\/+/g, '/'),
  isAbsolute: filePath => filePath.startsWith('/')
};

function createManager(options: {
  storage?: MemoryStorage;
  repository?: MemoryRepository;
  dialogs?: TestDialogs;
  fileSystem?: AsyncFileSystemPort;
  folders?: Array<{ name: string; path: string }>;
  openFile?: string;
} = {}): {
  manager: RootConfigManager;
  storage: MemoryStorage;
  repository: MemoryRepository;
  dialogs: TestDialogs;
  logger: TestLogger;
} {
  const storage = options.storage || new MemoryStorage();
  const repository = options.repository || new MemoryRepository();
  const dialogs = options.dialogs || new TestDialogs();
  const logger = new TestLogger();
  const folders = options.folders || [{ name: 'workspace', path: '/workspace' }];
  const workspace: WorkspacePort = {
    folders,
    asRelativePath: filePath => filePath.replace(`${folders[0]?.path || ''}/`, ''),
    showOpenFile: async () => options.openFile
  };
  const fileSystem: AsyncFileSystemPort = options.fileSystem || {
    isDirectory: async () => true,
    readDirectory: async () => []
  };

  return {
    manager: new RootConfigManager({
      storage,
      workspace,
      fileSystem,
      path: pathPort,
      dialogs,
      logger,
      repository
    }),
    storage,
    repository,
    dialogs,
    logger
  };
}

suite('RootConfigManager', () => {
  test('uses the workspace configuration path until an explicit path is stored', async () => {
    const { manager, storage } = createManager();

    assert.equal(manager.getConfigPath(), '/workspace/.vscode/mf-explorer.roots.json');
    await manager.setConfigPath('/tmp/custom-roots.json');
    assert.equal(storage.get<string>('mf-explorer.configPath'), '/tmp/custom-roots.json');
    assert.equal(manager.getConfigPath(), '/tmp/custom-roots.json');
  });

  test('adds normalized roots and ignores duplicates', async () => {
    const { manager, repository, dialogs } = createManager();

    await manager.addRoot('/workspace/apps/../host');
    await manager.addRoot('/workspace/host');

    assert.deepEqual(repository.files.get('/workspace/.vscode/mf-explorer.roots.json'), {
      roots: ['/workspace/host']
    });
    assert.equal(repository.writeCount, 1);
    assert.equal(dialogs.successes.length, 1);
  });

  test('removes a root and its persisted per-root settings', async () => {
    const { manager, repository } = createManager();
    const configPath = '/workspace/.vscode/mf-explorer.roots.json';
    repository.files.set(configPath, {
      roots: ['/workspace/host', '/workspace/other'],
      rootConfigs: {
        '/workspace/host': { startCommand: 'npm start' },
        '/workspace/other': { startCommand: 'npm dev' }
      }
    });

    await manager.removeRoot('/workspace/host/../host');

    assert.deepEqual(repository.files.get(configPath), {
      roots: ['/workspace/other'],
      rootConfigs: { '/workspace/other': { startCommand: 'npm dev' } }
    });
  });

  test('migrates a legacy paths array and persists the current schema', async () => {
    const { manager, repository } = createManager();
    const configPath = '/workspace/.vscode/mf-explorer.roots.json';
    repository.files.set(configPath, { paths: ['/workspace/host'] });

    const config = await manager.loadRootConfig();

    assert.deepEqual(config, { roots: ['/workspace/host'] });
    assert.deepEqual(repository.files.get(configPath), { roots: ['/workspace/host'] });
  });

  test('creates an empty configuration when the user selects a new file', async () => {
    const dialogs = new TestDialogs();
    dialogs.quickPickResult = { label: '$(add) Create new configuration' };
    dialogs.inputResult = 'team-roots';
    const { manager, repository, storage } = createManager({ dialogs });

    assert.equal(await manager.changeConfigFile(), true);

    const configPath = '/workspace/.vscode/team-roots.json';
    assert.equal(storage.get<string>('mf-explorer.configPath'), configPath);
    assert.deepEqual(repository.files.get(configPath), { roots: [] });
  });

  test('finds JSON configurations across workspace folders and ignores missing directories', async () => {
    const fileSystem: AsyncFileSystemPort = {
      isDirectory: async () => true,
      readDirectory: async directory => directory === '/workspace/.vscode'
        ? ['mf-explorer.roots.json', 'settings.json', 'notes.txt']
        : Promise.reject(new Error('missing directory'))
    };
    const { manager } = createManager({
      fileSystem,
      folders: [
        { name: 'workspace', path: '/workspace' },
        { name: 'other', path: '/other' }
      ]
    });

    assert.deepStrictEqual(await manager.findExistingConfigs(), [
      '/workspace/.vscode/mf-explorer.roots.json',
      '/workspace/.vscode/settings.json'
    ]);
  });

  test('selects existing, browsed, and canceled configuration paths', async () => {
    const existingPath = '/workspace/.vscode/team.json';
    const fileSystem: AsyncFileSystemPort = {
      isDirectory: async () => true,
      readDirectory: async () => ['team.json']
    };
    const dialogs = new TestDialogs();
    dialogs.quickPickResult = { label: '$(file) team.json', description: '.vscode/team.json' };
    const { manager } = createManager({ dialogs, fileSystem, openFile: '/tmp/browsed.json' });

    assert.strictEqual(await manager.selectOrCreateConfigPath(), existingPath);
    dialogs.quickPickResult = { label: '$(folder) Browse...', description: 'Select a configuration file from the file system' };
    assert.strictEqual(await manager.selectOrCreateConfigPath(), '/tmp/browsed.json');
    dialogs.quickPickResult = undefined;
    assert.strictEqual(await manager.selectOrCreateConfigPath(), undefined);
    dialogs.quickPickResult = [];
    assert.strictEqual(await manager.selectOrCreateConfigPath(), undefined);
  });

  test('creates files in a selected workspace and handles multi-workspace cancellation', async () => {
    const folders = [
      { name: 'workspace', path: '/workspace' },
      { name: 'other', path: '/other' }
    ];
    const dialogs = new TestDialogs();
    dialogs.quickPickResults.push(
      { label: '$(add) Create new configuration' },
      { label: 'other', description: '/other' }
    );
    dialogs.inputResult = 'team';
    const { manager } = createManager({ dialogs, folders });

    assert.strictEqual(await manager.selectOrCreateConfigPath(), '/other/.vscode/team.json');
    dialogs.quickPickResult = undefined;
    assert.strictEqual(await manager.selectOrCreateConfigPath(), undefined);
  });

  test('returns safe defaults for missing, unsupported, and malformed configurations', async () => {
    const { manager, repository, logger } = createManager();
    const configPath = '/workspace/.vscode/mf-explorer.roots.json';

    assert.deepStrictEqual(await manager.loadRootConfig(), { roots: [] });
    repository.files.set(configPath, { unsupported: true });
    assert.deepStrictEqual(await manager.loadRootConfig(), { roots: [] });
    repository.files.set(configPath, '{malformed');
    assert.deepStrictEqual(await manager.loadRootConfig(), { roots: [] });
    assert.ok(logger.messages.some(message => message.includes('unsupported format')));
    const failingRepository = new MemoryRepository();
    failingRepository.files.set(configPath, { roots: ['/workspace/host'] });
    failingRepository.read = async () => { throw new Error('read failed'); };
    const failing = createManager({ repository: failingRepository });
    assert.deepStrictEqual(await failing.manager.loadRootConfig(), { roots: [] });
    assert.ok(failing.logger.errors.some(message => message.includes('Failed to load root configuration')));
  });

  test('handles invalid roots, missing configuration paths, and persistence failures', async () => {
    const dialogs = new TestDialogs();
    const fileSystem: AsyncFileSystemPort = {
      isDirectory: async () => false,
      readDirectory: async () => []
    };
    const { manager, repository } = createManager({ dialogs, fileSystem });

    await manager.addRoot('/workspace/file.txt');
    assert.deepStrictEqual(dialogs.errors, ['Failed to add root /workspace/file.txt']);
    const storage = new MemoryStorage();
    const noPath = createManager({ storage, fileSystem });
    noPath.storage.update = async () => { throw new Error('storage failed'); };
    await assert.rejects(() => noPath.manager.setConfigPath('/tmp/config.json'), /storage failed/);

    const failingRepository = new MemoryRepository();
    failingRepository.write = async () => { throw new Error('write failed'); };
    const failing = createManager({ repository: failingRepository });
    await failing.manager.saveRootConfig({ roots: ['/workspace/host'] });
    assert.ok(failing.logger.errors.some(message => message.includes('Failed to save root configuration')));
    repository.files.clear();
    await manager.removeRoot('/workspace/missing');
  });

  test('creates a default configuration without a workspace and rejects unknown workspace choices', async () => {
    const dialogs = new TestDialogs();
    dialogs.inputResult = 'roots.json';
    dialogs.quickPickResult = { label: '$(add) Create new configuration' };
    const { manager } = createManager({ dialogs, folders: [] });
    assert.strictEqual(await manager.changeConfigFile(), false);
    assert.deepStrictEqual(dialogs.errors, ['No workspace folder is open']);

    const multiDialogs = new TestDialogs();
    multiDialogs.quickPickResults.push(
      { label: '$(add) Create new configuration' },
      { label: 'missing workspace', description: '/missing' }
    );
    const { manager: multiManager } = createManager({ dialogs: multiDialogs, folders: [
      { name: 'one', path: '/one' },
      { name: 'two', path: '/two' }
    ] });
    assert.strictEqual(await multiManager.changeConfigFile(), false);
  });
});
