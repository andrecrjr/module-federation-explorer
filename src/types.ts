/**
 * Represents a Module Federation remote application
 */
export interface Remote {
  name: string;
  url?: string;
  folder: string;
  configSource?: string; // Track which config file defined this remote
  remoteEntry?: string; // The remote entry point
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
  configType?: 'webpack' | 'vite';
  configPath?: string;
  remotesCount: number;
  exposesCount: number;
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