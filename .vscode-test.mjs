import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  coverage: {
    includeAll: true,
    exclude: [
      '**/src/test/**',
      '**/src/ui-test/**',
      '**/out/test/test/**',
      '**/out/ui-test/**',
      '**/src/index.ts',
      '**/src/types.ts',
      '**/src/app/commandTypes.ts',
      '**/src/app/compositionRoot.ts',
      '**/src/app/ports.ts',
      '**/src/app/registerCommands.ts',
      '**/src/app/welcome.ts',
      '**/src/features/explorer/index.ts',
      '**/src/features/explorer/registerCommands.ts',
      '**/src/features/graph/dependencyGraph.ts',
      '**/src/features/graph/index.ts',
      '**/src/features/graph/types.ts',
      '**/src/infrastructure/vscode/dialogUtils.ts',
      '**/src/infrastructure/vscode/outputChannel.ts',
      '**/src/onboarding.ts',
      '**/src/ratingPrompt.ts',
      '**/out/test/index.js',
      '**/out/test/app/commandTypes.js',
      '**/out/test/app/compositionRoot.js',
      '**/out/test/app/ports.js',
      '**/out/test/app/registerCommands.js',
      '**/out/test/app/welcome.js',
      '**/out/test/features/explorer/index.js',
      '**/out/test/features/explorer/registerCommands.js',
      '**/out/test/features/graph/dependencyGraph.js',
      '**/out/test/features/graph/index.js',
      '**/out/test/features/graph/types.js',
      '**/out/test/infrastructure/vscode/dialogUtils.js',
      '**/out/test/infrastructure/vscode/outputChannel.js',
      '**/out/test/onboarding.js',
      '**/out/test/ratingPrompt.js'
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
      version: '1.135.0',
      mocha: {
        timeout: 20000
      }
    },
    {
      label: 'manual-flow-integration',
      files: 'out/test/test/manualFlows.integrationTest.js',
      extensionDevelopmentPath: process.cwd(),
      srcDir: './src',
      workspaceFolder: './src/test/fixtures/extension-workspace',
      version: '1.135.0',
      mocha: {
        timeout: 20000
      }
    }
  ]
});
