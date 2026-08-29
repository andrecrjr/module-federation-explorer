# Architecture refactor status

This document records completed refactor work and remaining architectural follow-ups. [`docs/architecture.md`](docs/architecture.md) is the source of truth for the current layout; target designs below are not current source layout unless marked complete.

## Goal

Move the extension toward feature-first architecture with a thin VS Code composition layer, while preserving behavior and keeping federation and graph logic testable without VS Code.

## Completed phases

### Phase 1: Establish boundaries

- [x] Add `src/app/compositionRoot.ts` for service creation and wiring.
- [x] Keep `src/index.ts` limited to the extension entry-point re-export.
- [x] Extract command registration into `src/app/registerCommands.ts` and feature command modules.
- [x] Extract file watcher registration into `src/app/registerWatchers.ts`.
- [x] Keep lifecycle setup in `src/app/lifecycle.ts`.
- [x] Define ports for dialogs, logging, filesystem access, terminals, storage, and discovery.
- [x] Replace the broad provider dependency bag with feature-specific dependency interfaces.

### Phase 2: Refactor the explorer tree

- [x] Move tree code into `src/features/explorer/`.
- [x] Add `ExplorerStore` for loaded configuration and presentation state.
- [x] Keep `UnifiedModuleFederationProvider` focused on tree rendering and drag/drop.
- [x] Remove workflow and persistence ownership from the provider.
- [x] Move root, remote, graph, and terminal command handling behind the application façade.
- [x] Preserve tree model, factory, and provider tests.

### Phase 3: Unify federation discovery and parsing

- [x] Use one registry/discovery pipeline for normal loading and onboarding.
- [x] Support Webpack, Vite, Modern.js, Rsbuild, and Rspack through one registry.
- [x] Split parser utilities and bundler extractors into focused modules.
- [x] Keep parser and extractor modules free of VS Code UI calls.
- [x] Replace parser `any` usage with typed AST nodes, `unknown`, and type guards.
- [x] Return structured parse diagnostics.
- [x] Add fixtures and tests for supported bundler shapes and dynamic values.

### Phase 4: Separate root and remote configuration

- [x] Split root schema validation/migration, JSON persistence, and user workflow.
- [x] Move root code into `src/features/roots/`.
- [x] Move host workflow into `rootAppWorkflow.ts`.
- [x] Move remote persistence and UI workflow into `src/features/remotes/`.
- [x] Keep persisted settings separate from freshly discovered federation data.
- [x] Hydrate cloned snapshots instead of treating persisted settings as source config.
- [x] Normalize path matching and avoid unsafe string-prefix matching.
- [x] Cover multiple roots, duplicate names, missing folders, malformed config, and external remotes.

### Phase 5: Isolate runtime and VS Code infrastructure

- [x] Move dialogs, output, and VS Code terminal implementation under `src/infrastructure/vscode/`.
- [x] Move Node filesystem/path/package-manager helpers under `src/infrastructure/node/`.
- [x] Make application workflows consume ports instead of direct Node/VS Code globals.
- [x] Keep terminal lifecycle cleanup and running state in `TerminalManager`.
- [x] Register watchers, panels, timers, commands, and listeners with extension disposal ownership.

### Phase 6: Isolate graph and webview features

- [x] Move graph code into `src/features/graph/`.
- [x] Keep `GraphGenerator` pure: config snapshot in, graph plus diagnostics out.
- [x] Move graph-specific types beside the graph feature.
- [x] Separate graph generation, webview coordination, templates, and message handling.
- [x] Validate webview messages at the boundary.
- [x] Preserve tests for directionality, exact remote matching, duplicate names, self-references, and shared dependencies.

## Remaining work

### Phase 7: Onboarding and feedback

- [ ] Move onboarding into `src/features/onboarding/`.
- [ ] Split onboarding controller/message handling from its HTML template.
- [x] Reuse the unified federation discovery pipeline for onboarding detection.
- [ ] Move rating and marketplace behavior into `src/features/feedback/`.
- [ ] Keep webview handlers declarative; route all business-state changes through application workflows.

### Phase 8: Models, tests, and documentation

- [ ] Split `src/types.ts` into federation, roots, and explorer presentation models without creating a catch-all shared types folder.
- [ ] Mirror production areas under explicit `src/test/unit/` and `src/test/integration/` trees.
- [x] Add integration coverage for activation, command registration, watchers, manual flows, and webview boundaries.
- [x] Update architecture, README, agent, and backlog documentation for the current layout.
- [x] Document dependency direction and import ownership rules.
- [ ] Add automated dependency-direction enforcement beyond current boundary tests.

## Current source layout

```text
src/
├── index.ts
├── app/                 composition, application façade, ports, commands, lifecycle
├── federation/         supported file registry and discovery
├── parser/              AST parsing and expression handling
├── extractors/          Webpack, Vite, Modern.js, Rsbuild extraction
├── features/
│   ├── explorer/        store and tree UI
│   ├── roots/           root settings and host workflow
│   ├── remotes/         remote settings and workflow
│   └── graph/           graph generation and webview
├── infrastructure/
│   ├── node/            filesystem, paths, package manager, JSON repository
│   └── vscode/          dialogs, output, terminals
├── types.ts             federation and root models
├── configurationService.ts
├── workspaceScanner.ts  onboarding adapter over shared discovery
├── onboarding.ts        transitional onboarding webview
└── ratingPrompt.ts      transitional feedback state
```

## Definition of done

- Activation remains a composition boundary, not a workflow implementation.
- Tree provider remains a rendering/drag-drop adapter.
- Supported config patterns have one registry and one discovery pipeline.
- Parser, extractors, graph generation, schema validation, and path rules stay testable without VS Code.
- Persisted settings, discovered state, UI snapshot state, and terminal state remain separate.
- New commands and webview messages are typed and validated at their boundaries.
- `npm run typecheck`, `npm run lint`, `npm run compile`, and `npm run test:headless` pass for source changes.
- Documentation matches source behavior and links to the relevant tests.
