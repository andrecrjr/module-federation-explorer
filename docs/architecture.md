# Architecture Overview

This document outlines the core components and architectural patterns used in the Module Federation Explorer.

## Core Components

### 1. Application composition (`src/app/`)
The activation layer wires ports, feature workflows, and infrastructure adapters:
- `compositionRoot.ts` creates the concrete Node and VS Code services.
- `explorerApplication.ts` coordinates application workflows.
- `registerCommands.ts`, `registerWatchers.ts`, and `lifecycle.ts` own extension wiring.

The explorer tree implementation lives in `src/features/explorer/` and only renders the
application snapshot through the VS Code `TreeDataProvider` API.

### 2. Federation discovery (`src/federation/`, `src/parser/`, and `src/extractors/`)
The parsing engine. It responsible for:
- Supporting multiple bundlers: Webpack, Vite, RSBuild, and Modern.js.
- AST Analysis: Uses Babel to find and extract Module Federation configuration objects without actually executing the configuration files.

### 3. `Dependency Graph` (`src/features/graph/`)
The visualization engine for the graph view:
- **Model**: Converts the tree-like configuration into a flat graph of nodes and links.
- **Webview**: Manages the lifecycle of the graph webview.
- **D3.js**: Orchestrates the force-directed layout and interactive elements (zoom, pan, drag).

### 4. VS Code infrastructure (`src/infrastructure/vscode/`)
A service layer for UI interactions:
- Provides consistent wrappers for folder pickers, confirmation dialogs, and setup guides.
- Handles command configuration prompts for users.

### 5. Root configuration (`src/features/roots/`)
Simplifies the management of the `.vscode/mf-explorer.roots.json` file, ensuring persistence of user settings.

## Data Models

Federation and root models remain in `src/types.ts`; graph models are owned by
`src/features/graph/types.ts`:
- `ModuleFederationConfig`: Unified representation of a project's MFE config.
- `Remote`: Represents an external connection.
- `RootFolder`: Represents a user-added entry point to the explorer.

## Patterns

- **Provider Pattern**: Used heavily for updating the UI when the underlying data changes (`onDidChangeTreeData`).
- **Command Registration**: Composed by `src/index.ts` and registered through `src/app/` and feature command modules.
- **AST Parsing over Execution**: Prefers static analysis of config files to avoid the risks and complexity of running arbitrary local JS/TS files.

## Dependency direction

Core parsing and graph generation do not import VS Code. Feature workflows depend on
application ports and core models. Node and VS Code adapters implement those ports, and
`src/app/compositionRoot.ts` is the only composition boundary.
