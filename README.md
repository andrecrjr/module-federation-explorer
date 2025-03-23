# Module Federation Explorer

A Visual Studio Code extension for exploring and managing Module Federation remotes in your workspace.

## Features

- **Automatic Configuration Detection**
  - Detects Module Federation configurations from both Webpack and Vite setups
  - Supports `.js` and `.ts` configuration files
  - Auto-refreshes when configuration files change
  - Excludes `node_modules` from configuration search

- **Smart Package Manager Detection**
  - Automatically detects npm, yarn, or pnpm
  - Uses appropriate start commands based on project type (webpack/vite)
  - Adapts to different script names (start/dev) based on framework

- **Visual Explorer**
  - Tree view of all Module Federation apps in your workspace
  - Shows remotes and exposed modules for each app
  - Displays real-time running status of applications
  - Quick access to start/stop functionality

- **Application Management**
  - Start/stop Module Federation applications directly from VS Code
  - Run remotes independently
  - Configure custom start commands
  - View running status with visual indicators

## Requirements

- VS Code 1.80.0 or higher
- Node.js and npm/yarn/pnpm installed
- Webpack or Vite based Module Federation projects

## Usage

1. Open a workspace containing Module Federation projects
2. The extension will automatically detect configuration files and display them in the Module Federation explorer view
3. Use the tree view to:
   - View all detected Module Federation applications
   - See remotes and exposed modules for each app
   - Start/stop applications using the play/stop buttons
   - Manually refresh configurations using the refresh button
4. Right-click on items in the tree view for additional options

## Configuration Options

### Start Commands
- Each remote application can have its own custom start command
- Right-click on a remote and select "Configure Start Command" to:
  - Choose the package manager (npm, yarn, or pnpm)
  - Set a custom start command for the remote

### Package Manager Detection
The extension automatically detects and uses:
- npm (looks for package-lock.json)
- yarn (looks for yarn.lock)
- pnpm (looks for pnpm-lock.yaml)

### Framework-specific Settings
- Webpack projects: Uses `npm start` by default
- Vite projects: Uses `npm run dev` by default
- These defaults adapt based on the detected package manager

### Available Commands
- `Refresh`: Updates the Module Federation explorer view
- `Start MFE App`: Starts a Module Federation application
- `Stop MFE App`: Stops a running Module Federation application
- `Start Remote`: Starts a specific remote application
- `Configure Start Command`: Customizes how a remote application starts
- `Show Welcome`: Displays the welcome message

## Extension Settings

This extension contributes the following settings:

* None currently

## Known Issues

None currently.

## Release Notes

### 0.1.0

Initial release of Module Federation Explorer with the following features:
- Support for both Webpack and Vite Module Federation configurations
- Automatic package manager detection (npm, yarn, pnpm)
- Visual explorer for remotes and exposed modules
- Start/stop functionality for applications and remotes
- Auto-refresh on configuration changes 