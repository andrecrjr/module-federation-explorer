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
  configType: 'webpack' | 'vite' | 'modernjs' | 'rsbuild' | 'rspack' | 'external'; // The type of configuration that defined this remote
  isExternal?: boolean; // Flag to indicate if this is an external remote added by user
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
 * Represents a Module Federation configuration
 */
export interface ModuleFederationConfig {
  name: string;
  remotes: Remote[];
  exposes: ExposedModule[];
  shared: SharedDependency[]; // Add shared dependencies
  detected?: boolean; // True when an extractor positively identifies Module Federation config
  configType: 'webpack' | 'vite' | 'modernjs' | 'rsbuild' | 'rspack';
  configPath: string;
}

export interface RemotesFolder {
  type: 'remotesFolder';
  parentName: string;
  parentPath?: string;
  remotes: Remote[];
}

export interface ExposesFolder {
  type: 'exposesFolder';
  parentName: string;
  exposes: ExposedModule[];
}



/**
 * Represents the unified federation root structure
 */
export interface UnifiedRootConfig {
  roots: string[]; // Array of absolute paths to root directories
  rootConfigs?: {
    [rootPath: string]: {
      startCommand?: string;
      remotes?: {
        [remoteName: string]: Remote;
      };
      externalRemotes?: {
        [remoteName: string]: {
          name: string;
          url: string;
          configType: 'external';
          isExternal: true;
        };
      };
    }
  };
}

/**
 * Represents a root federation directory in the tree view
 */
export interface RootFolder {
  type: 'rootFolder';
  path: string;
  name: string;
  configs: ModuleFederationConfig[];
  startCommand?: string;
  isRunning?: boolean;
}

/**
 * Represents shared dependency information
 */
export interface SharedDependency {
  name: string;
  version?: string;
  singleton?: boolean;
  eager?: boolean;
  requiredVersion?: string;
  strictVersion?: boolean;
}
