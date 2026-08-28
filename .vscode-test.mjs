import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
  {
    label: 'unit-and-extension-tests',
    files: 'out/test/test/**/*.test.js',
    extensionDevelopmentPath: process.cwd(),
    version: 'stable',
    mocha: {
      timeout: 20000
    }
  },
  {
    label: 'manual-flow-integration',
    files: 'out/test/test/manualFlows.integrationTest.js',
    extensionDevelopmentPath: process.cwd(),
    workspaceFolder: './src/test/fixtures/extension-workspace',
    version: 'stable',
    mocha: {
      timeout: 20000
    }
  }
]);
