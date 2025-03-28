/**
 * Represents a Module Federation remote application
 */
export interface Remote {
  packageManager: string;
  name: string;
  url?: string;
  folder: string;
  configSource?: string; // Track which config file defined this remote
  remoteEntry?: string; // The remote entry point
  startCommand?: string; // The command to start the remote application
  buildCommand?: string; // The command to build the remote application
  configType: 'webpack' | 'vite'; // The type of configuration that defined this remote
}

/**
 * Represents a Module Federation exposed module
 */
export interface ExposedModule {
  name: string;
  path: string;
  remoteName: string;
  configSource?: string;
}

/**
 * Represents the Module Federation configuration status
 */
export interface ModuleFederationStatus {
  hasConfig: boolean;
  name?: string;
  configType?: 'webpack' | 'vite';
  configPath?: string;
  remotesCount: number;
  exposesCount: number;
  isRunning?: boolean;
  processId?: number;
  startCommand?: string;
}

/**
 * Represents a Module Federation configuration
 */
export interface ModuleFederationConfig {
  name: string;
  remotes: Remote[];
  exposes: ExposedModule[];
  configType: 'webpack' | 'vite';
  configPath: string;
}

export interface RemotesFolder {
  type: 'remotesFolder';
  parentName: string;
  remotes: Remote[];
}

export interface ExposesFolder {
  type: 'exposesFolder';
  parentName: string;
  exposes: ExposedModule[];
}

/**
 * Represents a federation root directory
 */
export interface FederationRoot {
  type: 'federationRoot';
  path: string;
  name: string;
  configs: ModuleFederationConfig[];
}

/**
 * Represents the unified federation root structure
 */
export interface UnifiedRootConfig {
  roots: string[]; // Array of absolute paths to root directories
}

/**
 * Represents a root directory in the tree view
 */
export interface RootFolder {
  type: 'rootFolder';
  path: string;
  name: string;
  configs: ModuleFederationConfig[];
} 