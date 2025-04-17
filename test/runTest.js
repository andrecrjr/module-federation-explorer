const path = require('path');
const cp = require('child_process');
const { promisify } = require('util');
const { promises: fs } = require('fs');

const {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests
} = require('@vscode/test-electron');

// Execute a command as a promise
const exec = promisify(cp.exec);

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');

    // The path to the extension test runner script
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, './suite/index.js');

    console.log('Extension development path:', extensionDevelopmentPath);
    console.log('Extension tests path:', extensionTestsPath);

    // Download VS Code, unzip it and run the integration test
    console.log('Downloading VS Code for testing...');
    const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
    const [cliPath, ...args] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
    
    // Create test cache path if it doesn't exist
    const cachePath = path.resolve(__dirname, '.vscode-test/cache');
    try {
      await fs.mkdir(cachePath, { recursive: true });
    } catch (err) {
      console.log('Cache directory already exists or could not be created:', err.message);
    }
    
    console.log('Running tests...');
    // Run the tests with extended timeout and additional options
    const testOptions = {
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        '--disable-extensions',
        '--disable-gpu',
        '--skip-welcome',
        '--skip-release-notes',
        '--no-sandbox'
      ],
      cachePath,
      timeout: 60000 // Increase timeout to 60 seconds
    };
    
    await runTests(testOptions);
    
    console.log('Tests completed successfully');
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

main(); 