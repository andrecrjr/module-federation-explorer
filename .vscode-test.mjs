import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/test/**/*.test.js',
  extensionDevelopmentPath: process.cwd(),
  version: 'stable',
  mocha: {
    timeout: 20000
  }
});
