# Module Federation Explorer - AI Agent Guidelines

This file provides context, rules, and architecture guidelines for AI coding agents working on this VS Code extension.

## 🎯 Project Overview
- **Role:** A VS Code extension to explore module federation sub-projects, inspect their dependencies, and manage host/remote terminals.
- **Tech Stack:** TypeScript, VS Code Extension API, Rspack (bundler), D3.js (graph visualization), Estraverse (AST parsing).

## 📂 Project Structure (`src/`)
Focus code changes or debugging based on these core responsibilities:
- `index.ts`: Main activation entry point and command registry.
- `unifiedTreeProvider.ts`: Builds the data and UI for the VS Code tree view explorer.
- `dependencyGraph.ts`: Renders the D3.js module dependency graph within a VS Code webview.
- `rootConfigManager.ts`: Handles reading/writing the user's workspace configurations.
- `configExtractors.ts`: Logic to parse out Module Federation remotes/exposes from configuration files (Webpack, Vite, ModernJS).
- `dialogUtils.ts`: Handles UI prompts and VS Code input dialogs.
- `types.ts`: Centralizes TypeScript types and interfaces.

## 🛠️ Development Workflow
- **Compile:** `npm run compile` (Powered by Rspack)
- **Watch:** `npm run watch` (Continuous compilation during development)
- **Lint:** `npm run lint` (ESLint)
- **Test:** `npm run test`
- **Package:** `npm run package` (Production Rspack bundle)

## ✍️ Coding Standards
1. **TypeScript Conventions:** Write strict TypeScript. Enforce types across the VS Code API boundaries and avoid using `any`.
2. **VS Code Native UI:** Use native VS Code API (`TreeDataProvider`, `WebviewPanel`, `window.showQuickPick`) wherever possible. Keep the extension visually consistent with VS Code.
3. **AST & Parsing Safety:** When editing `configExtractors.ts` and using `estraverse`, be mindful of performance and safely handle unparseable or edge-case configuration files.
4. **Graph Efficiency:** Updates in `dependencyGraph.ts` should ensure that the D3 graph performs well even with highly interconnected enterprise architectures.
5. **Concise Logic:** Keep code concise. Don't add unnecessary third-party NPM packages, to maintain a fast extension activation time.

## 🚀 Commits & Releases
- Always use **Conventional Commits** (e.g., `feat:`, `fix:`, `chore:`). The GitHub Actions CI/CD leverages `semantic-release` to automate versioning and VS Code marketplace publishing based on these prefixes.
