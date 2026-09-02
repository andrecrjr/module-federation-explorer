import type { DataProvenance, ModuleFederationConfig } from './types';

export type ManifestSourceKind = 'local' | 'url';

export interface ManifestSourceConfig {
  kind: ManifestSourceKind;
  location: string;
  environment?: string;
}

export interface ManifestArtifact {
  name?: string;
  path: string;
  type?: string;
  api?: string;
  zip?: string;
}

export interface ManifestAsset {
  name?: string;
  path: string;
  type?: string;
  mode?: 'sync' | 'async';
}

export interface ManifestMetadata {
  name?: string;
  type?: string;
  buildVersion?: string;
  buildName?: string;
  buildInfo?: {
    buildVersion?: string;
    buildName?: string;
  };
  description?: string;
  globalName?: string;
  pluginVersion?: string;
  publicPath?: string;
  remoteEntry?: ManifestArtifact;
  ssrRemoteEntry?: ManifestArtifact;
  types?: ManifestArtifact;
  assets: ManifestAsset[];
  disableAssetsAnalyze: boolean;
}

export interface ManifestSharedDependency {
  id?: string;
  name: string;
  version?: string;
  requiredVersion?: string;
  hash?: string;
  singleton?: boolean;
  eager?: boolean;
  strictVersion?: boolean;
  shareScope?: string;
  fallback?: boolean;
  fallbackName?: string;
  fallbackType?: string;
  assets: ManifestAsset[];
}

export interface ManifestRemote {
  id?: string;
  name: string;
  moduleName?: string;
  federationContainerName?: string;
  aliases: string[];
  entry?: string;
  version?: string;
  remoteEntry?: ManifestArtifact;
  types?: ManifestArtifact;
  assets: ManifestAsset[];
}

export interface ManifestExpose {
  id?: string;
  name: string;
  path?: string;
  types?: ManifestArtifact;
  assets: ManifestAsset[];
}

export interface ManifestRecord {
  provenance: Extract<DataProvenance, 'manifest'>;
  id: string;
  name: string;
  metadata: ManifestMetadata;
  shared: ManifestSharedDependency[];
  remotes: ManifestRemote[];
  exposes: ManifestExpose[];
  source: ManifestSourceConfig;
  manifestPath: string;
  loadedAt: string;
  diagnostics: ManifestDiagnostic[];
  rootPath?: string;
  configPath?: string;
}

export type ManifestDiagnosticSeverity = 'error' | 'warning';

export type ManifestDiagnosticCode =
  | 'MALFORMED_JSON'
  | 'INVALID_ROOT'
  | 'MISSING_IDENTITY'
  | 'INVALID_IDENTITY'
  | 'INVALID_METADATA'
  | 'INVALID_REMOTE'
  | 'INVALID_EXPOSE'
  | 'INVALID_SHARED_DEPENDENCY'
  | 'ASSETS_OMITTED'
  | 'AMBIGUOUS_STATIC_ASSOCIATION';

export interface ManifestDiagnostic {
  code: ManifestDiagnosticCode;
  severity: ManifestDiagnosticSeverity;
  path: string;
  message: string;
}

export interface ManifestParseOptions {
  source?: ManifestSourceConfig;
  loadedAt?: string;
}

export interface ManifestParseResult {
  manifest?: ManifestRecord;
  diagnostics: ManifestDiagnostic[];
}

export interface ManifestDiscoveryOptions {
  sources?: readonly ManifestSourceConfig[];
  staticConfigs?: ReadonlyMap<string, ModuleFederationConfig[]>;
}

export interface ManifestLoadError {
  source: ManifestSourceConfig;
  error: unknown;
  diagnostics: ManifestDiagnostic[];
}

export interface ManifestDiscoveryResult {
  manifests: ManifestRecord[];
  errors: ManifestLoadError[];
}
