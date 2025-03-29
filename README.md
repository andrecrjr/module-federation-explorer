# Module Federation Explorer for Visual Studio Code

The **Module Federation Explorer** is a Visual Studio Code extension that helps you explore and manage Module Federation remotes in your workspace. It provides an intuitive interface to visualize and interact with your Module Federation configurations, whether you're using Webpack or Vite.

## Features

- **Root Folder Management**:
  - Add and remove root folders for Module Federation projects
  - Configure and manage multiple root applications
  - Automatic detection of Webpack and Vite configurations

- **Remote Management**:
  - Start and stop remote applications directly from the tree view
  - Configure custom start commands for each remote
  - Visual status indicators for running remotes

- **Configuration Management**:
  - Automatic detection of configuration files (`webpack.config.js`, `vite.config.js`)
  - Support for both Webpack and Vite Module Federation configurations
  - Persistent configuration storage

- **User Interface**:
  - Tree view in the VS Code explorer
  - Context menu actions for quick access to common operations
  - Status indicators for running applications

## Installation

1. Open Visual Studio Code
2. Go to the Extensions Marketplace (Ctrl+Shift+X or Cmd+Shift+X on macOS)
3. Search for "Module Federation Explorer"
4. Click "Install"

## Usage

### Getting Started

1. The extension will automatically activate when you open a workspace containing:
   - A `webpack.config.js` file
   - A `vite.config.js` file
   - A `.vscode/mf-explorer.roots.json` file

2. Look for the "Module Federation" view in the VS Code explorer sidebar

### Managing Root Folders

- Click the "+" button in the Module Federation view to add a root folder
- Right-click on a root folder to:
  - Start the root application
  - Configure the root application
  - Remove the root folder

### Managing Remotes

- Right-click on a remote to:
  - Start/stop the remote application
  - Configure the start command
  - View remote details

### Available Commands

- `Module Federation: Refresh` - Refresh the Module Federation view
- `Module Federation: Add Root Folder` - Add a new root folder
- `Module Federation: Remove Root Folder` - Remove a root folder
- `Module Federation: Change Configuration File` - Change the configuration file
- `Module Federation: Start Root App` - Start the root application
- `Module Federation: Stop Root App` - Stop the root application
- `Module Federation: Configure Root App` - Configure the root application
- `Module Federation: Start Remote` - Start a remote application
- `Module Federation: Stop Remote` - Stop a remote application
- `Module Federation: Configure Start Command` - Configure start command for a remote
- `Module Federation: Show Welcome` - Show the welcome message

## Requirements

- Visual Studio Code version 1.80.0 or higher
- A workspace with Module Federation configuration (Webpack or Vite)

## Extension Settings

The extension automatically detects and processes Module Federation configurations in your workspace. It supports:

- Webpack configuration files (`webpack.config.js`, `webpack.config.ts`)
- Vite configuration files (`vite.config.js`, `vite.config.ts`)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This extension is released under the MIT License.