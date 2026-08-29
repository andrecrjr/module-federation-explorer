import { defineConfig } from '@vscode/test-cli';

const vscodeVersion = '1.135.0';
const vscodeDownload = { timeout: 120_000 };

export default defineConfig({
  coverage: {
    includeAll: true,
    exclude: [
      '**/src/test/**',
      '**/out/test/test/**',
      '**/out/ui-test/**',
      '**/src/index.ts',
      '**/src/federation/types.ts',
      '**/src/app/commandTypes.ts',
      '**/src/app/compositionRoot.ts',
      '**/src/app/ports.ts',
      '**/src/app/registerCommands.ts',
      '**/src/app/welcome.ts',
      '**/src/features/explorer/index.ts',
      '**/src/features/explorer/types.ts',
      '**/src/features/explorer/registerCommands.ts',
      '**/src/features/feedback/index.ts',
      '**/src/features/graph/dependencyGraph.ts',
      '**/src/features/graph/index.ts',
      '**/src/features/graph/types.ts',
      '**/src/features/onboarding/controller.ts',
      '**/src/features/onboarding/index.ts',
      '**/src/features/onboarding/template.ts',
      '**/src/features/onboarding/types.ts',
      '**/src/features/onboarding/workspaceScanner.ts',
      '**/src/features/roots/types.ts',
      '**/src/infrastructure/vscode/dialogUtils.ts',
      '**/src/infrastructure/vscode/outputChannel.ts',
      '**/out/test/index.js',
      '**/out/test/app/commandTypes.js',
      '**/out/test/app/compositionRoot.js',
      '**/out/test/app/ports.js',
      '**/out/test/app/registerCommands.js',
      '**/out/test/app/welcome.js',
      '**/out/test/features/explorer/index.js',
      '**/out/test/features/explorer/types.js',
      '**/out/test/features/explorer/registerCommands.js',
      '**/out/test/features/feedback/index.js',
      '**/out/test/features/graph/dependencyGraph.js',
      '**/out/test/features/graph/index.js',
      '**/out/test/features/graph/types.js',
      '**/out/test/features/onboarding/controller.js',
      '**/out/test/features/onboarding/index.js',
      '**/out/test/features/onboarding/template.js',
      '**/out/test/features/onboarding/types.js',
      '**/out/test/features/onboarding/workspaceScanner.js',
      '**/out/test/features/roots/types.js',
      '**/out/test/infrastructure/vscode/dialogUtils.js',
      '**/out/test/infrastructure/vscode/outputChannel.js',
      '**/out/test/federation/types.js'
    ],
    reporter: ['text-summary', 'json-summary', 'lcov'],
    output: 'reports/coverage'
  },
  tests: [
    {
      label: 'unit-and-extension-tests',
      files: 'out/test/test/**/*.test.js',
      extensionDevelopmentPath: process.cwd(),
      srcDir: './src',
      version: vscodeVersion,
      download: vscodeDownload,
      mocha: {
        timeout: 20000
      }
    },
    {
      label: 'manual-flow-integration',
      files: 'out/test/test/integration/app/manualFlows.integrationTest.js',
      extensionDevelopmentPath: process.cwd(),
      srcDir: './src',
      workspaceFolder: './src/test/fixtures/extension-workspace',
      version: vscodeVersion,
      download: vscodeDownload,
      mocha: {
        timeout: 20000
      }
    }
  ]
});
