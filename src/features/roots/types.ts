import type { Remote } from '../../federation/types';

/** Persisted root folders and their host/remote overrides. */
export interface UnifiedRootConfig {
  roots: string[];
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
    };
  };
}
