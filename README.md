# Module Federation Explorer for Visual Studio Code

The **Module Federation Explorer** is a Visual Studio Code extension that helps you explore and manage Module Federation remotes in your workspace. It provides an intuitive interface to visualize and interact with your Module Federation configurations across Webpack, Vite, and ModernJS platforms.

## Features

- **Root Folder Management**:
  - Add and remove host folders for Module Federation projects
  - Configure and manage multiple root applications with custom start commands
  - Automatic detection of Webpack, Vite, and ModernJS configurations

- **Remote Management**:
  - Start and stop remote applications directly from the tree view
  - Configure custom build and start commands for each remote
  - Visual status indicators for running remotes
  - Automatic package manager detection (npm, yarn, pnpm)

- **Configuration Management**:
  - Automatic detection of configuration files (`webpack.config.js`, `vite.config.js`, `module-federation.config.js`)
  - Support for both JavaScript and TypeScript configuration files
  - Persistent configuration storage in `.vscode/mf-explorer.roots.json`

- **Navigation & Discoverability**:
  - Open exposed module files directly from the explorer
  - File watching for real-time configuration updates
  - Interactive dependency graph visualization

- **User Interface**:
  - Tree view in the VS Code explorer sidebar
  - Context menu actions for quick access to common operations
  - Status indicators for running applications
  - Welcome guide for first-time users

## Installation

1. Open Visual Studio Code
2. Go to the Extensions Marketplace (Ctrl+Shift+X or Cmd+Shift+X on macOS)
3. Search for "Module Federation Explorer"
4. Click "Install"

## Usage

### Getting Started

1. The extension will automatically activate when you open a workspace containing:
   - A `webpack.config.js` or `webpack.config.ts` file
   - A `vite.config.js` or `vite.config.ts` file
   - A `module-federation.config.js` or `module-federation.config.ts` file
   - A `.vscode/mf-explorer.roots.json` file

2. Look for the "Module Federation" view in the VS Code explorer sidebar

### Managing Host Folders

- Click the "+" button in the Module Federation view to add a host folder
- Right-click on a host folder to:
  - Start/stop the host application
  - Configure the host application's start command
  - Remove the host folder

### Managing Remotes

- Right-click on a remote to:
  - Start/stop the remote application
  - Configure build and start commands
  - Set the remote's project folder
  - View remote details

### Exploring Modules

- View exposed modules for each remote
- Click on an exposed module to open its source file
- View the dependency graph to understand relationships between hosts and remotes

### Available Commands

- `Module Federation: Refresh` - Refresh the Module Federation view
- `Module Federation: Add New Host Folder` - Add a new host folder
- `Module Federation: Remove Host Folder` - Remove a host folder
- `Module Federation: Change Configuration File` - Change the configuration file
- `Module Federation: Start Host App` - Start the host application
- `Module Federation: Stop Host App` - Stop the host application
- `Module Federation: Configure Root App` - Configure the host application
- `Module Federation: Show Dependency Graph` - Visualize the module federation architecture
- `Module Federation: Start Remote` - Start a remote application
- `Module Federation: Stop Remote` - Stop a remote application
- `Module Federation: Show Welcome` - Show the welcome page

## Requirements

- Visual Studio Code version 1.80.0 or higher
- A workspace with Module Federation configuration (Webpack, Vite, or ModernJS)

## Extension Settings

The extension automatically detects and processes Module Federation configurations in your workspace. It supports:

- Webpack configuration files (`webpack.config.js`, `webpack.config.ts`)
- Vite configuration files (`vite.config.js`, `vite.config.ts`)
- ModernJS configuration files (`module-federation.config.js`, `module-federation.config.ts`)

## Support

If you find this extension helpful, you can support the developer:

<a href="https://ko-fi.com/andrecrjr">
  <img src="https://cdn.prod.website-files.com/5c14e387dab576fe667689cf/670f5a01c01ea9191809398c_support_me_on_kofi_blue-p-500.png" alt="KoFi Donation" width="200"/>
</a>

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request at [https://github.com/andrecrjr/module-federation-explorer](https://github.com/andrecrjr/module-federation-explorer).

## License

This extension is released under the MIT License.