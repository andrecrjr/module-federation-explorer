# Module Federation Explorer - AI Agent Guidelines

This file provides context, rules, and architecture guidelines for AI coding agents working on this VS Code extension.

## 🎯 Project Overview
- **Role:** A VS Code extension to explore module federation sub-projects, inspect their dependencies, and manage host/remote terminals.
- **Tech Stack:** TypeScript, VS Code Extension API, Rspack (bundler), D3.js (graph visualization), Estraverse (AST parsing).

## 📂 Project Structure (`src/`)
Focus code changes or debugging based on these core responsibilities:
- `index.ts`: Thin activation entry point.
- `app/compositionRoot.ts`: Wires application ports, feature workflows, and infrastructure adapters.
- `features/explorer/`: Builds the data and UI for the VS Code tree view explorer.
- `features/graph/`: Generates and renders the D3.js module dependency graph in a VS Code webview.
- `features/roots/`: Handles root configuration workflows and persistence.
- `parser/` and `extractors/`: Parse Module Federation configuration for supported bundlers.
- `infrastructure/vscode/`: Handles dialogs, output, terminals, and other VS Code APIs.
- `infrastructure/node/`: Handles filesystem, path, and package-manager adapters.
- `types.ts`: Federation and root domain models; feature-specific models live beside their owners.

## 🛠️ Development Workflow
- **Compile:** `npm run compile` (Powered by Rspack)
- **Watch:** `npm run watch` (Continuous compilation during development)
- **Lint:** `npm run lint` (ESLint)
- **Test:** `npm run test`
- **Package:** `npm run package` (Production Rspack bundle)

## ✍️ Coding Standards
1. **TypeScript Conventions:** Write strict TypeScript. Enforce types across the VS Code API boundaries and avoid using `any`.
2. **VS Code Native UI:** Use native VS Code API (`TreeDataProvider`, `WebviewPanel`, `window.showQuickPick`) wherever possible. Keep the extension visually consistent with VS Code.
3. **AST & Parsing Safety:** When editing `parser/` or `extractors/` and using `estraverse`, be mindful of performance and safely handle unparseable or edge-case configuration files.
4. **Graph Efficiency:** Updates in `features/graph/` should ensure that the D3 graph performs well even with highly interconnected enterprise architectures.
5. **Concise Logic:** Keep code concise. Don't add unnecessary third-party NPM packages, to maintain a fast extension activation time.

## 🚀 Commits & Releases
- Always use **Conventional Commits** (e.g., `feat:`, `fix:`, `chore:`). The GitHub Actions CI/CD leverages `semantic-release` to automate versioning and VS Code marketplace publishing based on these prefixes.
