import type { PathPort, RootConfigService } from '../../app/ports';
import type { Remote } from '../../federation/types';
import type { UnifiedRootConfig } from '../roots/types';
import type { DetectedProject, OnboardingConfigurationResult, OnboardingSelection } from './types';

type RootConfigEntry = NonNullable<UnifiedRootConfig['rootConfigs']>[string];

export interface OnboardingWorkflowDependencies {
  rootConfigManager: RootConfigService;
  path: PathPort;
  reloadConfigurations: () => Promise<void>;
}

/** Persists onboarding selections through the application-owned root workflow. */
export class OnboardingWorkflow {
  constructor(private readonly dependencies: OnboardingWorkflowDependencies) {}

  async configure(
    selections: readonly OnboardingSelection[],
    detectedProjects: readonly DetectedProject[]
  ): Promise<OnboardingConfigurationResult> {
    const currentConfig = (await this.dependencies.rootConfigManager.loadRootConfig()) || { roots: [] };
    const config: UnifiedRootConfig = {
      roots: [...currentConfig.roots],
      rootConfigs: { ...currentConfig.rootConfigs }
    };
    const projectsByPath = new Map(detectedProjects.map(project => [project.path, project]));
    let configuredProjects = 0;
    let skippedProjects = 0;

    for (const selection of selections) {
      const project = projectsByPath.get(selection.path);
      if (!project) {
        skippedProjects++;
        continue;
      }

      if (selection.role === 'host') {
        this.configureHost(config, project, detectedProjects);
        configuredProjects++;
        continue;
      }

      if (!selection.hostFolder) {
        skippedProjects++;
        continue;
      }

      this.configureRemote(config, project, selection.hostFolder);
      configuredProjects++;
    }

    if (configuredProjects === 0) return { configuredProjects, skippedProjects };

    await this.dependencies.rootConfigManager.saveRootConfig(config);
    await this.dependencies.reloadConfigurations();
    return { configuredProjects, skippedProjects };
  }

  private configureHost(
    config: UnifiedRootConfig,
    project: DetectedProject,
    detectedProjects: readonly DetectedProject[]
  ): void {
    if (!config.roots.includes(project.path)) config.roots.push(project.path);

    const rootConfig = this.ensureRootConfigEntry(config, project.path);
    for (const remote of project.remotes) {
      const remoteProject = detectedProjects.find(
        candidate => candidate.name === remote.name || (remote.url !== undefined && remote.url.includes(candidate.name))
      );
      if (!remoteProject) continue;

      rootConfig.remotes![remote.name] = {
        name: remote.name,
        url: remote.url,
        folder: remoteProject.path,
        configType: toStoredConfigType(remoteProject.configType),
        packageManager: 'npm'
      };
    }
  }

  private configureRemote(config: UnifiedRootConfig, project: DetectedProject, hostFolder: string): void {
    if (!config.roots.includes(hostFolder)) config.roots.push(hostFolder);

    const rootConfig = this.ensureRootConfigEntry(config, hostFolder);
    const remoteName = project.name || this.dependencies.path.basename(project.path);
    rootConfig.remotes![remoteName] = {
      ...rootConfig.remotes![remoteName],
      name: remoteName,
      folder: project.path,
      configType: toStoredConfigType(project.configType),
      packageManager: 'npm'
    };
  }

  private ensureRootConfigEntry(
    config: UnifiedRootConfig,
    rootPath: string
  ): RootConfigEntry & { remotes: Record<string, Remote> } {
    const rootConfigs = config.rootConfigs!;
    const existing = rootConfigs[rootPath];
    const entry = {
      ...existing,
      remotes: { ...existing?.remotes }
    };
    rootConfigs[rootPath] = entry;
    return entry;
  }
}

function toStoredConfigType(configType: DetectedProject['configType']): Remote['configType'] {
  return configType === 'rspack' ? 'webpack' : configType;
}
