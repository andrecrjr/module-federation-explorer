import { ConfigurationService } from './configurationService';
import { DependencyGraphManager } from './dependencyGraph';
import { DialogUtils } from './dialogUtils';
import { detectPackageManagerAndStartCommand } from './packageManager';
import { RootConfigManager } from './rootConfigManager';
import { PathResolver } from './pathResolver';
import { TerminalManager } from './terminalManager';

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

export type RootConfigService = Pick<RootConfigManager,
  | 'hasConfiguredRoots'
  | 'loadRootConfig'
  | 'getConfigPath'
  | 'setConfigPath'
  | 'saveRootConfig'
  | 'addRoot'
  | 'removeRoot'
  | 'changeConfigFile'>;

export type ConfigurationLoader = Pick<ConfigurationService, 'load'>;

export type DependencyGraphService = Pick<DependencyGraphManager,
  | 'refreshDependencyGraph'
  | 'generateDependencyGraph'
  | 'showDependencyGraph'>;

export type PackageManagerDetector = typeof detectPackageManagerAndStartCommand;

export interface UnifiedModuleFederationProviderDependencies {
  rootConfigManager?: RootConfigService;
  configurationService?: ConfigurationLoader;
  dependencyGraphManager?: DependencyGraphService;
  terminalManager?: TerminalManager;
  pathResolver?: PathResolver;
  dialogs?: DialogService;
  detectPackageManager?: PackageManagerDetector;
}
