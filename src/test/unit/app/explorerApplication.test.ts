import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import type {
  ApplicationHostPort,
  ConfigurationLoader,
  DependencyGraphService,
  DialogMessageOptions,
  DialogService,
  FeedbackPort,
  FileSystemPort,
  Logger,
  PathPort,
  PathResolverPort,
  PerformancePort,
  PerformanceSnapshot,
  ProgressReporter,
  QuickPickItem,
  QuickPickOptions,
  RootConfigService,
  TerminalLike,
  TerminalPort
} from '../../../app/ports';
import { ExplorerApplication, ExplorerApplicationServices } from '../../../app/explorerApplication';
import { ExplorerStore } from '../../../features/explorer/explorerStore';
import type { ConfigurationSnapshot } from '../../../configurationService';
import type { ModuleFederationConfig, Remote } from '../../../federation/types';
import type { RootFolder } from '../../../features/explorer/types';
import type { UnifiedRootConfig } from '../../../features/roots/types';
import type { DependencyGraph } from '../../../features/graph/types';

class MemoryRootConfig implements RootConfigService {
  configured = true;
  config: UnifiedRootConfig | null = { roots: ['/workspace/host'] };

  async hasConfiguredRoots(): Promise<boolean> {
    return this.configured;
  }
  async loadRootConfig(): Promise<UnifiedRootConfig | null> {
    return this.config;
  }
  getConfigPath(): string | undefined {
    return '/workspace/.vscode/mf-explorer.roots.json';
  }
  async setConfigPath(_configPath: string): Promise<void> {}
  async saveRootConfig(config: UnifiedRootConfig): Promise<void> {
    this.config = config;
  }
  async addRoot(rootPath: string): Promise<void> {
    this.config?.roots.push(rootPath);
  }
  async removeRoot(rootPath: string): Promise<void> {
    this.config = this.config ? { ...this.config, roots: this.config.roots.filter(item => item !== rootPath) } : null;
  }
  async changeConfigFile(): Promise<boolean> {
    return true;
  }
}

class TestDialogs implements DialogService {
  infoResult: string | undefined;
  warningResult: string | undefined;
  folderResult: string | undefined;
  inputResult: string | undefined;
  quickPickResult: QuickPickItem | QuickPickItem[] | undefined;
  confirmationResult = false;
  commandResult: string | undefined;
  readonly commandResults: Array<string | undefined> = [];
  readonly infos: string[] = [];
  readonly warnings: string[] = [];
  readonly errors: string[] = [];
  readonly successes: string[] = [];
  readonly folderOptions: Parameters<DialogService['showFolderPicker']>[0][] = [];
  readonly commandOptions: Parameters<DialogService['showCommandConfig']>[0][] = [];

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
  async showSuccess(message: string): Promise<void> {
    this.successes.push(message);
  }
  async showInput(): Promise<string | undefined> {
    return this.inputResult;
  }
  async showQuickPick<T extends QuickPickItem>(_items: T[], _options: QuickPickOptions): Promise<T | T[] | undefined> {
    return this.quickPickResult as T | T[] | undefined;
  }
  async showFolderPicker(options: Parameters<DialogService['showFolderPicker']>[0]): Promise<string | undefined> {
    this.folderOptions.push(options);
    return this.folderResult;
  }
  async showConfirmation(): Promise<boolean> {
    return this.confirmationResult;
  }
  async showCommandConfig(options: Parameters<DialogService['showCommandConfig']>[0]): Promise<string | undefined> {
    this.commandOptions.push(options);
    return this.commandResults.length > 0 ? this.commandResults.shift() : this.commandResult;
  }

  async withProgress<T>(_title: string, task: (progress: ProgressReporter) => Promise<T>): Promise<T> {
    return task({ report: () => {} });
  }
}

class RecordingTerminalManager implements TerminalPort {
  readonly startedRemotes: Array<{ key: string; name: string; folder: string; build: string; start: string }> = [];
  readonly startedRoots: Array<{ path: string; name: string; command: string }> = [];
  readonly stoppedRemotes: string[] = [];
  readonly stoppedRoots: string[] = [];
  rootRunning = false;
  runningRemoteTerminal: TerminalLike | undefined;
  cleanupResult = { remotes: 0, rootApps: 0 };
  terminalClosed = false;
  cleared = 0;

  startRemote(remoteKey: string, remoteName: string, folder: string, buildCommand: string, startCommand: string): void {
    this.startedRemotes.push({ key: remoteKey, name: remoteName, folder, build: buildCommand, start: startCommand });
  }

  startRootApp(rootPath: string, rootName: string, startCommand: string): void {
    this.startedRoots.push({ path: rootPath, name: rootName, command: startCommand });
  }
  setRunningRemote(_remoteKey: string, _startTerminal: TerminalLike, _buildTerminal?: TerminalLike): void {}
  getRunningRemoteTerminal(_remoteKey: string): TerminalLike | undefined {
    return this.runningRemoteTerminal;
  }
  stopRemote(remoteKey: string): void {
    this.stoppedRemotes.push(remoteKey);
  }
  setRunningRootApp(_rootPath: string, _terminal: TerminalLike): void {}
  isRootAppRunning(_rootPath: string): boolean {
    return this.rootRunning;
  }
  stopRootApp(rootPath: string): boolean {
    this.stoppedRoots.push(rootPath);
    return true;
  }
  clearAllRunningApps(): void {
    this.cleared++;
  }
  cleanupDisposedTerminals(): { remotes: number; rootApps: number } {
    return this.cleanupResult;
  }
  handleTerminalClosed(_closedTerminal: TerminalLike): boolean {
    return this.terminalClosed;
  }
}

class RecordingPerformance implements PerformancePort {
  readonly enabled = true;
  readonly measurements: string[] = [];

  mark(_name: string): void {}

  async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
    this.measurements.push(name);
    return operation();
  }

  getSnapshot(): PerformanceSnapshot {
    return { schemaVersion: 1, startedAt: '', measurements: [], marks: [] };
  }

  async flush(): Promise<void> {}
}

function hostConfig(): ModuleFederationConfig {
  return {
    name: 'host',
    remotes: [],
    exposes: [],
    shared: [],
    detected: true,
    configType: 'webpack',
    configPath: '/workspace/host/webpack.config.js'
  };
}

function remote(name = 'auth', overrides: Partial<Remote> = {}): Remote {
  return {
    name,
    folder: `/workspace/host/${name}`,
    packageManager: 'npm',
    configType: 'webpack',
    ...overrides
  };
}

function rootFolder(pathName = '/workspace/host', overrides: Partial<RootFolder> = {}): RootFolder {
  return {
    type: 'rootFolder',
    path: pathName,
    name: path.posix.basename(pathName),
    configs: [hostConfig()],
    ...overrides
  };
}

function createServices(
  options: {
    rootConfig?: MemoryRootConfig;
    configurationSnapshot?: ConfigurationSnapshot;
    dialogs?: TestDialogs;
    terminalManager?: RecordingTerminalManager;
    configurationError?: Error;
  } = {}
): {
  services: ExplorerApplicationServices;
  rootConfig: MemoryRootConfig;
  dialogs: TestDialogs;
  terminalManager: RecordingTerminalManager;
  performance: RecordingPerformance;
  graphCalls: { refresh: number; generate: number; show: number };
  contextValues: Map<string, boolean>;
  scheduledTasks: Array<() => void>;
  executedCommands: string[];
  hostErrors: string[];
  loadCalls: () => number;
  trackedEvents: string[];
} {
  const rootConfig = options.rootConfig || new MemoryRootConfig();
  const dialogs = options.dialogs || new TestDialogs();
  const terminalManager = options.terminalManager || new RecordingTerminalManager();
  const performance = new RecordingPerformance();
  const snapshot = options.configurationSnapshot || {
    configs: new Map<string, ModuleFederationConfig[]>([['/workspace/host', [hostConfig()]]]),
    errors: []
  };
  let loadCount = 0;
  const contextValues = new Map<string, boolean>();
  const graphCalls = { refresh: 0, generate: 0, show: 0 };
  const trackedEvents: string[] = [];
  const scheduledTasks: Array<() => void> = [];
  const executedCommands: string[] = [];
  const hostErrors: string[] = [];
  const graph: DependencyGraph = {
    nodes: [],
    edges: [],
    metadata: { totalHosts: 0, totalRemotes: 0, totalSharedDeps: 0, totalExposedModules: 0 }
  };
  const configurationService: ConfigurationLoader = {
    load: async () => {
      loadCount++;
      if (options.configurationError) throw options.configurationError;
      return snapshot;
    }
  };
  const dependencyGraphManager: DependencyGraphService = {
    refreshDependencyGraph: () => {
      graphCalls.refresh++;
    },
    generateDependencyGraph: () => {
      graphCalls.generate++;
      return graph;
    },
    showDependencyGraph: () => {
      graphCalls.show++;
    }
  };
  const host: ApplicationHostPort = {
    executeCommand: async command => {
      executedCommands.push(command);
    },
    setContext: async (key, value) => {
      contextValues.set(key, value);
    },
    withProgress: async <T>(_title: string, task: (progress: ProgressReporter) => Promise<T>) =>
      task({ report: () => {} }),
    showErrorMessage: async message => {
      hostErrors.push(message);
    },
    schedule: task => {
      scheduledTasks.push(task);
    }
  };
  const fileSystem: Pick<FileSystemPort, 'existsSync' | 'statSync'> = {
    existsSync: () => true,
    statSync: () => ({ isFile: () => false, isDirectory: () => true })
  };
  const pathPort: PathPort = {
    join: (...parts) => path.posix.join(...parts),
    dirname: filePath => path.posix.dirname(filePath),
    basename: filePath => path.posix.basename(filePath),
    resolve: (...parts) => path.posix.resolve(...parts),
    isAbsolute: filePath => path.posix.isAbsolute(filePath)
  };
  const pathResolver: PathResolverPort = { resolveFileExtensionForPath: () => '.js' };
  const logger: Logger = { log: () => {}, logError: () => {} };
  const detectPackageManager = async () => ({ packageManager: 'npm' as const, startCommand: 'npm start' });
  const feedback: FeedbackPort = {
    initialize: async () => {},
    trackSuccess: async event => {
      trackedEvents.push(event);
    },
    openFeedback: async () => {},
    openMarketplaceReview: async () => {}
  };

  return {
    services: {
      rootConfigManager: rootConfig,
      configurationService,
      dependencyGraphManager,
      terminalManager,
      pathResolver,
      dialogs,
      detectPackageManager,
      logger,
      fileSystem,
      path: pathPort,
      host,
      feedback,
      performance
    },
    rootConfig,
    dialogs,
    terminalManager,
    performance,
    graphCalls,
    contextValues,
    scheduledTasks,
    executedCommands,
    hostErrors,
    loadCalls: () => loadCount,
    trackedEvents
  };
}

suite('ExplorerApplication', () => {
  test('initializes without scanning when no roots are configured', async () => {
    const rootConfig = new MemoryRootConfig();
    rootConfig.configured = false;
    const harness = createServices({ rootConfig });
    const app = new ExplorerApplication('/workspace/project', new ExplorerStore(), harness.services);

    await app.initialize();

    assert.equal(harness.loadCalls(), 0);
    assert.equal(harness.contextValues.get('moduleFederation.hasRoots'), false);
  });

  test('loads configurations, hydrates root folders, and refreshes the graph', async () => {
    const harness = createServices();
    const store = new ExplorerStore();
    const app = new ExplorerApplication('/workspace/project', store, harness.services);

    await app.initialize();

    assert.equal(harness.loadCalls(), 1);
    assert.equal(store.getSnapshot().rootFolders[0]?.name, 'host');
    assert.equal(store.getSnapshot().rootFolders[0]?.isRunning, false);
    assert.equal(harness.contextValues.get('moduleFederation.hasRoots'), true);
    assert.equal(harness.graphCalls.refresh, 1);
    assert.deepEqual(harness.performance.measurements, [
      'initialize',
      'initialLoad',
      'rootConfigLoad',
      'configurationLoad',
      'rootAppConfigLoad',
      'remoteHydration',
      'treeStateUpdate'
    ]);
  });

  test('shows an informational message instead of opening an empty graph', async () => {
    const rootConfig = new MemoryRootConfig();
    rootConfig.configured = false;
    const harness = createServices({ rootConfig });
    const app = new ExplorerApplication('/workspace/project', new ExplorerStore(), harness.services);

    await app.showDependencyGraph();

    assert.deepEqual(harness.dialogs.infos, [
      'No Module Federation configurations found. Please add a Host folder first.'
    ]);
    assert.equal(harness.graphCalls.generate, 0);
  });

  test('starts a configured remote and tracks the success event', async () => {
    const remote: Remote = {
      name: 'auth',
      folder: '/workspace/host/auth',
      packageManager: 'npm',
      configType: 'webpack',
      buildCommand: 'npm run build',
      startCommand: 'npm run start'
    };
    const snapshot: ConfigurationSnapshot = {
      configs: new Map([['/workspace/host', [{ ...hostConfig(), remotes: [remote] }]]]),
      errors: []
    };
    const harness = createServices({ configurationSnapshot: snapshot });
    const app = new ExplorerApplication('/workspace/project', new ExplorerStore(), harness.services);
    await app.initialize();

    await app.startRemote(remote);

    assert.deepEqual(harness.terminalManager.startedRemotes, [
      {
        key: 'remote-auth',
        name: 'auth',
        folder: '/workspace/host/auth',
        build: 'npm run build',
        start: 'npm run start'
      }
    ]);
    assert.deepEqual(harness.trackedEvents, ['remote-started']);
  });

  test('exposes configuration and runtime delegates through the application boundary', async () => {
    const harness = createServices();
    const store = new ExplorerStore();
    const app = new ExplorerApplication('/workspace/project', store, harness.services);
    const saved: UnifiedRootConfig = { roots: ['/workspace/other'] };

    assert.strictEqual(app.getStore(), store);
    assert.strictEqual(app.getWorkspaceRoot(), '/workspace/project');
    assert.strictEqual(await app.hasConfiguredRoots(), true);
    assert.deepStrictEqual(await app.loadRootConfig(), { roots: ['/workspace/host'] });
    assert.strictEqual(app.getConfigPath(), '/workspace/.vscode/mf-explorer.roots.json');
    await app.setConfigPath('/workspace/custom.json');
    await app.saveRootConfig(saved);
    assert.deepStrictEqual(harness.rootConfig.config, saved);
    assert.strictEqual(app.resolveFileExtensionForPath('/workspace/host'), '.js');
    assert.strictEqual(app.resolveRemoteFolderPath(remote()), '/workspace/host/auth');
    assert.deepStrictEqual(harness.dialogs.errors, []);
  });

  test('handles an empty configured root list and offers the add-host action', async () => {
    const rootConfig = new MemoryRootConfig();
    rootConfig.config = { roots: [] };
    const dialogs = new TestDialogs();
    dialogs.infoResult = 'Add Host';
    const harness = createServices({ rootConfig, dialogs });
    const app = new ExplorerApplication('/workspace/project', new ExplorerStore(), harness.services);

    await app.initialize();
    assert.strictEqual(harness.scheduledTasks.length, 1);
    harness.scheduledTasks[0]();
    await new Promise(resolve => setImmediate(resolve));

    assert.deepStrictEqual(harness.dialogs.infos, ['No Host directories are configured.']);
    assert.deepStrictEqual(harness.executedCommands, ['moduleFederation.addRoot']);
    assert.strictEqual(harness.graphCalls.refresh, 1);
  });

  test('clears the store when the root configuration disappears', async () => {
    const rootConfig = new MemoryRootConfig();
    rootConfig.config = null;
    const harness = createServices({ rootConfig });
    const store = new ExplorerStore();
    store.replace(new Map([['/workspace/stale', [hostConfig()]]]));
    const app = new ExplorerApplication('/workspace/project', store, harness.services);

    await app.initialize();

    assert.deepStrictEqual([...store.getConfigs()], []);
    assert.strictEqual(harness.graphCalls.refresh, 1);
  });

  test('queues a reload requested while a load is already in progress', async () => {
    const harness = createServices();
    const app = new ExplorerApplication('/workspace/project', new ExplorerStore(), harness.services);
    let loadCount = 0;
    harness.services.configurationService.load = async () => {
      loadCount++;
      if (loadCount === 1) await app.reloadConfigurations();
      return { configs: new Map([['/workspace/host', [hostConfig()]]]), errors: [] };
    };

    await app.initialize();
    await new Promise(resolve => setImmediate(resolve));

    assert.strictEqual(loadCount, 2);
    assert.strictEqual(harness.graphCalls.refresh, 2);
  });

  test('reports configuration load errors through both logging boundaries', async () => {
    const harness = createServices({ configurationError: new Error('broken config') });
    const app = new ExplorerApplication('/workspace/project', new ExplorerStore(), harness.services);

    await app.initialize();

    assert.deepStrictEqual(harness.dialogs.errors, ['Failed to load Module Federation configurations']);
    assert.deepStrictEqual(harness.hostErrors, [
      'Failed to load Module Federation configurations. See output panel for details.'
    ]);
  });

  test('starts an unconfigured remote after folder and command setup', async () => {
    const dialogs = new TestDialogs();
    dialogs.infoResult = 'Browse for Folder';
    dialogs.folderResult = '/workspace/host/catalog';
    dialogs.commandResults.push('npm run build', 'npm run start');
    const harness = createServices({ dialogs });
    const app = new ExplorerApplication('/workspace/project', new ExplorerStore(), harness.services);
    const target = remote('catalog', { folder: '', startCommand: undefined, buildCommand: undefined });

    await app.startRemote(target);

    assert.strictEqual(target.folder, '/workspace/host/catalog');
    assert.deepStrictEqual(harness.terminalManager.startedRemotes, [
      {
        key: 'remote-catalog',
        name: 'catalog',
        folder: '/workspace/host/catalog',
        build: 'npm run build',
        start: 'npm run start'
      }
    ]);
    assert.deepStrictEqual(harness.trackedEvents, ['remote-started']);
    assert.deepStrictEqual(harness.dialogs.successes, ['Started remote catalog']);
  });

  test('reconfigures a missing remote folder and skips a canceled command setup', async () => {
    const dialogs = new TestDialogs();
    dialogs.folderResult = '/workspace/host/auth-new';
    dialogs.commandResults.push(undefined);
    const harness = createServices({ dialogs });
    harness.services.fileSystem.existsSync = () => false;
    const app = new ExplorerApplication('/workspace/project', new ExplorerStore(), harness.services);
    const target = remote('auth', { startCommand: 'npm start', buildCommand: undefined });

    await app.startRemote(target);

    assert.strictEqual(target.folder, '/workspace/host/auth-new');
    assert.deepStrictEqual(harness.terminalManager.startedRemotes, []);
    assert.deepStrictEqual(harness.dialogs.warnings, []);
  });

  test('does not start a remote that already has a terminal', async () => {
    const dialogs = new TestDialogs();
    const harness = createServices({ dialogs });
    let shown = 0;
    harness.terminalManager.runningRemoteTerminal = {
      name: 'remote-auth',
      processId: 1,
      dispose: () => {},
      show: () => {
        shown++;
      }
    };
    const app = new ExplorerApplication('/workspace/project', new ExplorerStore(), harness.services);

    await app.startRemote(remote('auth', { buildCommand: 'npm build', startCommand: 'npm start' }));

    assert.strictEqual(shown, 1);
    assert.deepStrictEqual(harness.dialogs.infos, ['Remote auth is already running']);
    assert.deepStrictEqual(harness.terminalManager.startedRemotes, []);
  });

  test('stops remotes, handles terminal cleanup, and opens a populated graph', async () => {
    const terminalManager = new RecordingTerminalManager();
    terminalManager.cleanupResult = { remotes: 1, rootApps: 2 };
    terminalManager.terminalClosed = true;
    const harness = createServices({ terminalManager });
    const app = new ExplorerApplication('/workspace/project', new ExplorerStore(), harness.services);
    await app.initialize();

    await app.stopRemote(remote());
    app.cleanupDisposedTerminals();
    app.handleTerminalClosed({ name: 'auth', processId: 1, dispose: () => {} });
    await app.showDependencyGraph();
    app.clearAllRunningApps();

    assert.deepStrictEqual(terminalManager.stoppedRemotes, ['remote-auth']);
    assert.deepStrictEqual(harness.dialogs.successes, ['Stopped remote auth']);
    assert.strictEqual(terminalManager.cleared, 1);
    assert.strictEqual(harness.graphCalls.generate, 1);
    assert.strictEqual(harness.graphCalls.show, 1);
  });

  test('reorders roots and ignores invalid reorder requests', async () => {
    const rootConfig = new MemoryRootConfig();
    rootConfig.config = { roots: ['/workspace/a', '/workspace/b', '/workspace/c'] };
    const harness = createServices({ rootConfig });
    const app = new ExplorerApplication('/workspace/project', new ExplorerStore(), harness.services);

    await app.reorderRoots(rootFolder('/workspace/a'), rootFolder('/workspace/c'));
    assert.deepStrictEqual(rootConfig.config?.roots, ['/workspace/b', '/workspace/c', '/workspace/a']);
    await app.reorderRoots(rootFolder('/workspace/missing'));
    rootConfig.config = null;
    await app.reorderRoots(rootFolder('/workspace/a'));
    assert.strictEqual(harness.dialogs.errors.includes('Failed to load root configuration for reordering'), true);
  });
});
