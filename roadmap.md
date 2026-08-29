# Roadmap

Product ideas and remaining technical work for Module Federation Explorer. Current architecture and ownership live in [`docs/architecture.md`](docs/architecture.md).

## Completed foundation

- [x] Bundle D3 locally for offline-first graph loading, with CDN fallbacks.
- [x] Keep activation and composition in `src/app/compositionRoot.ts`.
- [x] Support JavaScript and TypeScript config files for all registered bundlers.
- [x] Use one discovery registry for Webpack, Rspack, Vite, Rsbuild, and Modern.js.
- [x] Split tree, root, remote, graph, parser, extractor, and infrastructure responsibilities into focused modules.
- [x] Use typed ports for application workflows and keep `GraphGenerator` pure.
- [x] Track host/remote terminal lifecycle and dispose activation resources.
- [x] Cover parser, discovery, workflows, tree, graph, webview boundaries, manual flows, and desktop UI flows with tests.

## Technical priorities

- [ ] Harden malformed or partially migrated root configuration handling, including clearer recovery guidance.
- [x] Move onboarding into `src/features/onboarding/`; separate controller, message validation, and HTML template.
- [x] Move rating/feedback behavior into `src/features/feedback/`.
- [x] Split shared models into domain and presentation models without adding a catch-all shared types module.
- [x] Add automated dependency-direction checks for low-level, feature, and adapter imports.
- [x] Organize tests under explicit unit, integration, and UI areas while preserving fast extension-host feedback.
- [ ] Add support for asynchronous config functions and additional safe static-expression shapes.
- [ ] Add manifest-based discovery for Module Federation 2.0 projects.

## Graph improvements

- [ ] Add search and filter controls to the graph webview.
- [ ] Add focus mode for immediate upstream/downstream connections.
- [ ] Improve graph diagnostics presentation inside VS Code.
- [ ] Evaluate lazy or incremental loading for large multi-root workspaces.

## Runtime and workflow improvements

- [ ] Detect port conflicts before starting host or remote processes.
- [ ] Add restart actions for running hosts and remotes.
- [ ] Improve command validation and project-specific command suggestions.
- [ ] Add clearer recovery actions for missing remote folders and invalid configuration files.

## Quality bar

New behavior should include focused tests and documentation updates. Before merge, run:

```bash
npm run typecheck
npm run lint
npm run compile
npm run test:headless
```

Run coverage, manual-flow, and headless UI suites when affected. Use Conventional Commits so semantic-release can classify changes.
