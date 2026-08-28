import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const workspacePath = path.resolve(__dirname, '../../../src/test/fixtures/ui-configured');
const rootPath = path.join(workspacePath, 'host');
const configPath = path.join(workspacePath, '.vscode', 'mf-explorer.roots.json');

async function main(): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify({
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
  }, null, 2), 'utf8');
}

void main();
