# Module Federation Explorer Refactor TODO

## Goal

Move the extension toward a feature-first architecture with a thin VS Code composition layer, while preserving current behavior and keeping the core federation and graph logic testable without VS Code.

## Phase 1: Establish boundaries

- [ ] Add `src/app/compositionRoot.ts` to create and wire the extension services.
- [ ] Keep `src/extension.ts` (or `src/index.ts`) limited to activation and composition.
- [ ] Extract command registration into `src/app/registerCommands.ts` and feature-specific command modules.
- [ ] Extract file watcher registration into `src/app/registerWatchers.ts`.
- [ ] Keep lifecycle setup in `src/app/lifecycle.ts`.
- [ ] Define small ports/interfaces for dialogs, logging, filesystem access, terminals, and workspace file discovery.
- [ ] Replace the broad `providerDependencies.ts` dependency bag with feature-specific dependency interfaces.

## Phase 2: Refactor the Explorer tree

- [ ] Move `unifiedTreeProvider.ts`, `treeModel.ts`, and `treeItemFactory.ts` into `src/features/explorer/`.
- [ ] Create an `ExplorerStore` or `ExplorerState` that owns the loaded configuration snapshot.
- [ ] Make `UnifiedModuleFederationProvider` only implement `TreeDataProvider` and drag/drop behavior.
- [ ] Remove application workflows and persistence responsibilities from the tree provider.
- [ ] Move root, remote, graph, and terminal command handlers out of the provider facade.
- [ ] Preserve and extend the existing tree model and tree item tests.

## Phase 3: Unify federation discovery and parsing

- [ ] Merge the duplicated discovery logic in `workspaceScanner.ts` and `ConfigurationService`.
- [ ] Create one shared config-file definition registry for Webpack, Vite, Modern.js, RSBuild, and Rspack.
- [ ] Split `configExtractors.ts` into:
  - [ ] `parser/parseConfigFile.ts`
  - [ ] `parser/astUtils.ts`
  - [ ] `parser/expressionResolver.ts`
  - [ ] `extractors/webpack.ts`
  - [ ] `extractors/vite.ts`
  - [ ] `extractors/modernjs.ts`
  - [ ] `extractors/rsbuild.ts`
- [ ] Keep parser and extractor modules free of VS Code UI calls.
- [ ] Replace parser `any` usage with typed AST nodes or `unknown` plus type guards.
- [ ] Return structured parse diagnostics instead of logging from low-level parsing code.
- [ ] Add fixtures and unit tests for each supported bundler configuration shape.

## Phase 4: Separate root and remote configuration

- [ ] Split `rootConfigManager.ts` into:
  - [ ] pure schema validation and legacy migration
  - [ ] JSON file repository
  - [ ] user-facing configuration workflow
- [ ] Move root configuration code into `src/features/roots/`.
- [ ] Move `rootAppController.ts` into a root-app workflow module.
- [ ] Move `remoteConfigurationService.ts` and `remoteWorkflow.ts` into `src/features/remotes/`.
- [ ] Keep persisted remote settings separate from discovered federation configuration.
- [ ] Replace provider-owned mutable `Map` access with an explicit snapshot/hydration step.
- [ ] Ensure path matching uses normalized paths and does not rely on unsafe string-prefix matching.
- [ ] Add tests for multiple roots, duplicate remote names, missing folders, and external remotes.

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
- [ ] Add integration tests for activation, command registration, watchers, and webview message boundaries.
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

- [ ] Activation file is small and only composes the extension.
- [ ] No feature workflow is implemented inside the tree provider.
- [ ] Configuration discovery has one pipeline and one source of supported file patterns.
- [ ] Core graph/parsing logic can be tested without launching VS Code.
- [ ] Persisted configuration and runtime/discovered state are separate models.
- [ ] `npm run typecheck`, `npm run lint`, `npm run compile`, and `npm test` pass.
