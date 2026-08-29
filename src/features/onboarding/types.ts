import type { ConfigFileType } from '../../federation/configFileRegistry';

export interface DetectedRemoteProject {
  name: string;
  url?: string;
}

export interface DetectedProject {
  path: string;
  name: string;
  configType: ConfigFileType;
  configPath: string;
  remotes: DetectedRemoteProject[];
}

export type OnboardingProjectRole = 'host' | 'remote';

export interface OnboardingSelection {
  path: string;
  role: OnboardingProjectRole;
  hostFolder?: string;
}

export interface OnboardingConfigurationResult {
  configuredProjects: number;
  skippedProjects: number;
}
