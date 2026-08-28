# Module Federation Explorer Refactor TODO

## Goal

Move the extension toward a feature-first architecture with a thin VS Code composition layer, while preserving current behavior and keeping the core federation and graph logic testable without VS Code.

## Phase 1: Establish boundaries

- [x] Add `src/app/compositionRoot.ts` to create and wire the extension services.
- [x] Keep `src/extension.ts` (or `src/index.ts`) limited to activation and composition.
- [x] Extract command registration into `src/app/registerCommands.ts` and feature-specific command modules.
- [x] Extract file watcher registration into `src/app/registerWatchers.ts`.
- [x] Keep lifecycle setup in `src/app/lifecycle.ts`.
- [x] Define small ports/interfaces for dialogs, logging, filesystem access, terminals, and workspace file discovery.
- [x] Replace the broad `providerDependencies.ts` dependency bag with feature-specific dependency interfaces.

## Phase 2: Refactor the Explorer tree

- [x] Move `unifiedTreeProvider.ts`, `treeModel.ts`, and `treeItemFactory.ts` into `src/features/explorer/`.
- [x] Create an `ExplorerStore` or `ExplorerState` that owns the loaded configuration snapshot.
- [x] Make `UnifiedModuleFederationProvider` only implement `TreeDataProvider` and drag/drop behavior.
- [x] Remove application workflows and persistence responsibilities from the tree provider.
- [x] Move root, remote, graph, and terminal command handlers out of the provider facade.
- [x] Preserve and extend the existing tree model and tree item tests.

## Phase 3: Unify federation discovery and parsing

- [x] Merge the duplicated discovery logic in `workspaceScanner.ts` and `ConfigurationService`.
- [x] Create one shared config-file definition registry for Webpack, Vite, Modern.js, RSBuild, and Rspack.
- [x] Split `configExtractors.ts` into:
  - [x] `parser/parseConfigFile.ts`
  - [x] `parser/astUtils.ts`
  - [x] `parser/expressionResolver.ts`
  - [x] `extractors/webpack.ts`
  - [x] `extractors/vite.ts`
  - [x] `extractors/modernjs.ts`
  - [x] `extractors/rsbuild.ts`
- [x] Keep parser and extractor modules free of VS Code UI calls.
- [x] Replace parser `any` usage with typed AST nodes or `unknown` plus type guards.
- [x] Return structured parse diagnostics instead of logging from low-level parsing code.
- [x] Add fixtures and unit tests for each supported bundler configuration shape.

## Phase 4: Separate root and remote configuration

- [x] Split `rootConfigManager.ts` into:
  - [x] pure schema validation and legacy migration
  - [x] JSON file repository
  - [x] user-facing configuration workflow
- [x] Move root configuration code into `src/features/roots/`.
- [x] Move `rootAppController.ts` into a root-app workflow module.
- [x] Move `remoteConfigurationService.ts` and `remoteWorkflow.ts` into `src/features/remotes/`.
- [x] Keep persisted remote settings separate from discovered federation configuration.
- [x] Replace provider-owned mutable `Map` access with an explicit snapshot/hydration step.
- [x] Ensure path matching uses normalized paths and does not rely on unsafe string-prefix matching.
- [x] Add tests for multiple roots, duplicate remote names, missing folders, and external remotes.

## Phase 5: Isolate runtime and VS Code infrastructure

- [ ] Move `dialogUtils.ts`, `outputChannel.ts`, and the VS Code-specific parts of `terminalManager.ts` under `src/infrastructure/vscode/`.
- [ ] Move filesystem and Node-specific helpers such as `pathResolver.ts` and `packageManager.ts` under `src/infrastructure/node/`.
- [ ] Make application workflows depend on ports instead of importing `vscode`, `fs`, or global output channels directly.
- [ ] Keep terminal lifecycle cleanup and root/remote running state in one runtime service.
- [ ] Add disposable ownership rules so every watcher, panel, terminal listener, and command is registered with `ExtensionContext.subscriptions`.

## Phase 6: Isolate graph and webview features

- [ ] Move the graph implementation into `src/features/graph/`.
- [ ] Keep `GraphGenerator` pure: input configuration snapshot in, graph plus diagnostics out.
- [ ] Move graph-specific types out of the shared `types.ts` file.
- [ ] Keep the webview panel coordinator separate from the graph generation algorithm.
- [ ] Move webview templates and message handlers into `features/graph/webview/`.
- [ ] Validate and type all webview messages at the boundary.
- [ ] Preserve tests for directionality, exact remote matching, duplicate names, and shared dependencies.

## Phase 7: Onboarding and feedback

- [ ] Move onboarding into `src/features/onboarding/`.
- [ ] Split the onboarding controller/message handling from the HTML template.
- [ ] Reuse the unified federation discovery pipeline for onboarding.
- [ ] Move rating and marketplace behavior into `src/features/feedback/`.
- [ ] Avoid direct business-state mutation from webview message handlers; call application workflows instead.

## Phase 8: Models, tests, and documentation

- [ ] Split `types.ts` into federation, roots, graph, and explorer presentation models.
- [ ] Avoid a new catch-all `shared/types.ts`; place each type beside its owning feature.
- [ ] Mirror production folders under `src/test/unit/` and `src/test/integration/`.
- [x] Add integration tests for activation, command registration, watchers, and webview message boundaries.
- [ ] Update `docs/architecture.md` to describe the new boundaries and data flow.
- [ ] Add a dependency-direction check or documented import rule:
  - [ ] core logic does not import VS Code
  - [ ] features depend on core and ports
  - [ ] infrastructure implements ports
  - [ ] activation wires dependencies but contains no business logic

## Suggested target layout

```text
src/
├── extension.ts
├── app/
├── core/
│   ├── federation/
│   ├── graph/
│   └── roots/
├── features/
│   ├── explorer/
│   ├── roots/
│   ├── remotes/
│   ├── graph/
│   ├── onboarding/
│   └── feedback/
├── infrastructure/
│   ├── vscode/
│   └── node/
└── test/
```

## Definition of done

- [x] Activation file is small and only composes the extension.
- [x] No feature workflow is implemented inside the tree provider.
- [x] Configuration discovery has one pipeline and one source of supported file patterns.
- [x] Core graph/parsing logic can be tested without launching VS Code.
- [x] Persisted configuration and runtime/discovered state are separate models.
- [x] `npm run typecheck`, `npm run lint`, `npm run compile`, and `npm test` pass.
