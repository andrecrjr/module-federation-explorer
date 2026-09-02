import type { ExposedModule, ModuleFederationConfig, Remote } from '../../federation/types';
import type {
  ManifestArtifact,
  ManifestAsset,
  ManifestExpose,
  ManifestRecord,
  ManifestRemote,
  ManifestSharedDependency
} from '../../federation/manifestTypes';

/** Explorer tree item representing remotes imported by a root. */
export interface RemotesFolder {
  type: 'remotesFolder';
  parentName: string;
  parentPath?: string;
  remotes: Remote[];
}

/** Explorer tree item representing modules exposed by a root. */
export interface ExposesFolder {
  type: 'exposesFolder';
  parentName: string;
  exposes: ExposedModule[];
}

/** Explorer tree item grouping discovered runtime manifests. */
export interface ManifestsFolder {
  type: 'manifestsFolder';
  manifests: readonly ManifestRecord[];
}

/** Explorer tree item representing one discovered runtime manifest. */
export interface ManifestItem {
  type: 'manifestItem';
  manifest: ManifestRecord;
}

export type ManifestSectionKind = 'exposes' | 'remotes' | 'shared' | 'assets' | 'types';

export interface ManifestSection {
  type: 'manifestSection';
  kind: ManifestSectionKind;
  manifestName: string;
  items: readonly ManifestValueItem[];
}

export type ManifestTreeValue =
  | ManifestExpose
  | ManifestRemote
  | ManifestSharedDependency
  | ManifestAsset
  | ManifestArtifact;

export interface ManifestValueItem {
  type: 'manifestValue';
  value: ManifestTreeValue;
}

/** Explorer tree item representing a configured root folder. */
export interface RootFolder {
  type: 'rootFolder';
  path: string;
  name: string;
  configs: ModuleFederationConfig[];
  startCommand?: string;
  isRunning?: boolean;
}
