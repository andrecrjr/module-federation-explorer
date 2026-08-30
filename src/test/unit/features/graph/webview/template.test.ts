import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import {
  generateWebviewContent,
  LARGE_GRAPH_EDGE_THRESHOLD,
  LARGE_GRAPH_NODE_THRESHOLD,
  serializeForScript,
  shouldUseAdaptivePhysics
} from '../../../../../features/graph/webview/template';
import type { DependencyGraph } from '../../../../../features/graph/types';

const graph: DependencyGraph = {
  nodes: [
    {
      id: 'host-id',
      label: 'host',
      type: 'host',
      configType: 'webpack',
      configPath: '/workspace/host/webpack.config.js'
    }
  ],
  edges: [],
  metadata: {
    totalHosts: 1,
    totalRemotes: 0,
    totalSharedDeps: 0,
    totalExposedModules: 0
  }
};

suite('Graph webview template', () => {
  test('escapes script-breaking characters before embedding JSON', () => {
    const serialized = serializeForScript({ value: '</script><script>alert(1)</script>' });

    assert.equal(serialized.includes('</script>'), false);
    assert.equal(serialized.includes('\\u003c/script\\u003e'), true);
  });

  test('renders stable controls and node selectors for UI automation', () => {
    const webview = {
      cspSource: 'vscode-resource://test',
      asWebviewUri: () => vscode.Uri.parse('vscode-resource://test/d3.min.js')
    } as unknown as vscode.Webview;

    const html = generateWebviewContent(webview, '/extension', graph);

    assert.match(html, /id="reset-view"[^>]*aria-label="Reset graph view"/);
    assert.match(html, /id="toggle-physics"[^>]*aria-label="Toggle graph physics"/);
    assert.match(html, /data-testid', 'graph-node'/);
    assert.match(html, /data-node-id', d => d\.id/);
    assert.match(html, /aria-label', d =>/);
  });

  test('uses adaptive physics only beyond the large-graph thresholds', () => {
    assert.strictEqual(shouldUseAdaptivePhysics(LARGE_GRAPH_NODE_THRESHOLD, LARGE_GRAPH_EDGE_THRESHOLD), false);
    assert.strictEqual(shouldUseAdaptivePhysics(LARGE_GRAPH_NODE_THRESHOLD + 1, 0), true);
    assert.strictEqual(shouldUseAdaptivePhysics(0, LARGE_GRAPH_EDGE_THRESHOLD + 1), true);

    const webview = {
      cspSource: 'vscode-resource://test',
      asWebviewUri: () => vscode.Uri.parse('vscode-resource://test/d3.min.js')
    } as unknown as vscode.Webview;
    const largeGraph: DependencyGraph = {
      ...graph,
      nodes: Array.from({ length: LARGE_GRAPH_NODE_THRESHOLD + 1 }, (_, index) => ({
        id: `node-${index}`,
        label: `node-${index}`,
        type: 'host' as const,
        configType: 'webpack' as const,
        configPath: `/workspace/node-${index}/webpack.config.js`
      }))
    };

    const html = generateWebviewContent(webview, '/extension', largeGraph);
    assert.match(html, /const adaptivePhysics = true;/);
    assert.strictEqual(html.includes('nodes.filter(n =>'), false);
    assert.match(html, /nodes\.forEach\(n =>/);
  });
});
