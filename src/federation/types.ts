/** Supported federation configuration formats. */
export type FederationConfigType = 'webpack' | 'vite' | 'modernjs' | 'rsbuild' | 'rspack';

/** Identifies the source of normalized federation data. */
export type DataProvenance = 'static' | 'manifest' | 'merged';

/** A remote may also be added manually as an external URL. */
export type RemoteConfigType = FederationConfigType | 'external';

/** Represents a Module Federation remote application. */
export interface Remote {
  packageManager: string;
  name: string;
  url?: string;
  folder: string;
  configSource?: string;
  remoteEntry?: string;
  startCommand?: string;
  buildCommand?: string;
  configType: RemoteConfigType;
  isExternal?: boolean;
}

/** Represents a Module Federation exposed module. */
export interface ExposedModule {
  name: string;
  path: string;
  remoteName: string;
  configSource?: string;
}

/** Represents a Module Federation configuration discovered in a project. */
export interface ModuleFederationConfig {
  name: string;
  remotes: Remote[];
  exposes: ExposedModule[];
  shared: SharedDependency[];
  provenance: DataProvenance;
  detected?: boolean;
  configType: FederationConfigType;
  configPath: string;
}

/** Represents shared dependency information. */
export interface SharedDependency {
  name: string;
  version?: string;
  singleton?: boolean;
  eager?: boolean;
  requiredVersion?: string;
  strictVersion?: boolean;
}
