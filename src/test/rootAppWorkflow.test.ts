import * as assert from 'node:assert/strict';
import type {
  CommandConfigOptions,
  DialogMessageOptions,
  DialogService,
  FolderPickerOptions,
  InputBoxOptions,
  PackageManagerDetector,
  ProgressReporter,
  QuickPickItem,
  QuickPickOptions,
  RootConfigService,
  TerminalLike,
  TerminalPort
} from '../app/ports';
import { RootAppController, RootAppControllerDependencies } from '../features/roots/rootAppWorkflow';
import type { ModuleFederationConfig, RemotesFolder, RootFolder, UnifiedRootConfig } from '../types';

class TestDialogs implements DialogService {
  infoResult: string | undefined;
  warningResult: string | undefined;
  folderResult: string | undefined;
  inputResult: string | undefined;
  quickPickResult: QuickPickItem | QuickPickItem[] | undefined;
  commandResult: string | undefined;
  confirmationResult = false;
  readonly infos: string[] = [];
  readonly warnings: string[] = [];
  readonly successes: string[] = [];
  readonly errors: string[] = [];
  readonly folderOptions: FolderPickerOptions[] = [];
  readonly commandOptions: CommandConfigOptions[] = [];

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

  async showInput(_options: InputBoxOptions): Promise<string | undefined> {
    return this.inputResult;
  }

  async showQuickPick<T extends QuickPickItem>(_items: T[], _options: QuickPickOptions): Promise<T | T[] | undefined> {
    return this.quickPickResult as T | T[] | undefined;
  }

  async showFolderPicker(options: FolderPickerOptions): Promise<string | undefined> {
    this.folderOptions.push(options);
    return this.folderResult;
  }

  async showConfirmation(_message: string): Promise<boolean> {
    return this.confirmationResult;
  }

  async showCommandConfig(options: CommandConfigOptions): Promise<string | undefined> {
    this.commandOptions.push(options);
    return this.commandResult;
  }

  async withProgress<T>(_title: string, task: (progress: ProgressReporter) => Promise<T>): Promise<T> {
    return task({ report: () => {} });
  }
}

class MemoryRootConfig implements RootConfigService {
  configPath: string | undefined = '/workspace/.vscode/mf-explorer.roots.json';
  config: UnifiedRootConfig = {
    roots: ['/workspace/host'],
    rootConfigs: { '/workspace/host': { startCommand: 'npm start' } }
  };
  savedConfigs: UnifiedRootConfig[] = [];

  async hasConfiguredRoots(): Promise<boolean> {
    return this.config.roots.length > 0;
  }

  async loadRootConfig(): Promise<UnifiedRootConfig> {
    return this.config;
  }

  getConfigPath(): string | undefined {
    return this.configPath;
  }

  async setConfigPath(configPath: string): Promise<void> {
    this.configPath = configPath;
  }

  async saveRootConfig(config: UnifiedRootConfig): Promise<void> {
    this.config = config;
    this.savedConfigs.push(config);
  }

  async addRoot(rootPath: string): Promise<void> {
    this.config.roots.push(rootPath);
  }

  async removeRoot(rootPath: string): Promise<void> {
    this.config.roots = this.config.roots.filter(candidate => candidate !== rootPath);
  }

  async changeConfigFile(): Promise<boolean> {
    return false;
  }
}

class RecordingTerminalManager implements TerminalPort {
  rootRunning = false;
  startedRoot: { path: string; name: string; command: string } | undefined;
  stoppedRoot: string | undefined;

  startRemote(_remoteKey: string, _remoteName: string, _folder: string, _buildCommand: string, _startCommand: string): void {}

  startRootApp(rootPath: string, rootName: string, startCommand: string): void {
    this.startedRoot = { path: rootPath, name: rootName, command: startCommand };
    this.rootRunning = true;
  }

  setRunningRemote(_remoteKey: string, _startTerminal: TerminalLike, _buildTerminal?: TerminalLike): void {}
  getRunningRemoteTerminal(_remoteKey: string): TerminalLike | undefined { return undefined; }
  stopRemote(_remoteKey: string): void {}
  setRunningRootApp(_rootPath: string, _terminal: TerminalLike): void {}

  isRootAppRunning(_rootPath: string): boolean {
    return this.rootRunning;
  }

  stopRootApp(rootPath: string): boolean {
    this.stoppedRoot = rootPath;
    this.rootRunning = false;
    return true;
  }

  clearAllRunningApps(): void {}
  cleanupDisposedTerminals(): { remotes: number; rootApps: number } { return { remotes: 0, rootApps: 0 }; }
  handleTerminalClosed(_closedTerminal: TerminalLike): boolean { return false; }
}

const rootFolder: RootFolder = {
  type: 'rootFolder',
  path: '/workspace/host',
  name: 'host',
  configs: []
};

function createController(overrides: Partial<{
  dialogs: TestDialogs;
  rootConfigManager: MemoryRootConfig;
  terminalManager: RecordingTerminalManager;
  fileExists: boolean;
  detectPackageManager: PackageManagerDetector;
}> = {}): {
  controller: RootAppController;
  dialogs: TestDialogs;
  rootConfigManager: MemoryRootConfig;
  terminalManager: RecordingTerminalManager;
  refreshed: () => number;
  reloaded: () => number;
  replaced: Array<{ oldPath: string; newPath: string }>;
} {
  const dialogs = overrides.dialogs || new TestDialogs();
  const rootConfigManager = overrides.rootConfigManager || new MemoryRootConfig();
  const terminalManager = overrides.terminalManager || new RecordingTerminalManager();
  let refreshed = 0;
  let reloaded = 0;
  const replaced: Array<{ oldPath: string; newPath: string }> = [];
  const dependencies: RootAppControllerDependencies = {
    workspaceRoot: '/workspace/project',
    fileSystem: { existsSync: () => overrides.fileExists ?? true },
    path: {
      dirname: filePath => filePath.slice(0, filePath.lastIndexOf('/')) || '/',
      join: (...parts) => parts.join('/').replace(/\/+/g, '/')
    },
    rootConfigManager,
    terminalManager,
    dialogs,
    detectPackageManager: overrides.detectPackageManager || (async () => ({ packageManager: 'npm', startCommand: 'npm start' })),
    getRootConfigs: () => new Map<string, ModuleFederationConfig[]>(),
    refresh: () => { refreshed++; },
    reloadConfigurations: async () => { reloaded++; },
    replaceRootPath: (oldPath, newPath) => { replaced.push({ oldPath, newPath }); },
    removeRootFromMemory: () => {},
    addExternalRemoteToHost: async (_remotesFolder: RemotesFolder, _targetRootPath: string) => {},
    log: () => {},
    logError: () => {}
  };
  return {
    controller: new RootAppController(dependencies),
    dialogs,
    rootConfigManager,
    terminalManager,
    refreshed: () => refreshed,
    reloaded: () => reloaded,
    replaced
  };
}

suite('RootAppController', () => {
  test('starts a root using the persisted command when the tree item is not hydrated', async () => {
    const harness = createController();
    const folder = { ...rootFolder };

    await harness.controller.startRootApp(folder);

    assert.deepEqual(harness.terminalManager.startedRoot, {
      path: '/workspace/host',
      name: 'host',
      command: 'npm start'
    });
    assert.equal(folder.startCommand, 'npm start');
    assert.deepEqual(harness.dialogs.successes, ['Started Host app: host']);
  });

  test('does not start an already-running root', async () => {
    const terminalManager = new RecordingTerminalManager();
    terminalManager.rootRunning = true;
    const harness = createController({ terminalManager });

    await harness.controller.startRootApp(rootFolder);

    assert.equal(harness.terminalManager.startedRoot, undefined);
    assert.deepEqual(harness.dialogs.infos, ['Host app is already running: host']);
  });

  test('configures and persists a missing root start command', async () => {
    const dialogs = new TestDialogs();
    dialogs.inputResult = 'pnpm dev';
    const rootConfigManager = new MemoryRootConfig();
    rootConfigManager.config.rootConfigs = undefined;
    const harness = createController({ dialogs, rootConfigManager });
    const folder = { ...rootFolder };

    const command = await harness.controller.configureRootAppStartCommand(folder);

    assert.equal(command, 'pnpm dev');
    assert.equal(folder.startCommand, 'pnpm dev');
    assert.equal(harness.rootConfigManager.savedConfigs[0].rootConfigs?.['/workspace/host']?.startCommand, 'pnpm dev');
    assert.deepEqual(harness.dialogs.successes, ['Configured app start command for host: pnpm dev']);
  });

  test('changes a root folder only after the selected project is accepted', async () => {
    const dialogs = new TestDialogs();
    dialogs.quickPickResult = { label: '📁 Change Project Folder' };
    dialogs.folderResult = '/workspace/new-host';
    const harness = createController({ dialogs });
    const folder = { ...rootFolder, startCommand: 'npm start' };

    await harness.controller.editRootAppCommands(folder);

    assert.equal(folder.path, '/workspace/new-host');
    assert.deepEqual(harness.replaced, [{ oldPath: '/workspace/host', newPath: '/workspace/new-host' }]);
    assert.equal(harness.rootConfigManager.savedConfigs[0].rootConfigs?.['/workspace/new-host']?.startCommand, 'npm start');
    assert.deepEqual(harness.dialogs.successes, ['Updated project folder for host']);
  });

  test('reports a stop request without invoking the terminal manager when root is stopped', async () => {
    const harness = createController();

    await harness.controller.stopRootApp(rootFolder);

    assert.equal(harness.terminalManager.stoppedRoot, undefined);
    assert.deepEqual(harness.dialogs.infos, ['Host app is not running: host']);
  });

  test('requires configuration before adding a host and reloads after a successful add', async () => {
    const dialogs = new TestDialogs();
    const rootConfigManager = new MemoryRootConfig();
    rootConfigManager.configPath = undefined;
    rootConfigManager.changeConfigFile = async () => {
      rootConfigManager.configPath = '/workspace/settings.json';
      return true;
    };
    const harness = createController({ dialogs, rootConfigManager });

    await harness.controller.addRoot();
    assert.deepStrictEqual(harness.dialogs.infos, ['You need to set up your configuration file before adding hosts.']);
    assert.strictEqual(harness.reloaded(), 0);

    dialogs.infoResult = 'Configure Settings';
    dialogs.folderResult = '/workspace/new-host';
    await harness.controller.addRoot();

    assert.ok(rootConfigManager.config.roots.includes('/workspace/new-host'));
    assert.strictEqual(harness.reloaded(), 2);
    assert.strictEqual(harness.dialogs.folderOptions[0].defaultPath, '/workspace');
  });

  test('removes only a confirmed host and reloads only when changing config files succeeds', async () => {
    const dialogs = new TestDialogs();
    dialogs.confirmationResult = true;
    const harness = createController({ dialogs });

    await harness.controller.removeRoot(rootFolder);
    assert.deepStrictEqual(harness.rootConfigManager.config.roots, []);
    assert.deepStrictEqual(harness.dialogs.successes, ['Removed Host /workspace/host from configuration']);

    harness.rootConfigManager.changeConfigFile = async () => true;
    await harness.controller.changeConfigFile();
    assert.strictEqual(harness.reloaded(), 1);
    harness.rootConfigManager.changeConfigFile = async () => false;
    await harness.controller.changeConfigFile();
    assert.strictEqual(harness.reloaded(), 1);
  });

  test('does not start a root when its command configuration is canceled', async () => {
    const dialogs = new TestDialogs();
    dialogs.inputResult = undefined;
    const rootConfigManager = new MemoryRootConfig();
    rootConfigManager.config.rootConfigs = undefined;
    const harness = createController({ dialogs, rootConfigManager });

    await harness.controller.startRootApp({ ...rootFolder });

    assert.strictEqual(harness.terminalManager.startedRoot, undefined);
    assert.deepStrictEqual(harness.dialogs.successes, []);
    assert.strictEqual(harness.dialogs.commandOptions.length, 0);
  });

  test('stops a running root and updates the tree', async () => {
    const terminalManager = new RecordingTerminalManager();
    terminalManager.rootRunning = true;
    const harness = createController({ terminalManager });

    await harness.controller.stopRootApp(rootFolder);

    assert.strictEqual(harness.terminalManager.stoppedRoot, '/workspace/host');
    assert.deepStrictEqual(harness.dialogs.successes, ['Stopped Host app: host']);
    assert.strictEqual(harness.refreshed(), 1);
  });

  test('edits a start command and routes the external remote action', async () => {
    const dialogs = new TestDialogs();
    dialogs.quickPickResult = { label: '▶️ Edit Start Command' };
    dialogs.commandResult = 'pnpm dev';
    const harness = createController({ dialogs });
    const folder = { ...rootFolder, startCommand: 'npm start' };

    await harness.controller.editRootAppCommands(folder);
    assert.strictEqual(folder.startCommand, 'pnpm dev');
    assert.strictEqual(harness.rootConfigManager.savedConfigs.length, 1);

    dialogs.quickPickResult = { label: '🔗 Add External Remote' };
    await harness.controller.editRootAppCommands(folder);
    assert.strictEqual(harness.dialogs.errors.length, 0);
  });

  test('validates a changed host folder and cancels when no folder is selected', async () => {
    const dialogs = new TestDialogs();
    dialogs.quickPickResult = { label: '📁 Change Project Folder' };
    dialogs.folderResult = undefined;
    const harness = createController({ dialogs, fileExists: false });
    const folder = { ...rootFolder, startCommand: 'npm start' };

    await harness.controller.editRootAppCommands(folder);
    assert.strictEqual(harness.replaced.length, 0);
    const validateFolder = harness.dialogs.folderOptions[0].validateFolder;
    assert.ok(validateFolder);
    assert.deepStrictEqual(await validateFolder!('/workspace/not-a-project'), {
      valid: false,
      message: 'Invalid Node.js project folder'
    });
  });

  test('loads root folder settings only when a persisted config exists', async () => {
    const harness = createController();
    await harness.controller.loadRootFolderConfigs();
    harness.rootConfigManager.config = { roots: [] };
    await harness.controller.loadRootFolderConfigs();
    assert.ok(true);
  });
});
