# Module Federation Explorer for Visual Studio Code

<div style="display:flex;width:100%;justify-content:center">
<img src="./media/mfe-explorer-logo-big.png" alt="Module Federation Explorer Logo" width="450"/>
</div>

Module Federation Explorer is a Visual Studio Code extension for local development. It discovers Module Federation configurations, presents hosts and remotes in a tree, opens an interactive dependency graph, and manages host/remote development processes in integrated terminals.

[![DeepWiki](https://img.shields.io/badge/DeepWiki-andrecrjr%2Fmodule--federation--explorer-blue.svg?logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAyCAYAAAAnWDnqAAAAAXNSR0IArs4c6QAAA05JREFUaEPtmUtyEzEQhtWTQyQLHNak2AB7ZnyXZMEjXMGeK/AIi+QuHrMnbChYY7MIh8g01fJoopFb0uhhEqqcbWTp06/uv1saEDv4O3n3dV60RfP947Mm9/SQc0ICFQgzfc4CYZoTPAswgSJCCUJUnAAoRHOAUOcATwbmVLWdGoH//PB8mnKqScAhsD0kYP3j/Yt5LPQe2KvcXmGvRHcDnpxfL2zOYJ1mFwrryWTz0advv1Ut4CJgf5uhDuDj5eUcAUoahrdY/56ebRWeraTjMt/00Sh3UDtjgHtQNHwcRGOC98BJEAEymycmYcWwOprTgcB6VZ5JK5TAJ+fXGLBm3FDAmn6oPPjR4rKCAoJCal2eAiQp2x0vxTPB3ALO2CRkwmDy5WohzBDwSEFKRwPbknEggCPB/imwrycgxX2NzoMCHhPkDwqYMr9tRcP5qNrMZHkVnOjRMWwLCcr8ohBVb1OMjxLwGCvjTikrsBOiA6fNyCrm8V1rP93iVPpwaE+gO0SsWmPiXB+jikdf6SizrT5qKasx5j8ABbHpFTx+vFXp9EnYQmLx02h1QTTrl6eDqxLnGjporxl3NL3agEvXdT0WmEost648sQOYAeJS9Q7bfUVoMGnjo4AZdUMQku50McDcMWcBPvr0SzbTAFDfvJqwLzgxwATnCgnp4wDl6Aa+Ax283gghmj+vj7feE2KBBRMW3FzOpLOADl0Isb5587h/U4gGvkt5v60Z1VLG8BhYjbzRwyQZemwAd6cCR5/XFWLYZRIMpX39AR0tjaGGiGzLVyhse5C9RKC6ai42ppWPKiBagOvaYk8lO7DajerabOZP46Lby5wKjw1HCRx7p9sVMOWGzb/vA1hwiWc6jm3MvQDTogQkiqIhJV0nBQBTU+3okKCFDy9WwferkHjtxib7t3xIUQtHxnIwtx4mpg26/HfwVNVDb4oI9RHmx5WGelRVlrtiw43zboCLaxv46AZeB3IlTkwouebTr1y2NjSpHz68WNFjHvupy3q8TFn3Hos2IAk4Ju5dCo8B3wP7VPr/FGaKiG+T+v+TQqIrOqMTL1VdWV1DdmcbO8KXBz6esmYWYKPwDL5b5FA1a0hwapHiom0r/cKaoqr+27/XcrS5UwSMbQAAAABJRU5ErkJggg==)](https://deepwiki.com/andrecrjr/module-federation-explorer)

## What it provides

- **Workspace discovery**: scan configured folders for supported Module Federation configuration files.
- **Tree exploration**: browse remotes and exposed modules, then open exposed-module source files.
- **Dependency graph**: inspect host/remote consumption, exposed modules, external remotes, and shared dependencies.
- **Terminal orchestration**: start and stop host applications and remotes in VS Code terminals.
- **Persisted workspace settings**: keep root folders, remote folders, and commands in a JSON configuration file.
- **Onboarding**: detect candidate projects and guide first-time root configuration.

## Requirements

- Visual Studio Code 1.80 or newer.
- Node.js and a package manager (`npm`, `pnpm`, or `yarn`) for projects managed by the extension.
- A workspace containing Module Federation configuration files.

Node.js 24 is used for repository development and CI. The extension itself runs inside the VS Code extension host.

## Quick start

1. Install **Module Federation Explorer** from the VS Code Marketplace.
2. Open a workspace containing one or more federation projects.
3. Open the **Module Federation Explorer** view in the Explorer sidebar.
4. Choose **Change Configuration File** if you want a configuration file other than the default `.vscode/mf-explorer.roots.json`.
5. Add one or more host folders with **Add New Host Folder**.
6. Expand a host to inspect remotes and exposed modules. Use the context actions to configure or start applications.
7. Use **Show Dependency Graph** from the view toolbar to inspect relationships.

The extension activates when VS Code finds a supported federation configuration or `.vscode/mf-explorer.roots.json`. Activation does not add every detected project automatically: roots are selected by the user or through onboarding.

## Supported configuration files

Discovery uses static AST analysis. It reads configuration source without executing project code.

| Configuration type | Files | Recognized shape |
| --- | --- | --- |
| Webpack | `webpack.config.js`, `webpack.config.ts` | `new ModuleFederationPlugin({ ... })` |
| Rspack | `rspack.config.js`, `rspack.config.ts` | `new ModuleFederationPlugin({ ... })`, using the Rspack config type |
| Vite | `vite.config.js`, `vite.config.ts` | Federation plugin in the exported config |
| Rsbuild | `rsbuild.config.js`, `rsbuild.config.ts` | `moduleFederation.options` or a federation plugin |
| Modern.js | `module-federation.config.js`, `module-federation.config.ts`, `modern.config.js`, `modern.config.ts` | `createModuleFederationConfig({ ... })` |

The shared extractor reads `name`, `remotes`, `exposes`, and `shared` values. Literal values are preserved. Dynamic values are represented with placeholders such as `[ENV: env.REMOTE_URL]`, `[VAR: REMOTE_URL]`, or `[DYNAMIC_URL]`; the extension never evaluates them.

Malformed files produce parse diagnostics and do not prevent other configured roots from loading. Overlapping discovery matches are de-duplicated, and `node_modules` is excluded.

## Root configuration

The default file is `.vscode/mf-explorer.roots.json` in the first workspace folder. A different JSON file can be selected from the command palette. Root paths are stored as absolute, normalized paths.

Minimal configuration:

```json
{
  "roots": ["/workspace/host"]
}
```

Optional per-root settings store host commands and remote overrides:

```json
{
  "roots": ["/workspace/host"],
  "rootConfigs": {
    "/workspace/host": {
      "startCommand": "pnpm run dev",
      "remotes": {
        "auth": {
          "name": "auth",
          "folder": "../auth",
          "packageManager": "pnpm",
          "configType": "vite",
          "buildCommand": "pnpm run build",
          "startCommand": "pnpm run preview"
        }
      },
      "externalRemotes": {
        "catalog": {
          "name": "catalog",
          "url": "https://example.test/catalog/remoteEntry.js",
          "configType": "external",
          "isExternal": true
        }
      }
    }
  }
}
```

Discovered federation data and saved user settings are separate. On reload, saved remote folders and commands are overlaid onto a fresh discovery result. External remotes exist only in the saved root configuration and are added to the in-memory snapshot during hydration.

## Common workflows

### Hosts

- Add or remove root folders from the explorer toolbar or context menu.
- Configure a host start command; the extension suggests a command from the detected lockfile and bundler conventions.
- Start or stop a host application in one integrated terminal.
- Drag root folders to change their persisted order.

### Remotes

- Start a configured remote. The extension opens one build terminal and one preview/start terminal.
- Configure the remote project folder, build command, or preview command when values are missing or outdated.
- Stop a running remote from the tree.
- Add an external remote by name and URL. External remotes are persisted under their owning host and are not parsed from a local project.

### Graph

The graph displays:

- host and workspace-remote applications;
- external remotes that have no matching workspace configuration;
- exposed-module nodes and `exposes` edges;
- shared-dependency nodes when a dependency is shared by more than one application;
- `consumes` edges, including bidirectional relationships.

Click a workspace application node to view details or open its configuration file. The graph panel uses the bundled `media/d3.min.js` first and has CDN fallbacks.

### Live updates and lifecycle

The extension watches supported federation config files and `.vscode/mf-explorer.roots.json`. Changes are debounced for 500 ms before reloading. Terminal state is cleared on activation, updated when terminals close, and cleaned periodically so stale running indicators disappear.

## Commands

Command IDs are grouped by feature:

| Feature | Command IDs |
| --- | --- |
| Explorer | `moduleFederation.refresh`, `moduleFederation.reveal`, `moduleFederation.openView`, `moduleFederation.focus`, `moduleFederation.showWelcome` |
| Roots | `moduleFederation.addRoot`, `moduleFederation.removeRoot`, `moduleFederation.changeConfigFile`, `moduleFederation.configureRootApp`, `moduleFederation.editRootAppCommand`, `moduleFederation.startRootApp`, `moduleFederation.stopRootApp` |
| Remotes | `moduleFederation.startRemote`, `moduleFederation.stopRemote`, `moduleFederation.editCommand`, `moduleFederation.addExternalRemote`, `moduleFederation.removeExternalRemote` |
| Graph/runtime | `moduleFederation.showDependencyGraph`, `moduleFederation.cleanupTerminals` |
| Feedback | `moduleFederation.showFeedback`, `moduleFederation.rateExtension` |

Most commands are available from the command palette and the relevant view toolbar or tree context menu. See `package.json` for contributed titles and menu conditions.

## Development

```bash
make setup
make check
```

Useful Make targets:

| Target | Purpose |
| --- | --- |
| `make setup` | Install locked dependencies |
| `make run` | Launch the VS Code Extension Development Host |
| `make watch` | Rebuild the extension bundle on changes |
| `make format` | Format supported files with Oxfmt |
| `make format-check` | Check formatting without writing files |
| `make lint` | Run Oxlint |
| `make check` | Run formatting, lint, typecheck, and headless tests |
| `make vsce` | Build and package a `.vsix` with VSCE |
| `make install` | Install the generated `.vsix` in VS Code |

Equivalent npm scripts:

| Script | Purpose |
| --- | --- |
| `npm run format` | Format supported files with Oxfmt |
| `npm run format:check` | Check formatting without writing files |
| `npm run watch` | Rebuild the extension bundle on changes |
| `npm run package` | Create the production Rspack bundle in `dist/` |
| `npm run vsce` | Package the extension as a `.vsix` |
| `npm run test:headless` | Run unit and extension-host tests without a desktop UI |
| `npm run test:coverage` | Run coverage and enforce the checked-in baseline |
| `npm run test:manual` | Run manual-flow integration tests |
| `npm run test:ui` | Run configured-workspace and onboarding desktop suites |
| `npm run test:ui:headless` | Run desktop suites through the Linux headless wrapper |
`make package` is kept as an alias for `make vsce`.

VSCE is installed as a local dev dependency. Run `make setup` once, then use
`make vsce`; the generated `.vsix` can be installed with `make install` or the
VS Code Extensions view.

Desktop UI tests use VS Code Extension Tester and need a graphical display. On headless Linux, use `npm run test:ui:headless`; the wrapper runs the suite inside Xvfb. CI uses Node.js 24 on Ubuntu 24.04, applies the temporary AppArmor setting required by ExTester's `openResources()` workflow, and runs the same wrapper. The test helper opens fixture workspaces only after the VS Code workbench settles because ExTester starts VS Code through ChromeDriver and then uses a second-instance CLI call to open resources.

## Documentation map

- [`docs/architecture.md`](docs/architecture.md): current runtime architecture, boundaries, data flow, and extension points.
- [`AGENTS.md`](AGENTS.md): repository guidance for coding agents, including safe change paths and validation rules.
- [`roadmap.md`](roadmap.md): active product and technical backlog.
- [`docs/architecture.md`](docs/architecture.md): current architecture, ownership, dependency direction, and testing layout.

## Contributing

Pull requests are welcome. Keep changes focused, preserve strict TypeScript boundaries, add or update tests for behavior changes, and use Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). See the architecture and agent guides before changing cross-feature behavior.

## Support and license

If this extension improves your Module Federation workflow, support the project on [Ko-fi](https://ko-fi.com/andrecrjr).

Released under the MIT License. See [`LICENSE.md`](LICENSE.md).
