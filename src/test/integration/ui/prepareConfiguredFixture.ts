import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const configuredFixturePaths = {
  workspacePath: path.resolve(__dirname, '../../../../../src/test/fixtures/ui-configured'),
  get rootPath(): string {
    return path.join(this.workspacePath, 'host');
  },
  get configPath(): string {
    return path.join(this.workspacePath, '.vscode', 'mf-explorer.roots.json');
  }
};

export async function prepareConfiguredFixture(): Promise<void> {
  const { rootPath, configPath } = configuredFixturePaths;
  const tempConfigPath = `${configPath}.tmp`;
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(
    tempConfigPath,
    JSON.stringify(
      {
        roots: [rootPath],
        rootConfigs: {
          [rootPath]: {
            startCommand: 'node fixture-process.js host-start',
            remotes: {
              auth: {
                name: 'auth',
                folder: path.join(rootPath, 'auth'),
                packageManager: 'npm',
                configType: 'webpack',
                buildCommand: 'node ../fixture-process.js remote-build',
                startCommand: 'node ../fixture-process.js remote-start'
              }
            }
          }
        }
      },
      null,
      2
    ),
    'utf8'
  );
  await fs.rename(tempConfigPath, configPath);
}

export async function resetConfiguredFixture(): Promise<void> {
  const { rootPath } = configuredFixturePaths;
  await Promise.all([
    fs.rm(path.join(rootPath, '.ui-host-start.started'), { force: true }),
    fs.rm(path.join(rootPath, 'auth', '.ui-remote-build.started'), { force: true }),
    fs.rm(path.join(rootPath, 'auth', '.ui-remote-start.started'), { force: true })
  ]);
  await prepareConfiguredFixture();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  void prepareConfiguredFixture().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
