import type { ModuleFederationConfig } from '../../federation/types';
import type { ManifestDiagnostic, ManifestLoadError, ManifestRecord } from '../../federation/manifestTypes';
import type { RootFolder } from './types';

export interface ExplorerSnapshot {
  readonly configs: ReadonlyMap<string, ModuleFederationConfig[]>;
  readonly manifests: readonly ManifestRecord[];
  readonly manifestErrors: readonly ManifestLoadError[];
  readonly manifestDiagnostics: readonly ManifestDiagnostic[];
  readonly rootFolders: readonly RootFolder[];
  readonly isLoading: boolean;
}

type StoreListener = () => void;

/** Owns the loaded explorer configuration snapshot independently from VS Code tree rendering. */
export class ExplorerStore {
  private configs = new Map<string, ModuleFederationConfig[]>();
  private manifests: readonly ManifestRecord[] = [];
  private manifestErrors: readonly ManifestLoadError[] = [];
  private manifestDiagnostics: readonly ManifestDiagnostic[] = [];
  private rootFolders: readonly RootFolder[] = [];
  private loading = false;
  private readonly listeners = new Set<StoreListener>();

  getSnapshot(): ExplorerSnapshot {
    return {
      configs: this.configs,
      manifests: this.manifests,
      manifestErrors: this.manifestErrors,
      manifestDiagnostics: this.manifestDiagnostics,
      rootFolders: this.rootFolders,
      isLoading: this.loading
    };
  }

  /** Internal application access for workflows that hydrate discovered configurations. */
  getConfigs(): Map<string, ModuleFederationConfig[]> {
    return this.configs;
  }

  replace(configs: Map<string, ModuleFederationConfig[]>): void {
    this.configs = configs;
    this.notify();
  }

  replaceManifests(manifests: readonly ManifestRecord[], errors: readonly ManifestLoadError[] = []): void {
    this.manifests = manifests;
    this.manifestErrors = errors;
    this.manifestDiagnostics = [
      ...manifests.flatMap(manifest => manifest.diagnostics),
      ...errors.flatMap(error => error.diagnostics)
    ];
    this.notify();
  }

  getManifests(): readonly ManifestRecord[] {
    return this.manifests;
  }

  getManifestErrors(): readonly ManifestLoadError[] {
    return this.manifestErrors;
  }

  getManifestDiagnostics(): readonly ManifestDiagnostic[] {
    return this.manifestDiagnostics;
  }

  setRootFolders(rootFolders: readonly RootFolder[]): void {
    this.rootFolders = rootFolders;
    this.notify();
  }

  setLoading(isLoading: boolean): void {
    this.loading = isLoading;
    this.notify();
  }

  clear(): void {
    this.configs = new Map();
    this.manifests = [];
    this.manifestErrors = [];
    this.manifestDiagnostics = [];
    this.rootFolders = [];
    this.notify();
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
