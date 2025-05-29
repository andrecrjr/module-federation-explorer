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
  configType: 'webpack' | 'vite' | 'modernjs' | 'rsbuild' | 'external'; // The type of configuration that defined this remote
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
  configType: 'webpack' | 'vite' | 'modernjs' | 'rsbuild';
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
 * Represents a node in the Module Federation dependency graph
 */
export interface DependencyGraphNode {
  id: string;
  label: string;
  type: 'host' | 'remote' | 'shared-dependency' | 'exposed-module';
  configType: 'webpack' | 'vite' | 'modernjs' | 'rsbuild' | 'external';
  // Enhanced metadata
  version?: string;
  url?: string;
  status?: 'running' | 'stopped' | 'unknown';
  exposedModules?: string[];
  sharedDependencies?: string[];
  size?: number; // For visual sizing based on connections
  group?: string; // For grouping related nodes
}

/**
 * Represents an edge in the Module Federation dependency graph
 */
export interface DependencyGraphEdge {
  from: string;
  to: string;
  label?: string;
  type: 'consumes' | 'exposes' | 'shares' | 'depends-on';
  strength?: number; // For visual weight of the relationship
  bidirectional?: boolean;
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

/**
 * Represents the complete Module Federation dependency graph
 */
export interface DependencyGraph {
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
  sharedDependencies?: SharedDependency[];
  metadata?: {
    totalHosts: number;
    totalRemotes: number;
    totalSharedDeps: number;
    totalExposedModules: number;
  };
} 