import * as assert from 'node:assert/strict';
import type { PathPort, RootConfigService } from '../../../../app/ports';
import { OnboardingWorkflow } from '../../../../features/onboarding/onboardingWorkflow';
import type { DetectedProject, OnboardingSelection } from '../../../../features/onboarding/types';
import type { UnifiedRootConfig } from '../../../../features/roots/types';

const pathPort: PathPort = {
  join: (...parts) => parts.join('/'),
  dirname: value => value.slice(0, value.lastIndexOf('/')) || '/',
  basename: value => value.slice(value.lastIndexOf('/') + 1),
  resolve: (...parts) => parts.join('/'),
  isAbsolute: value => value.startsWith('/')
};

function createRootConfigService(initial: UnifiedRootConfig | null): {
  service: RootConfigService;
  saved: UnifiedRootConfig[];
} {
  let config = initial;
  const saved: UnifiedRootConfig[] = [];
  const service: RootConfigService = {
    hasConfiguredRoots: async () => Boolean(config?.roots.length),
    loadRootConfig: async () => config,
    getConfigPath: () => '/workspace/.vscode/mf-explorer.roots.json',
    setConfigPath: async () => {},
    saveRootConfig: async next => {
      config = next;
      saved.push(next);
    },
    addRoot: async () => {},
    removeRoot: async () => {},
    changeConfigFile: async () => false
  };
  return { service, saved };
}

const projects: DetectedProject[] = [
  {
    path: '/workspace/host',
    name: 'host',
    configType: 'webpack',
    configPath: '/workspace/host/webpack.config.js',
    remotes: [{ name: 'auth', url: 'https://cdn.example.test/auth/remoteEntry.js' }]
  },
  {
    path: '/workspace/auth',
    name: 'auth',
    configType: 'vite',
    configPath: '/workspace/auth/vite.config.ts',
    remotes: []
  }
];

suite('Onboarding workflow', () => {
  test('persists host and remote selections, auto-links detected remotes, and reloads', async () => {
    const harness = createRootConfigService({
      roots: ['/workspace/existing'],
      rootConfigs: { '/workspace/existing': { startCommand: 'npm start' } }
    });
    let reloads = 0;
    const workflow = new OnboardingWorkflow({
      rootConfigManager: harness.service,
      path: pathPort,
      detectPackageManager: async folder => ({
        packageManager: folder.endsWith('/auth') ? 'yarn' : 'npm',
        startCommand: folder.endsWith('/auth') ? 'yarn dev' : 'npm run start'
      }),
      reloadConfigurations: async () => {
        reloads++;
      }
    });

    const result = await workflow.configure(
      [
        { path: '/workspace/host', role: 'host' },
        { path: '/workspace/auth', role: 'remote', hostFolder: '/workspace/host' }
      ],
      projects
    );

    assert.deepEqual(result, { configuredProjects: 2, skippedProjects: 0 });
    assert.equal(reloads, 1);
    assert.deepEqual(harness.saved[0], {
      roots: ['/workspace/existing', '/workspace/host'],
      rootConfigs: {
        '/workspace/existing': { startCommand: 'npm start' },
        '/workspace/host': {
          remotes: {
            auth: {
              name: 'auth',
              url: 'https://cdn.example.test/auth/remoteEntry.js',
              folder: '/workspace/auth',
              configType: 'vite',
              packageManager: 'yarn'
            }
          }
        }
      }
    });
  });

  test('skips unknown projects and remotes without a host without mutating config', async () => {
    const harness = createRootConfigService({ roots: [] });
    let reloads = 0;
    const workflow = new OnboardingWorkflow({
      rootConfigManager: harness.service,
      path: pathPort,
      detectPackageManager: async () => ({ packageManager: 'npm', startCommand: 'npm run start' }),
      reloadConfigurations: async () => {
        reloads++;
      }
    });
    const selections: OnboardingSelection[] = [
      { path: '/workspace/missing', role: 'host' },
      { path: '/workspace/auth', role: 'remote' }
    ];

    const result = await workflow.configure(selections, projects);

    assert.deepEqual(result, { configuredProjects: 0, skippedProjects: 2 });
    assert.equal(harness.saved.length, 0);
    assert.equal(reloads, 0);
  });
});
