# SPEC: Graph Bug Fixes & Refactoring

> **Branch:** `fix/bugs-in-graph`  
> **Target File:** `src/dependencyGraph.ts` (1,672 lines)  
> **Supporting Files:** `src/types.ts`, `src/unifiedTreeProvider.ts`, `src/index.ts`

---

## 1. `findAppIdByName` — Fragile Name Matching

**Severity:** 🔴 High  
**Location:** `dependencyGraph.ts` lines 577-606

### Problem
The matching logic falls back to substring/partial matching:
```ts
if (configName.includes(lowerAppName) || lowerAppName.includes(configName)) {
  return appId;
}
```
This produces false positives — e.g. `"auth"` incorrectly matches `"authentication"`.

### Fix
- Remove the substring fallback entirely, or guard it behind a strict uniqueness check (only match if exactly one candidate passes).
- Prefer exact match → case-insensitive exact match → no match.
- Log a warning when no match or multiple ambiguous matches are found.

---

## 2. `processedPairs` — Lost Edge Directionality

**Severity:** 🔴 High  
**Location:** `dependencyGraph.ts` lines 308-377

### Problem
Pairs are normalized lexicographically:
```ts
const pairId = hostId < remoteId ? `${hostId}-${remoteId}` : `${remoteId}-${hostId}`;
```
This treats `A->B` and `B->A` as the same pair, so only one edge is created even when both apps consume each other (and it's not a true bidirectional relationship).

### Fix
- Use a **directed** pair key: `${hostId}->remoteId`.
- Track processed **directed** edges instead of undirected pairs.
- When both `A->B` and `B->A` exist, render two distinct edges (or a single bidirectional edge with a distinct visual style).

---

## 3. appId Hash Collision Risk

**Severity:** 🟡 Medium  
**Location:** `dependencyGraph.ts` lines 64-66, 607-616

### Problem
```ts
const rootPathHash = this.hashPath(rootPath);  // DJB2 → 8 chars base-36
const appId = `${rootPathHash}-${config.name}-${config.configType}`;
```
DJB2 truncated to 8 characters in base-36 has a non-trivial collision probability in large mono-repos.

### Fix
- Use the full relative path string (sanitized) as the identifier instead of a hash.
- Alternatively, use a stronger hash (e.g., xxHash or SHA-1 truncated to 12+ chars).
- Add a collision detection guard: throw or warn if duplicate appIds are generated.

---

## 4. Excessive Verbose Logging

**Severity:** 🟡 Medium  
**Location:** `dependencyGraph.ts` — ~50+ `log()` calls throughout `generateDependencyGraph()`

### Problem
`JSON.stringify()` of large graph objects floods the VS Code output channel in real projects.

### Fix
- Introduce a log-level mechanism (e.g., only log summaries in normal mode, full dumps only in debug mode).
- Replace bulk `JSON.stringify` logging with targeted, concise summaries (counts, key names).

---

## 5. `metadata` Non-Null Assertions

**Severity:** 🟡 Medium  
**Location:** `dependencyGraph.ts` lines 163, 292, 295, 298, 476, 529, 530

### Problem
`graph.metadata!` uses non-null assertions throughout. The property is always initialized (line 39), so the type definition marks it as optional unnecessarily.

### Fix
- In `types.ts`, change `metadata?: {...}` to `metadata: {...}` (required).
- Remove all `!` assertions.

---

## 6. Scattered `console.log` / `console.error` / `console.warn`

**Severity:** 🟡 Medium  
**Location:** 23 instances across the codebase (e.g., `configExtractors.ts` lines 212-220)

### Problem
Production extension code should consistently use the `outputChannel` logger.

### Fix
- Replace all `console.*` calls with the extension's `outputChannel` logger.
- Use `console.*` only in test files or development-only utility scripts.

---

## 7. `handleNodeClick` — Not Useful

**Severity:** 🟡 Medium  
**Location:** `dependencyGraph.ts` lines 697-738

### Problem
Shows a VS Code info message with node details. Not actionable — doesn't navigate to the config file or open the folder.

### Fix
- On click, reveal the corresponding config file in the VS Code explorer and open it in an editor.
- If the node is a host/remote, offer a quick-pick of actions (open config, start/stop, reveal in tree).

---

## 8. No Auto-Refresh on Config Change

**Severity:** 🟡 Medium

### Problem
When configurations change (file watcher), the graph webview does not automatically refresh. The `_panel` is reused but never updated.

### Fix
- Hook into the existing file watcher / refresh mechanism to call `panel.webview.html = getWebviewContent(graph)` when configs change.
- Add a debounced auto-refresh (e.g., 500ms after last config change).

---

## 9. Graph Export Missing Node Positions

**Severity:** 🟢 Low  
**Location:** `exportGraph()` — line ~1274 in webview JS

### Problem
Exports raw graph data (nodes + edges) but not the computed force-simulation layout positions. Users can't share a specific layout.

### Fix
- Include `node.x` and `node.y` (and `node.vx`, `node.vy` if available) in the exported JSON.

---

## 10. No Graph Search / Filter

**Severity:** 🟢 Low  
**Status:** Already on roadmap

### Problem
No way to search for specific nodes or filter by type (`host`, `remote`, `shared-dependency`, `exposed-module`).

### Fix
- Add a search input in the webview toolbar.
- Filter nodes by name match and highlight matching nodes.
- Add toggle buttons to show/hide node types.

---

## 11. Large Monolithic File — Refactor Target

**Severity:** 🟢 Low (structural)  
**Location:** `dependencyGraph.ts` — 1,672 lines

### Problem
Mixes four distinct concerns:
1. Graph data generation (multi-pass algorithm, ~550 lines)
2. VS Code webview lifecycle management (~100 lines)
3. ~900-line inline HTML/CSS/JS template string
4. Event handling (node clicks, postMessage)

### Fix (proposed structure)
```
src/
  graph/
    generator.ts          // Multi-pass graph generation algorithm
    types.ts              // Graph-specific types (can extend src/types.ts)
    webview/
      template.ts         // HTML/CSS/JS template generator
      handlers.ts         // Webview message handlers (node clicks, export, etc.)
    dependencyGraph.ts    // DependencyGraphManager class (thin coordinator)
```

---

## Summary Priority Order

| # | Item | Severity | Effort |
|---|------|----------|--------|
| 1 | Fix `findAppIdByName` matching | 🔴 High | Small |
| 2 | Fix `processedPairs` directionality | 🔴 High | Medium |
| 3 | Improve appId generation | 🟡 Medium | Small |
| 4 | Reduce verbose logging | 🟡 Medium | Small |
| 5 | Fix `metadata` non-null assertions | 🟡 Medium | Small |
| 6 | Replace `console.*` with `outputChannel` | 🟡 Medium | Medium |
| 7 | Improve `handleNodeClick` | 🟡 Medium | Medium |
| 8 | Add auto-refresh on config change | 🟡 Medium | Medium |
| 9 | Export node positions | 🟢 Low | Small |
| 10 | Add search/filter | 🟢 Low | Medium |
| 11 | Split monolithic file | 🟢 Low | Large |
