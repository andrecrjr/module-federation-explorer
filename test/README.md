# Module Federation Explorer Extension Tests

This directory contains tests for the Module Federation Explorer VS Code extension.

## Test Structure

- `runTest.ts`: The main entry point for running tests
- `suite/index.ts`: Loads and runs all test files
- `suite/extension.test.ts`: Tests the basic activation of the extension
- `suite/mocks/vscode.mock.ts`: Provides mock implementations of VS Code APIs for testing

## Running the Tests

To run the tests:

1. Install the dependencies:
   ```bash
   npm install
   ```

2. Run the tests:
   ```bash
   npm test
   ```

## Test Architecture

The testing architecture uses:

- [Mocha](https://mochajs.org/) for the test framework
- [@vscode/test-electron](https://github.com/microsoft/vscode-test) to download and run a headless instance of VS Code for testing
- [Sinon](https://sinonjs.org/) for stubbing and mocking

## Adding More Tests

To add more tests:

1. Create a new test file in the `suite` directory with the `.test.ts` extension
2. Import the necessary modules and use the Mocha `suite` and `test` functions to define your tests
3. Use `VSCodeMock` to help with mocking VS Code APIs

## Common VS Code Extension Testing Patterns

- **Activation Tests**: Test that the extension activates correctly
- **Command Registration Tests**: Test that commands are properly registered
- **View Tests**: Test that views are properly created and displayed
- **API Tests**: Test extension API functionality
- **Integration Tests**: Test the extension in a real VS Code environment

## Troubleshooting

- If tests fail to run, make sure you have all the required dependencies installed
- Check that the extension manifest (`package.json`) is properly configured
- Ensure that the extension's activation events are correctly set 