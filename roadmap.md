# Roadmap

Product roadmap for making Module Federation Explorer a manifest-first, AI-ready development companion. Current architecture and ownership live in [`docs/architecture.md`](docs/architecture.md).

The central product direction is to use `mf-manifest.json` as a structured runtime artifact for discovery, visualization, comparison, export, and external AI context. The extension does not embed an AI assistant or execute project configuration code.

## Completed foundation

- [x] Bundle D3 locally for offline-first graph loading, with CDN fallbacks.
- [x] Keep activation and composition in `src/app/compositionRoot.ts`.
- [x] Support JavaScript and TypeScript config files for all registered bundlers.
- [x] Use one discovery registry for Webpack, Rspack, Vite, Rsbuild, and Modern.js.
- [x] Split tree, root, remote, graph, parser, extractor, and infrastructure responsibilities into focused modules.
- [x] Use typed ports for application workflows and keep `GraphGenerator` pure.
- [x] Track host/remote terminal lifecycle and dispose activation resources.
- [x] Cover parser, discovery, workflows, tree, graph, webview boundaries, manual flows, and desktop UI flows with tests.

## P0 — First-class `mf-manifest.json` support

- [x] Discover local `mf-manifest.json` files inside configured roots.
- [x] Allow users to register manifests by local path or URL.
- [x] Add a pure, schema-validated manifest parser with diagnostics for malformed or incomplete JSON.
- [x] Extract manifest IDs, federation names, metadata, remotes, exposes, shared dependencies, assets, remote-entry information, and type-file URLs.
- [x] Associate manifests with static configurations using federation name, manifest ID, configuration path, and root path.
- [x] Keep manifest state separate from static AST configurations and persisted root settings.
- [x] Display manifest source, environment label, and last-loaded timestamp.
- [x] Never execute JavaScript, TypeScript, or `remoteEntry.js` to obtain manifest data.

`mf-manifest.json` is a runtime-oriented artifact containing the information needed to understand exposed modules, remotes, shared dependencies, assets, and remote entries. See the [Manifest and Snapshot documentation](https://module-federation.io/guide/basic/manifest-snapshot) and [manifest field reference](https://module-federation.io/guide/advanced/manifest-fields.html).

## P1 — Manifest-powered Explorer and graph

- [ ] Enrich tree nodes with manifest-derived applications, exposes, remotes, aliases, shared dependencies, assets, and types.
- [ ] Add actions to open a manifest, open an exposed-module asset, open a type file, copy a manifest URL, and refresh a manifest.
- [ ] Add manifest-derived relationships to the dependency graph.
- [ ] Show manifest-only applications that have no matching local configuration.
- [ ] Distinguish data provenance as `static`, `manifest`, or `merged`.
- [ ] Add graph filters for manifest-backed applications and relationships.

## P1 — Static configuration versus manifest comparison

- [ ] Compare declared configuration with manifest data without silently overwriting either source.
- [ ] Report declared exposes missing from the manifest and manifest exposes missing from static configuration.
- [ ] Report declared remotes missing from the manifest and manifest remotes missing from static configuration.
- [ ] Report remote-entry, federation-name, and manifest-ID differences.
- [ ] Report shared-dependency differences and missing asset or type metadata.
- [ ] Link each diagnostic to the relevant configuration or manifest field.
- [ ] Add stable diagnostic codes so external tools can process drift without parsing human-readable messages.

## P1 — Stable AI context export

The extension will not contain an AI assistant or call an AI provider. It will provide deterministic, provider-neutral context that Copilot, agents, skills, plugins, MCP adapters, and custom tools can consume.

- [ ] Add `Module Federation: Copy AI Context as JSON`.
- [ ] Add `Module Federation: Export AI Context`.
- [ ] Add `Module Federation: Copy Federation Summary as Markdown`.
- [ ] Define a versioned AI-context JSON schema.
- [ ] Include applications, manifests, exposes, remotes, shared dependencies, relationships, provenance, and diagnostics.
- [ ] Use workspace-relative paths where possible.
- [ ] Redact URL credentials, query tokens, secrets, and unnecessary absolute paths by default.
- [ ] Export normalized fields rather than arbitrary raw manifest data.

The initial normalized export should contain:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-29T00:00:00.000Z",
  "applications": [],
  "manifests": [],
  "relationships": [],
  "sharedDependencies": [],
  "diagnostics": []
}
```

## P2 — Agent and plugin interoperability

- [ ] Document the AI-context schema and export commands in `docs/ai-integration.md`.
- [ ] Document manifest field meanings, provenance rules, diagnostic codes, and redaction behavior.
- [ ] Provide example agent questions for finding remotes, exposes, shared dependencies, and manifest drift.
- [ ] Document how external skills, plugins, MCP servers, or CLIs can wrap the exported context.
- [ ] Define future query capabilities such as `get_federation_context`, `list_manifests`, `list_exposes`, `list_remotes`, and `find_manifest_drift`.
- [ ] Keep the integration contract provider-neutral and independent of any embedded AI implementation.

## P2 — Manifest snapshots and comparison

- [ ] Keep the last successfully loaded manifest snapshot in memory.
- [ ] Add a `Compare Manifest` action.
- [ ] Report added, removed, and changed applications, exposes, remotes, shared dependencies, assets, types, and remote-entry metadata.
- [ ] Export comparison results using the same AI-ready JSON schema.
- [ ] Add stable change categories for external tools and agents.

## Deferred scope

- [ ] Consider `mf-stats.json` support only after the `mf-manifest.json` model is stable.

The following are intentionally outside this roadmap: embedded AI chat, AI provider calls, browser runtime instrumentation, `remoteEntry.js` parsing, runtime plugins, automatic environment-variable evaluation, and terminal/process orchestration.

## Quality bar

New behavior should include focused tests and documentation updates. Before merge, run:

```bash
npm run typecheck
npm run lint
npm run compile
npm run test:headless
```

Run coverage, manual-flow, and headless UI suites when affected. Use Conventional Commits so semantic-release can classify changes.
