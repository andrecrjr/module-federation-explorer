# Architecture Overview

This document outlines the core components and architectural patterns used in the Module Federation Explorer.

## Core Components

### 1. `UnifiedModuleFederationProvider` (`src/unifiedTreeProvider.ts`)
The central orchestrator of the extension. It manages:
- **State**: Keeps track of loaded configurations and running terminals.
- **Tree Data**: Implements the VS Code Tree View API.
- **Configuration Logic**: Handles loading and saving root folders.
- **App Lifecycle**: Orchestrates starting and stopping applications in terminals.

### 2. `Config Extractors` (`src/configExtractors.ts`)
The parsing engine. It responsible for:
- Supporting multiple bundlers: Webpack, Vite, RSBuild, and Modern.js.
- AST Analysis: Uses Babel to find and extract Module Federation configuration objects without actually executing the configuration files.

### 3. `Dependency Graph` (`src/dependencyGraph.ts`)
The visualization engine for the graph view:
- **Model**: Converts the tree-like configuration into a flat graph of nodes and links.
- **Webview**: Manages the lifecycle of the graph webview.
- **D3.js**: Orchestrates the force-directed layout and interactive elements (zoom, pan, drag).

### 4. `Dialog Utils` (`src/dialogUtils.ts`)
A service layer for UI interactions:
- Provides consistent wrappers for folder pickers, confirmation dialogs, and setup guides.
- Handles command configuration prompts for users.

### 5. `Root Configuration Manager` (`src/rootConfigManager.ts`)
Simplifies the management of the `.vscode/mf-explorer.roots.json` file, ensuring persistence of user settings.

## Data Models

Located in `src/types.ts`:
- `ModuleFederationConfig`: Unified representation of a project's MFE config.
- `Remote`: Represents an external connection.
- `RootFolder`: Represents a user-added entry point to the explorer.

## Patterns

- **Provider Pattern**: Used heavily for updating the UI when the underlying data changes (`onDidChangeTreeData`).
- **Command Registration**: Centralized in `src/index.ts` to map UI actions to provider methods.
- **AST Parsing over Execution**: Prefers static analysis of config files to avoid the risks and complexity of running arbitrary local JS/TS files.
