# Roadmap & TODO List

This document tracks planned improvements, technical debt, and future features for the Module Federation Explorer.

## High Priority: Technical Debt & Refactors

- [ ] **Decompose `UnifiedModuleFederationProvider.ts`**: The file is currently ~2500 lines long.
    - [ ] Move Tree Item logic to a dedicated Factory/Provider.
    - [ ] Extract terminal management logic into a `TerminalManager` service.
    - [ ] Separate configuration persistence logic into a dedicated module.
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
