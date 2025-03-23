# Module Federation Explorer for Visual Studio Code Workspace

The Module Federation Explorer is a Visual Studio Code extension that helps developers manage and explore Module Federation configurations in their project. This extension provides a tree view interface to visualize and interact with your Module Federation remotes, exposes, and configurations from Webpack and Vite setups.

## Features

- **Automatic Configuration Detection**: Automatically detects Webpack (`webpack.config.js`, `webpack.config.ts`) and Vite (`vite.config.js`, `vite.config.ts`) configuration files in your workspace.
- **Tree View Interface**: Displays a hierarchical view of your Module Federation setup:
  - Shows the status of Module Federation configuration (configured or not).
  - Lists all remotes and exposed modules.
  - Provides detailed information about each remote and exposed module.
- **Start/Stop Remotes**: Allows you to start and stop remote applications directly from the tree view.
- **Error Logging**: Logs errors and important events to the Output Channel for easy debugging.
- **Dynamic Updates**: Watches for changes in configuration files and updates the tree view dynamically.

## Installation

1. Open Visual Studio Code.
2. Go to the Extensions Marketplace (Ctrl+Shift+X or Cmd+Shift+X on macOS).
3. Search for "Module Federation Explorer".
4. Click "Install".

Alternatively, you can install it via the command line:

```bash
vsce package && code --install-extension module-federation-explorer.version.vsix%
```

## Usage

### Viewing Module Federation Configuration

1. Open the Command Palette (Ctrl+Shift+P or Cmd+Shift+P on macOS).
2. Search for and select "Module Federation Explorer: Show Welcome".
3. The Module Federation Explorer will appear in the sidebar, displaying your project's Module Federation configuration.

### Refreshing the View

- Right-click on the Module Federation Explorer view and select "Refresh" to reload configurations.
- Alternatively, use the command "Module Federation Explorer: Refresh" from the Command Palette.

### Starting and Stopping Remotes

- In the Module Federation Explorer tree view, click on the "Start Remote" button next to a remote to start it.
- To stop a running remote, right-click on the remote and select "Stop Remote".

### Configuring Start Commands

- Right-click on a remote and select "Configure Start Command" to set up custom build and start commands for that remote.

## Configuration File Management

The extension automatically detects and processes configuration files in your workspace. It looks for:

- Webpack configuration files: `webpack.config.js`, `webpack.config.ts`
- Vite configuration files: `vite.config.js`, `vite.config.ts`

These files are parsed to extract Module Federation settings, including remotes and exposes.

## Logging and Error Handling

All important events and errors are logged to the "Module Federation" Output Channel. Errors encountered during configuration loading or processing are displayed in the UI and logged for debugging purposes.

## Contributing

Contributions are welcome! If you find any issues or have suggestions for improvements, please open an issue or submit a pull request on the GitHub repository.

## License

This extension is released under the MIT License.