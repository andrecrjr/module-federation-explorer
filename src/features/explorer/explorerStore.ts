import { ModuleFederationConfig, RootFolder } from '../../types';

export interface ExplorerSnapshot {
  readonly configs: ReadonlyMap<string, ModuleFederationConfig[]>;
  readonly rootFolders: readonly RootFolder[];
  readonly isLoading: boolean;
}

type StoreListener = () => void;

/** Owns the loaded explorer configuration snapshot independently from VS Code tree rendering. */
export class ExplorerStore {
  private configs = new Map<string, ModuleFederationConfig[]>();
  private rootFolders: readonly RootFolder[] = [];
  private loading = false;
  private readonly listeners = new Set<StoreListener>();

  getSnapshot(): ExplorerSnapshot {
    return {
      configs: this.configs,
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
