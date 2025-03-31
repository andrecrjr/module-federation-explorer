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
  configType: 'webpack' | 'vite' | 'modernjs'; // The type of configuration that defined this remote
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
  configType: 'webpack' | 'vite' | 'modernjs';
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
  rootConfigs?: {
    [rootPath: string]: {
      startCommand?: string;
      remotes?: {
        [remoteName: string]: Remote;
      };
    }
  };
}

/**
 * Represents a root directory in the tree view
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
  type: 'host' | 'remote';
  configType: 'webpack' | 'vite' | 'modernjs';
}

/**
 * Represents an edge in the Module Federation dependency graph
 */
export interface DependencyGraphEdge {
  from: string;
  to: string;
  label?: string;
}

/**
 * Represents the complete Module Federation dependency graph
 */
export interface DependencyGraph {
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
} 