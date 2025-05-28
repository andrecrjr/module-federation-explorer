# Module Federation Explorer for Visual Studio Code

<div style="display:flex;width:100%;justify-content:center">
<img src="./media/mfe-explorer-logo-big.png" alt="Module Federation Explorer Logo" width="450"/>
</div>

The **Module Federation Explorer** is a Visual Studio Code extension designed for **local development** that helps you explore, manage, and orchestrate Module Federation applications directly from your workspace. With integrated terminal support, you can start, stop, and monitor your micro-frontends without leaving your editor.

## 🚀 Key Highlights

- **Local Development First**: Built specifically for local development workflows
- **Terminal Integration**: Execute commands directly in VS Code's integrated terminal
- **Multi-Platform Support**: Works with Webpack, Vite, and ModernJS Module Federation setups
- **Zero Configuration**: Automatically detects your Module Federation configurations
- **Visual Management**: Tree view interface for easy navigation and control

## 📋 Prerequisites

- Visual Studio Code version 1.80.0 or higher
- Node.js and a package manager (npm, yarn, or pnpm)
- A local workspace with Module Federation configuration

## 🛠️ Installation

1. Open Visual Studio Code
2. Go to the Extensions Marketplace (`Ctrl+Shift+X` or `Cmd+Shift+X` on macOS)
3. Search for "Module Federation Explorer"
4. Click "Install"

## 🎯 Getting Started

### 1. Automatic Activation
The extension automatically activates when it detects any of these files in your workspace:
- `webpack.config.js` or `webpack.config.ts`
- `vite.config.js` or `vite.config.ts`
- `module-federation.config.js` or `module-federation.config.ts`
- `.vscode/mf-explorer.roots.json`

### 2. Initial Configuration
Before adding hosts, set up your configuration:
- Click the gear icon in the Module Federation Explorer view, or
- Use Command Palette (`Ctrl/Cmd + Shift + P`) → `Module Federation: Change Configuration File`

### 3. Access the Explorer
Find the "Module Federation Explorer" view in your VS Code sidebar to start managing your micro-frontends.

## ✨ Features

### 🏠 Host Application Management
- **Add/Remove Hosts**: Manage multiple host applications in your workspace
- **Custom Start Commands**: Configure specific startup commands for each host
- **Terminal Execution**: All commands run in VS Code's integrated terminal
- **Status Monitoring**: Visual indicators show which applications are running

### 🔗 Remote Application Control
- **Start/Stop Remotes**: Control remote applications with a single click
- **Custom Build Commands**: Configure build and start commands per remote
- **Package Manager Detection**: Automatically detects npm, yarn, or pnpm
- **Real-time Status**: See which remotes are currently running

### ⚙️ Configuration Management
- **Auto-Detection**: Automatically finds and parses configuration files
- **Multi-Framework Support**: Webpack, Vite, and ModernJS configurations
- **Persistent Settings**: Stores configuration in `.vscode/mf-explorer.roots.json`
- **File Watching**: Real-time updates when configurations change

### 🧭 Navigation & Discovery
- **Module Explorer**: Browse exposed modules from each remote
- **Direct File Access**: Click to open module source files
- **Dependency Visualization**: Interactive graph showing host-remote relationships
- **Quick Navigation**: Jump between related files and configurations

## 📖 Usage Guide

### Managing Hosts
1. **Add Host**: Click the "+" button in the explorer view
2. **Configure**: Right-click on any host to:
   - Start/stop the application (runs in terminal)
   - Modify start commands
   - Remove from workspace

### Controlling Remotes
1. **Start/Stop**: Right-click on any remote for quick actions
2. **Configure**: Set custom build and start commands
3. **Monitor**: Visual status indicators show running state
4. **Navigate**: Click on exposed modules to view source code

### Terminal Integration
All operations execute in VS Code's integrated terminal, giving you:
- Full visibility of command output
- Ability to interact with running processes
- Standard terminal features (scrollback, search, etc.)
- Multiple terminal sessions for concurrent operations

## 🎮 Available Commands

Access these via Command Palette (`Ctrl/Cmd + Shift + P`):

| Command | Description |
|---------|-------------|
| `Module Federation: Refresh` | Refresh the explorer view |
| `Module Federation: Add New Host Folder` | Add a new host application |
| `Module Federation: Remove Host Folder` | Remove a host from workspace |
| `Module Federation: Change Configuration File` | Update configuration settings |
| `Module Federation: Start Host App` | Start the host application |
| `Module Federation: Stop Host App` | Stop the host application |
| `Module Federation: Configure Root App` | Configure host settings |
| `Module Federation: Show Dependency Graph` | Visualize architecture |
| `Module Federation: Start Remote` | Start a remote application |
| `Module Federation: Stop Remote` | Stop a remote application |
| `Module Federation: Show Welcome` | Display welcome guide |
| `Module Federation: Open View` | Open the explorer view |
| `Module Federation: Focus View` | Focus on the explorer |

## 🔧 Supported Configurations

The extension automatically detects and works with:

- **Webpack**: `webpack.config.js`, `webpack.config.ts`
- **Vite**: `vite.config.js`, `vite.config.ts`
- **ModernJS**: `module-federation.config.js`, `module-federation.config.ts`

Both JavaScript and TypeScript configuration files are supported.

## 💡 Tips for Local Development

- **Multiple Terminals**: The extension creates separate terminal sessions for each application
- **Port Management**: Ensure your hosts and remotes use different ports
- **Hot Reload**: Changes to configurations are automatically detected
- **Dependency Tracking**: Use the dependency graph to understand your architecture

## 🤝 Support the Project

If this extension improves your Module Federation development experience:

<a href="https://ko-fi.com/andrecrjr">
  <img src="https://cdn.prod.website-files.com/5c14e387dab576fe667689cf/670f5a01c01ea9191809398c_support_me_on_kofi_blue-p-500.png" alt="Support on Ko-fi" width="200"/>
</a>

## 🤝 Contributing

We welcome contributions! Please submit Pull Requests at:
[https://github.com/andrecrjr/module-federation-explorer](https://github.com/andrecrjr/module-federation-explorer)

## 📄 License

This extension is released under the MIT License.