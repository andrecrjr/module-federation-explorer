# Module Federation Explorer — Agent Guide

This guide keeps coding agents aligned with the current architecture. Read it before changing source files.

## Read first

1. [`docs/architecture.md`](docs/architecture.md) for runtime flow, ownership, and dependency direction.
2. [`README.md`](README.md) for user-visible behavior, supported configuration files, and development commands.
3. The relevant tests beside the code being changed.

Repository shell instructions live in `/home/andrecrjr/.codex/RTK.md` in this environment. Prefix shell commands with `rtk`.

## Project role

Module Federation Explorer is a VS Code extension for local development. It statically reads supported federation configuration files, builds a normalized in-memory snapshot, renders that snapshot in a tree and graph, and starts host/remote commands in integrated terminals.

Core constraints:

- TypeScript is strict; use explicit types, `unknown`, and type guards. Avoid `any`.
- Configuration files are parsed as source. Never execute arbitrary workspace configuration code.
- Keep application workflows testable without VS Code by depending on ports from `src/app/ports.ts`.
- Keep VS Code and Node APIs inside composition, adapters, and UI-boundary modules.
- Prefer existing dependencies and patterns. Do not add a package for small utility logic.
- Every command, watcher, webview panel/listener, timer, and terminal lifecycle listener must have clear `ExtensionContext.subscriptions` ownership.

## Current architecture

```text
src/index.ts
  └─ src/app/compositionRoot.ts
       ├─ ExplorerApplication          application workflows and orchestration
       ├─ ExplorerStore                loaded snapshot and UI state
       ├─ UnifiedModuleFederationProvider  VS Code tree + drag/drop adapter
       ├─ command registration          explorer / roots / remotes / graph
       ├─ file watchers and lifecycle   reload + terminal cleanup + onboarding
       └─ Node and VS Code adapters     ports, persistence, dialogs, terminals

ExplorerApplication
  ├─ ConfigurationService
  │    └─ FederationDiscoveryService → parser → bundler extractor
  ├─ RemoteConfigurationService        persisted remote overrides + hydration
  ├─ RootAppController                 root persistence + host terminal workflow
  ├─ RemoteWorkflow                    remote editing + external remote workflow
  ├─ DependencyGraphManager            graph panel coordinator
  │    └─ GraphGenerator                pure six-pass graph generation
  └─ ExplorerStore → tree provider and graph commands
```

### Ownership map

| Area | Source of truth | Responsibility |
| --- | --- | --- |
| Activation/composition | `src/index.ts`, `src/app/compositionRoot.ts` | Build concrete services, register VS Code resources, start initialization |
| Application coordination | `src/app/explorerApplication.ts` | Coordinate loading, hydration, refresh, root/remote/graph actions |
| Ports | `src/app/ports.ts` | Define UI, filesystem, path, terminal, storage, and host boundaries |
| Discovery | `src/federation/configFileRegistry.ts`, `src/configurationService.ts` | Find supported files, de-duplicate matches, parse, enrich, group by root |
| Parsing | `src/parser/`, `src/extractors/` | Parse AST and extract normalized federation values |
| Root settings | `src/features/roots/` plus `src/infrastructure/node/rootConfigRepository.ts` | Validate/migrate JSON, persist roots and host settings, run host workflow |
| Remote settings | `src/features/remotes/` | Hydrate saved remote overrides and manage remote/external-remote actions |
| Explorer UI | `src/features/explorer/` | Own store, tree model, tree items, provider, and explorer commands |
| Dependency graph | `src/features/graph/` | Generate graph, render D3 webview, validate webview messages |
| Node adapters | `src/infrastructure/node/` | Filesystem path resolution, package-manager detection, JSON repository |
| VS Code adapters | `src/infrastructure/vscode/` | Dialogs, output channel, terminal implementation |
| Supporting UI | `src/features/onboarding/`, `src/app/welcome.ts`, `src/features/feedback/` | Onboarding, welcome panel, feedback/rating state |

## Runtime rules

### Activation and loading

`src/index.ts` only re-exports `activate` from `compositionRoot.ts`. Activation creates the application and provider, registers the tree view, commands, watchers, terminal lifecycle, onboarding timer, and rating state, then starts `application.initialize()`.

When roots exist, `ExplorerApplication.loadConfigurations()` runs this pipeline:

```text
root config JSON
  → configured root paths
  → registry file discovery (excluding node_modules)
  → AST parse + bundler extractor
  → remote package-manager enrichment
  → ExplorerStore discovered snapshot
  → persisted remote/external settings hydration
  → root-folder presentation state
  → open graph refresh
```

Loading is guarded by `ExplorerStore.isLoading`. A reload requested during a load is queued and runs after the current load finishes. Watcher reloads are debounced by 500 ms.

### State separation

Keep these states distinct:

- `UnifiedRootConfig`: persisted JSON roots, host commands, remote overrides, and external remotes.
- `Map<string, ModuleFederationConfig[]>`: fresh discovered federation data held by `ExplorerStore`.
- `ExplorerSnapshot`: read-only view of loaded configs, root folders, and loading state.
- `TerminalManager`: transient running host/remote terminal state; not persisted.
- `DependencyGraph`: derived from the current config map; not a persistence model.

`RemoteConfigurationService.hydrateRemoteConfigurations()` clones discovered configs before applying saved settings. Preserve this boundary when adding persisted fields.

### Configuration parsing

The registry is the single list of supported file patterns and config types:

- Webpack: `webpack.config.{js,ts}`.
- Rspack: `rspack.config.{js,ts}`, using the Webpack extractor with `configType: 'rspack'`.
- Vite: `vite.config.{js,ts}`.
- Rsbuild: `rsbuild.config.{js,ts}`.
- Modern.js: `module-federation.config.{js,ts}` and `modern.config.{js,ts}`.

`parseConfigFile.ts` uses `@typescript-eslint/parser`. `astUtils.ts`, `expressionResolver.ts`, and `extractors/configObject.ts` resolve supported AST shapes without running config files. Dynamic strings remain placeholders. Extractors return `detected: false` when a candidate file does not contain a recognized federation shape.

Parse failures become `ConfigParseError` diagnostics. Discovery collects errors per file so one invalid file does not discard successful configurations from other roots.

### Tree and graph behavior

`ExplorerStore` publishes changes. `UnifiedModuleFederationProvider` subscribes and only translates state into VS Code tree items or drag/drop operations. Tree data is built by `treeModel.ts`; visual labels, commands, tooltips, and context values are built by `treeItemFactory.ts`.

`GraphGenerator` is pure. Its six passes analyze app capabilities, map remote consumption, create app nodes, add consumption edges, add exposed-module nodes, and add shared-dependency nodes. It uses exact/case-insensitive remote-name matching; ambiguous names and self-references become diagnostics. Shared nodes are emitted only when a dependency appears in more than one app.

`DependencyGraphManager` owns the VS Code webview panel. `webview/handlers.ts` validates incoming messages before opening configs or showing details. `webview/template.ts` serializes graph data and renders D3 using bundled `media/d3.min.js` with CDN fallbacks.

## Safe change recipes

### Add or change supported bundler syntax

1. Update the extractor in `src/extractors/`.
2. Update `CONFIG_FILE_DEFINITIONS` in `src/federation/configFileRegistry.ts` if file patterns or config type change.
3. Update activation events in `package.json` and `CONFIG_WATCH_PATTERN` in `src/app/registerWatchers.ts` for new filenames.
4. Add a focused fixture/test in `src/test/unit/federation/federationPipeline.test.ts` or a nearby parser test.
5. Update the support table and static-analysis notes in `README.md` and this guide if user behavior changed.

Do not create a second discovery path. `src/features/onboarding/workspaceScanner.ts` is an onboarding adapter over the shared registry/discovery service.

### Add or change a command

1. Add the command ID to `COMMAND_IDS` in `src/app/registerCommands.ts`.
2. Register it in the owning feature command module.
3. Add or update its `contributes.commands` and menu/context conditions in `package.json` when user-visible.
4. Guard tree arguments with the relevant predicate from `treeItemFactory.ts`.
5. Delegate to `ExplorerApplication` or a feature workflow, not directly to the tree provider.
6. Update command registration tests and README command documentation.

### Change root or remote persistence

Update the owning model in `src/features/roots/types.ts` or `src/federation/types.ts`, validation/migration in `rootConfigSchema.ts`, repository behavior if needed, and the owning workflow/service. Use `normalizePath()` and `findContainingRoot()` for path association. Add tests for multiple roots, duplicate names, missing folders, malformed JSON, and external remotes where relevant.

### Change graph behavior

Put graph derivation in `GraphGenerator`, not the webview manager. Keep graph-specific types in `src/features/graph/types.ts`. If a webview message changes, update the union/type guard in `webview/handlers.ts` and its boundary/security tests. Preserve diagnostics for missing names, self-references, and ambiguous app names.

### Change terminal behavior

Keep runtime bookkeeping in `TerminalManager`. Root apps use one terminal; remotes use build and preview/start terminals. Update close handling and disposed-terminal cleanup together. Register new listeners/timers in the activation context and cover behavior with `terminalManager.test.ts` or lifecycle tests.

## Validation

For source changes, run:

```bash
npm ci                 # first setup or lockfile changes
npm run typecheck
npm run lint
npm run compile
npm run test:headless
```

Run additional suites when affected:

```bash
npm run test:coverage       # coverage thresholds and baseline
npm run test:manual         # manual-flow integration
npm run test:ui:headless    # configured and onboarding desktop flows
```

UI tests use VS Code Extension Tester and target VS Code 1.135.0 in their test configuration. They need a display; use the headless wrapper on Linux. CI uses Node.js 24, pins Ubuntu 24.04, runs Xvfb, and temporarily relaxes AppArmor's unprivileged-user-namespace restriction so ExTester's `openResources()` second-instance CLI call can open fixture workspaces. The UI helper also waits for the workbench to settle before opening a fixture because VS Code startup is slower and race-prone under CI.

For documentation-only changes, at minimum run `git diff --check` and verify relative links. Do not modify generated `dist/`, `out/`, coverage, test resources, or `.vsix` artifacts.

## Documentation and commits

Keep user behavior in `README.md`, architecture and ownership in `docs/architecture.md`, agent rules here, and active work in `roadmap.md`. Update docs when file locations, supported config types, commands, scripts, or persistence shape changes.

Use Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, or `chore:`. Keep commits focused and do not mix generated artifacts with source or documentation changes.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **module-federation-explorer** (2242 symbols, 5915 relationships, 168 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact analysis before editing.** Use `impact({target: "symbolName", direction: "upstream"})` (MCP) or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .` (CLI fallback); report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "master"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "master" --repo .`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/module-federation-explorer/context` | Codebase overview, check index freshness |
| `gitnexus://repo/module-federation-explorer/clusters` | All functional areas |
| `gitnexus://repo/module-federation-explorer/processes` | All execution flows |
| `gitnexus://repo/module-federation-explorer/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
