# Module Federation Explorer for Visual Studio Code Workspace

The **Module Federation Explorer** is a powerful Visual Studio Code extension designed to streamline the management and exploration of Module Federation configurations in your projects. Whether you're working with Webpack or Vite, this extension provides an intuitive interface to visualize, interact with, and manage your Module Federation remotes, exposes, and configurations.

## Features

- **Automatic Configuration Detection**: Automatically detects Webpack (`webpack.config.js`, `webpack.config.ts`) and Vite (`vite.config.js`, `vite.config.ts`) configuration files in your workspace.
- **Tree View Interface**: Displays a hierarchical view of your Module Federation setup:
  - Shows the status of Module Federation configuration (configured or not).
  - Lists all remotes and exposed modules.
  - Provides detailed information about each remote and exposed module.
- **Start/Stop Remotes**: Allows you to start and stop remote applications directly from the tree view.
- **Remote Configuration**: Saves configuration for each remote module federation with customizable build and preview commands.
- **Error Logging**: Logs errors and important events to the Output Channel for easy debugging.
- **Dynamic Updates**: Watches for changes in configuration files and updates the tree view dynamically.

## Enhanced Features

- **Multi-Workspace Support**: Seamlessly works across multiple workspace folders, detecting and managing configurations in each folder independently.
- **Customizable Start Commands**: Configure custom build and start commands for each remote, allowing flexibility for different environments and workflows.
- **Package Manager Detection**: Automatically detects the package manager (npm, yarn, pnpm) used in your project and suggests appropriate start commands.
- **Remote Folder Selection**: Easily select or confirm the project folder for each remote, ensuring the correct context for build and start operations.
- **Command Palette Integration**: Access key functionalities like refreshing the view, starting/stopping remotes, and configuring start commands directly from the Command Palette.
- **Persistent Configuration Storage**: Saves remote configurations to a persistent storage file, ensuring your settings are retained across sessions.
- **Welcome Message and Guidance**: Provides a welcome message and guidance to help new users get started with the extension.

## Installation

1. Open Visual Studio Code.
2. Go to the Extensions Marketplace (Ctrl+Shift+X or Cmd+Shift+X on macOS).
3. Search for "Module Federation Explorer".
4. Click "Install".

Alternatively, you can install it via the command line:

```bash
vsce package && code --install-extension module-federation-explorer.[change-to-version].vsix
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

## Advanced Features

- **Configuration Path Customization**: Customize the path where remote configurations are stored, allowing for flexible project structures.
- **File Watcher**: Monitors configuration files for changes and automatically refreshes the tree view to reflect updates.
- **Error Notifications**: Provides user-friendly error notifications in the VS Code UI, helping you quickly identify and resolve issues.
- **Terminal Integration**: Integrates with VS Code terminals to run build and start commands, providing a seamless development experience.

## Contributing

Contributions are welcome! If you find any issues or have suggestions for improvements, please open an issue or submit a pull request on the GitHub repository.

## License

This extension is released under the MIT License.