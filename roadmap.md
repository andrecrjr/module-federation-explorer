# Roadmap & TODO List

This document tracks planned improvements, technical debt, and future features for the Module Federation Explorer.

## Critical Fixes (Pain Points)

- [x] **Make Webview Offline Ready**: Bundle `D3.js` inside the extension `media/` folder and update CSP. Loading from CDN will fail for offline users or those behind corporate proxies.
- [x] **Sync View IDs**: Fixed mismatched view ID references in `src/index.ts` (was 'moduleFederationExplorer', should be 'moduleFederation').
- [x] **Complete Activation Support**: Add `.ts` config files (`vite.config.ts`, etc.) to `activationEvents` in `package.json` to ensure the extension auto-activates in TypeScript projects.
- [x] **Rspack Performance**: Switch from `ts-loader` to build-in `builtin:swc-loader` in `rspack.config.js` to significantly speed up builds.
- [x] **Redundant Dependency Audit**: Moved bundled dependencies (`d3`, `estraverse`, etc.) to `devDependencies` to clarify the extension is standalone.
- [ ] **Robust Config Fallback**: Refactor `rootConfigManager.ts` to avoid fragile key-scanning that can cause false positives when configuration is corrupted.

## High Priority: Technical Debt & Refactors

- [ ] **Decompose `UnifiedModuleFederationProvider.ts`**: The file is currently ~2500 lines long.
    - [ ] Move Tree Item logic to a dedicated Factory/Provider.
    - [ ] Extract terminal management logic into a `TerminalManager` service.
    - [ ] Separate configuration persistence logic into a dedicated module.
- [ ] **Refactor `dependencyGraph.ts`**: The file is ~1700 lines long and contains complex graph generation logic and a large embedded webview.
    - [ ] Extract the `generateDependencyGraph` multi-pass logic into smaller, testable methods or a `GraphBuilder` class.
    - [ ] Move the massive Webview HTML/CSS/JS string to a separate template file or dedicated generator.
    - [ ] Improve the robustness of `findAppIdByName` to handle more edge cases in remote naming.
- [ ] **Modularize `src/index.ts`**: The main entry point is overgrown (~770 lines) and mixes numerous concerns.
    - [ ] Extract the massive inline HTML string `getWelcomePageHtml` into a dedicated template file (e.g., `src/webviews/welcome.ts`).
    - [ ] Extract inline command implementations (especially `startRemote` with its complex prompting logic) into dedicated modules (e.g., `src/commands/`).
    - [ ] Move file watchers and terminal lifecycle hooks into a separate `LifecycleManager` or `WatcherService`.
- [ ] **Improve Config Extraction**:
    - [ ] Add support for asynchronous configuration files (`export default async () => ...`).
    - [ ] Refactor `configExtractors.ts` into smaller, bundler-specific modules (Webpack, Vite, etc.).
- [ ] **Error Handling**:
    - [ ] Implement a more robust error reporting system to the user (instead of primarily logging to `outputChannel`).
    - [ ] Add explicit validation for user-provided start/build commands.

## Performance & Optimization

- [ ] **Lazy Loading configurations**: For large mono-repos, scan folders only when expanded in the tree view.
- [ ] **Cache Extraction Results**: Persist the AST extraction results to avoid re-parsing unchanged config files on every startup.
- [ ] **Debounce File Watchers**: Ensure multiple rapid file changes don't trigger simultaneous expensive re-scans.

## Feature Enhancements

- [ ] **Enhanced Dependency Graph**:
    - [ ] Add search/filter capabilities to the graph view.
    - [ ] Visualize "shared" dependencies between modules.
    - [ ] Add "Focus" mode to view only immediate up/downstream connections of a specific node.
- [ ] **Better Remote Management**:
    - [ ] Automatically detect port conflicts when starting multiple remotes.
    - [ ] Provide "Restart" button for running terminals.
- [ ] **Manifest Support**: Support `manifest.json` based discovery for Module Federation 2.0.

## Testing & Quality

- [ ] **Unit Tests**:
    - [ ] Add tests for `configExtractors` using various config file samples.
    - [ ] Test the `rootConfigManager` persistence logic.
- [ ] **E2E Tests**: Implement Playwright/VS Code extension tests for core user journeys (Add root -> see remotes -> start remote).
