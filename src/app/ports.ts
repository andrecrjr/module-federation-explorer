import type { ConfigurationService } from '../configurationService';
import type { DependencyGraphManager } from '../dependencyGraph';
import type { DialogUtils } from '../dialogUtils';
import type { RootConfigManager } from '../features/roots/rootConfigManager';
import type { PackageManagerInfo, PackageManagerConfigType } from '../packageManager';
import type { TerminalLike, TerminalCleanupResult } from '../terminalManager';

/** Application logging boundary. Implementations may target VS Code output channels. */
export interface Logger {
  log(message: string): void;
  logError(message: string, error: unknown): void;
}

/** UI boundary used by application workflows. */
export type DialogService = Pick<typeof DialogUtils,
  | 'showInfo'
  | 'showWarning'
  | 'showError'
  | 'showSuccess'
  | 'showInput'
  | 'showQuickPick'
  | 'showFolderPicker'
  | 'showConfirmation'
  | 'showCommandConfig'>;

/** Persistence boundary for the root configuration workflow. */
export type RootConfigService = Pick<RootConfigManager,
  | 'hasConfiguredRoots'
  | 'loadRootConfig'
  | 'getConfigPath'
  | 'setConfigPath'
  | 'saveRootConfig'
  | 'addRoot'
  | 'removeRoot'
  | 'changeConfigFile'>;

/** Federation discovery boundary consumed by the explorer application. */
export type ConfigurationLoader = Pick<ConfigurationService, 'load'>;

/** Graph feature boundary consumed by application commands. */
export type DependencyGraphService = Pick<DependencyGraphManager,
  | 'refreshDependencyGraph'
  | 'generateDependencyGraph'
  | 'showDependencyGraph'>;

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

/** Runtime terminal boundary shared by root and remote workflows. */
export interface TerminalPort {
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
