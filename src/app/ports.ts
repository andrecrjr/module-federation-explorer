import type { ConfigurationSnapshot } from '../configurationService';
import type { DependencyGraph } from '../features/graph/types';
import type { ModuleFederationConfig } from '../federation/types';
import type { ManifestDiscoveryOptions, ManifestDiscoveryResult } from '../federation/manifestTypes';
import type { UnifiedRootConfig } from '../features/roots/types';

/** Application logging boundary. Implementations may target VS Code output channels. */
export interface Logger {
  log(message: string): void;
  logError(message: string, error: unknown): void;
}

export interface PerformanceMeasurement {
  readonly name: string;
  readonly durationMs: number;
}

export interface PerformanceMark {
  readonly name: string;
  readonly elapsedMs: number;
}

export interface PerformanceSnapshot {
  readonly schemaVersion: 1;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly measurements: readonly PerformanceMeasurement[];
  readonly marks: readonly PerformanceMark[];
}

/** Optional timing boundary used by the activation benchmark. */
export interface PerformancePort {
  readonly enabled: boolean;
  mark(name: string): void;
  measure<T>(name: string, operation: () => Promise<T>): Promise<T>;
  getSnapshot(): PerformanceSnapshot;
  flush(): Promise<void>;
}

export interface DialogMessageAction {
  title: string;
  isCloseAffordance?: boolean;
}

export interface DialogMessageOptions {
  modal?: boolean;
  detail?: string;
  actions?: DialogMessageAction[];
}

export interface QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
}

export interface QuickPickOptions {
  title: string;
  placeholder: string;
  canPickMany?: boolean;
  ignoreFocusOut?: boolean;
  matchOnDescription?: boolean;
  matchOnDetail?: boolean;
}

export interface InputBoxOptions {
  title: string;
  prompt: string;
  placeholder?: string;
  value?: string;
  validateInput?: (value: string) => string | undefined;
  ignoreFocusOut?: boolean;
}

export interface FolderPickerOptions {
  title: string;
  openLabel?: string;
  defaultPath?: string;
  validateFolder?: (folderPath: string) => Promise<{ valid: boolean; message?: string }>;
}

export interface ConfirmationOptions {
  detail?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

export type CommandConfigType = 'build' | 'start' | 'dev' | 'preview';

export interface CommandConfigOptions {
  title: string;
  commandType: CommandConfigType;
  currentCommand?: string;
  packageManager?: string;
  projectPath?: string;
  configType?: string;
}

/** UI boundary used by application workflows. */
export interface DialogService {
  showInfo(message: string, options?: DialogMessageOptions): Promise<string | undefined>;
  showWarning(message: string, options?: DialogMessageOptions): Promise<string | undefined>;
  showError(message: string, options?: DialogMessageOptions): Promise<string | undefined>;
  showSuccess(message: string, detail?: string): Promise<void>;
  showInput(options: InputBoxOptions): Promise<string | undefined>;
  showQuickPick<T extends QuickPickItem>(items: T[], options: QuickPickOptions): Promise<T | T[] | undefined>;
  showFolderPicker(options: FolderPickerOptions): Promise<string | undefined>;
  showConfirmation(message: string, options?: ConfirmationOptions): Promise<boolean>;
  showCommandConfig(options: CommandConfigOptions): Promise<string | undefined>;
  withProgress<T>(title: string, task: (progress: ProgressReporter) => Promise<T>): Promise<T>;
}

export interface ProgressReporter {
  report(value: { message?: string; increment?: number }): void;
}

/** Persistence boundary for the root configuration workflow. */
export interface RootConfigService {
  hasConfiguredRoots(): Promise<boolean>;
  loadRootConfig(): Promise<UnifiedRootConfig | null>;
  getConfigPath(): string | undefined;
  setConfigPath(configPath: string): Promise<void>;
  saveRootConfig(config: UnifiedRootConfig): Promise<void>;
  addRoot(rootPath: string): Promise<void>;
  removeRoot(rootPath: string): Promise<void>;
  changeConfigFile(): Promise<boolean>;
}

/** Federation discovery boundary consumed by the explorer application. */
export interface ConfigurationLoader {
  load(rootPaths: readonly string[]): Promise<ConfigurationSnapshot>;
}

/** Manifest discovery boundary consumed by the application coordinator. */
export interface ManifestLoader {
  discover(rootPaths: readonly string[], options?: ManifestDiscoveryOptions): Promise<ManifestDiscoveryResult>;
}

/** Graph feature boundary consumed by application commands. */
export interface DependencyGraphService {
  refreshDependencyGraph(configs: Map<string, ModuleFederationConfig[]>): void;
  generateDependencyGraph(configs: Map<string, ModuleFederationConfig[]>): DependencyGraph;
  showDependencyGraph(graph: DependencyGraph): void;
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn';
export type PackageManagerConfigType = 'webpack' | 'vite' | 'rsbuild';

export interface PackageManagerInfo {
  packageManager: PackageManager;
  startCommand: string;
}

/** Node/package-manager boundary used by root and remote workflows. */
export type PackageManagerDetector = (
  folder: string,
  configType: PackageManagerConfigType
) => Promise<PackageManagerInfo>;

/** Workspace file discovery boundary for configuration scanners. */
export interface WorkspaceFileDiscovery {
  findFiles(rootPath: string, pattern: string, excludePattern: string): Promise<string[]>;
}

/** Node filesystem boundary used by path and persistence adapters. */
export interface FileSystemPort {
  existsSync(filePath: string): boolean;
  statSync(filePath: string): { isFile(): boolean; isDirectory(): boolean };
  readdirSync(directoryPath: string): string[];
  readFileSync(filePath: string): string;
}

export interface AsyncFileSystemPort {
  isDirectory(filePath: string): Promise<boolean>;
  readDirectory(directoryPath: string): Promise<string[]>;
}

/** Path operations needed by application workflows without importing Node path. */
export interface PathPort {
  join(...parts: string[]): string;
  dirname(filePath: string): string;
  basename(filePath: string): string;
  resolve(...parts: string[]): string;
  isAbsolute(filePath: string): boolean;
}

export interface PathResolverPort {
  resolveFileExtensionForPath(basePath: string): string;
}

/** Runtime terminal boundary shared by root and remote workflows. */
export interface TerminalLike {
  readonly name: string;
  readonly processId: unknown;
  dispose(): void;
  show?: () => void;
  sendText?: (text: string) => void;
}

export interface TerminalCreator {
  createTerminal(name: string, parentTerminal?: TerminalLike): TerminalLike;
}

export interface TerminalCleanupResult {
  remotes: number;
  rootApps: number;
}

export interface TerminalPort {
  startRemote(remoteKey: string, remoteName: string, folder: string, buildCommand: string, startCommand: string): void;
  startRootApp(rootPath: string, rootName: string, startCommand: string): void;
  setRunningRemote(remoteKey: string, startTerminal: TerminalLike, buildTerminal?: TerminalLike): void;
  getRunningRemoteTerminal(remoteKey: string): TerminalLike | undefined;
  stopRemote(remoteKey: string): void;
  setRunningRootApp(rootPath: string, terminal: TerminalLike): void;
  isRootAppRunning(rootPath: string): boolean;
  stopRootApp(rootPath: string): boolean;
  clearAllRunningApps(): void;
  cleanupDisposedTerminals(): TerminalCleanupResult;
  handleTerminalClosed(closedTerminal: TerminalLike): boolean;
}

/** VS Code host operations exposed to application workflows through a port. */
export interface ApplicationHostPort {
  executeCommand(command: string, ...args: unknown[]): PromiseLike<unknown>;
  setContext(key: string, value: boolean): PromiseLike<unknown>;
  withProgress<T>(title: string, task: (progress: ProgressReporter) => Promise<T>): PromiseLike<T>;
  showErrorMessage(message: string): PromiseLike<unknown>;
  schedule(task: () => void, delayMs: number): void;
}

export type SuccessEvent = 'onboarding-complete' | 'remote-started';

export interface FeedbackPort {
  initialize(): Promise<void>;
  trackSuccess(event: SuccessEvent): Promise<void>;
  openFeedback(): Promise<void>;
  openMarketplaceReview(): Promise<void>;
}

export interface ExternalLinkPort {
  openExternal(url: string): PromiseLike<unknown>;
}

/** Extension storage boundary used by feature workflows. */
export interface StoragePort {
  get<T>(key: string, defaultValue?: T): T | undefined;
  update<T>(key: string, value: T): PromiseLike<void>;
}

export interface WorkspaceFolderPort {
  name: string;
  path: string;
}

export interface WorkspacePort {
  readonly folders: readonly WorkspaceFolderPort[];
  asRelativePath(filePath: string): string;
  showOpenFile(): Promise<string | undefined>;
}
