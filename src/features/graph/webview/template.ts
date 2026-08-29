import * as vscode from 'vscode';
import * as path from 'path';
import type { DependencyGraph, D3GraphData } from '../types';

/** Serialize JSON safely inside an HTML script element. */
export function serializeForScript(value: unknown): string {
  return (JSON.stringify(value) ?? 'null')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Generate the full HTML/CSS/JS for the D3.js dependency graph webview.
 * Extracted from the monolithic DependencyGraphManager.getWebviewContent().
 */
export function generateWebviewContent(
  webview: vscode.Webview,
  extensionPath: string,
  graph: DependencyGraph
): string {
  const d3GraphData: D3GraphData = {
    nodes: graph.nodes,
    links: graph.edges.map(edge => ({
      source: edge.from,
      target: edge.to,
      label: edge.label,
      type: edge.type,
      strength: edge.strength || 1,
      bidirectional: edge.bidirectional || false
    }))
  };

  const d3Uri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extensionPath, 'media', 'd3.min.js'))
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval' ${webview.cspSource} https://d3js.org https://cdn.jsdelivr.net https://unpkg.com;">
    <title>Module Federation Dependency Graph</title>
    <style>
        body, html {
            height: 100%;
            margin: 0;
            padding: 0;
            overflow: hidden;
            font-family: var(--vscode-font-family);
        }
        #graph-container {
            width: 100%;
            height: 100vh;
            background-color: var(--vscode-editor-background);
            position: relative;
        }

        /* Node Styles */
        .host-node { fill: #007ACC; stroke: #005A9C; stroke-width: 3px; }
        .remote-node { fill: #6F42C1; stroke: #4B2882; stroke-width: 2px; }
        .bidirectional-node { fill: url(#bidirectionalGradient); stroke: #FF6B35; stroke-width: 3px; }
        .external-remote-node { fill: #DC3545; stroke: #C82333; stroke-width: 2px; opacity: 0.8; }
        .shared-dependency-node { fill: #28A745; stroke: #1E7E34; stroke-width: 2px; }
        .exposed-module-node { fill: #FD7E14; stroke: #E55100; stroke-width: 1px; }
        .node:hover circle { stroke-width: 4px !important; filter: brightness(1.2); }

        /* Edge Styles */
        .edge { stroke-width: 1.5px; fill: none; }
        .edge.consumes { stroke: #007ACC; stroke-dasharray: none; }
        .edge.consumes.bidirectional { stroke: #FF6B35; stroke-width: 2.5px; stroke-dasharray: none; }
        .edge.exposes { stroke: #FD7E14; stroke-dasharray: 5,5; }
        .edge.shares { stroke: #28A745; stroke-dasharray: 3,3; opacity: 0.7; }
        .edge.depends-on { stroke: #6C757D; stroke-dasharray: 2,2; }
        .edge:hover { stroke-width: 3px !important; opacity: 1 !important; }

        .node-label {
            fill: #FFFFFF; font-family: var(--vscode-font-family); font-size: 11px;
            text-anchor: middle; pointer-events: none; font-weight: 500;
        }
        .edge-label {
            fill: var(--vscode-editor-foreground); font-family: var(--vscode-font-family);
            font-size: 9px; text-anchor: middle; pointer-events: none; opacity: 0.8;
        }

        .tooltip {
            position: absolute; background: var(--vscode-editor-widget-background);
            border: 1px solid var(--vscode-widget-border); padding: 12px; border-radius: 6px;
            font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-editor-foreground);
            z-index: 100; pointer-events: none; opacity: 0; transition: opacity 0.2s;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3); max-width: 300px;
        }
        .tooltip h4 { margin: 0 0 8px 0; color: var(--vscode-textLink-foreground); }
        .tooltip .detail { margin: 4px 0; font-size: 11px; opacity: 0.9; }

        .legend {
            position: absolute; top: 20px; right: 20px; background: var(--vscode-editor-widget-background);
            border: 1px solid var(--vscode-widget-border); padding: 16px; border-radius: 6px;
            font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-editor-foreground);
            box-shadow: 0 2px 8px rgba(0,0,0,0.2); min-width: 220px; max-width: 280px;
        }
        .legend h3 { margin: 0 0 12px 0; font-size: 14px; color: var(--vscode-textLink-foreground); }
        .legend-section { margin-bottom: 18px; }
        .legend-section:last-child { margin-bottom: 0; }
        .legend-section h4 { margin: 0 0 10px 0; font-size: 11px; text-transform: uppercase; opacity: 0.8; font-weight: 600; border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 4px; }
        .legend-item { display: flex; align-items: flex-start; margin-bottom: 12px; min-height: 24px; line-height: 1.4; clear: both; }
        .legend-item small { opacity: 0.7; font-size: 10px; margin-left: 4px; white-space: nowrap; }
        .legend-color { width: 16px; height: 16px; margin-right: 10px; margin-top: 2px; border-radius: 50%; border: 2px solid; flex-shrink: 0; }
        .host-color { background-color: #007ACC; border-color: #005A9C; }
        .remote-color { background-color: #6F42C1; border-color: #4B2882; }
        .bidirectional-color { background: #007ACC; border: 2px solid #6F42C1; box-shadow: 0 0 0 1px #FF6B35; position: relative; display: inline-block; }
        .external-color { background-color: #DC3545; border-color: #C82333; }
        .shared-color { background-color: #28A745; border-color: #1E7E34; }
        .module-color { background-color: #FD7E14; border-color: #E55100; }
        .legend-line { width: 20px; height: 2px; margin-right: 8px; border-radius: 1px; }
        .consumes-line { background-color: #007ACC; }
        .bidirectional-consumes-line { background-color: #FF6B35; height: 3px; }
        .exposes-line { background-color: #FD7E14; background-image: repeating-linear-gradient(90deg, transparent, transparent 3px, #FFF 3px, #FFF 6px); }
        .shares-line { background-color: #28A745; background-image: repeating-linear-gradient(90deg, transparent, transparent 2px, #FFF 2px, #FFF 4px); }

        .controls {
            position: absolute; top: 20px; left: 20px; background: var(--vscode-editor-widget-background);
            border: 1px solid var(--vscode-widget-border); padding: 10px; border-radius: 6px;
            font-family: var(--vscode-font-family); font-size: 12px;
        }
        .control-button {
            background: var(--vscode-button-background); color: var(--vscode-button-foreground);
            border: none; padding: 6px 12px; margin: 2px; border-radius: 3px; cursor: pointer;
            font-size: 11px;
        }
        .control-button:hover { background: var(--vscode-button-hoverBackground); }

        .stats {
            position: absolute; bottom: 20px; left: 20px; background: var(--vscode-editor-widget-background);
            border: 1px solid var(--vscode-widget-border); padding: 10px; border-radius: 6px;
            font-family: var(--vscode-font-family); font-size: 11px; color: var(--vscode-editor-foreground);
        }
        .stats .stat-item { margin: 2px 0; }
        .stats .stat-value { font-weight: bold; color: var(--vscode-textLink-foreground); }

        .loading {
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            font-family: var(--vscode-font-family); font-size: 16px; color: var(--vscode-editor-foreground);
        }
        #error-message { color: var(--vscode-errorForeground); text-align: center; margin-top: 20px; display: none; }
        #no-data {
            display: none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            font-family: var(--vscode-font-family); font-size: 16px; color: var(--vscode-descriptionForeground); text-align: center;
        }
    </style>
</head>
<body>
    <div id="graph-container"></div>
    <div class="tooltip" id="tooltip"></div>
    <div id="error-message"></div>
    <div id="no-data">No Module Federation configurations found to display.</div>

    <div class="controls">
        <button id="reset-view" class="control-button" aria-label="Reset graph view" onclick="resetZoom()">Reset View</button>
        <button id="toggle-physics" class="control-button" aria-label="Toggle graph physics" onclick="togglePhysics()">Toggle Physics</button>
        <button id="export-graph" class="control-button" aria-label="Export dependency graph" onclick="exportGraph()">Export</button>
    </div>

    <div class="legend">
        <h3>Module Federation Graph</h3>
        <div class="legend-section">
            <h4>Node Types</h4>
            <div class="legend-item"><div class="legend-color host-color"></div><span>Host Application<br><small>(Consumes remotes or standalone)</small></span></div>
            <div class="legend-item"><div class="legend-color remote-color"></div><span>Remote Application<br><small>(Workspace apps consumed by others)</small></span></div>
            <div class="legend-item"><div class="legend-color bidirectional-color"></div><span>Bidirectional App<br><small>(Consumes remotes + consumed by others)</small></span></div>
            <div class="legend-item"><div class="legend-color external-color"></div><span>External Remote<br><small>(Outside workspace)</small></span></div>
            <div class="legend-item"><div class="legend-color shared-color"></div><span>Shared Dependency</span></div>
            <div class="legend-item"><div class="legend-color module-color"></div><span>Exposed Module</span></div>
        </div>
        <div class="legend-section">
            <h4>Relationships</h4>
            <div class="legend-item"><div class="legend-line consumes-line"></div><span>Consumes</span></div>
            <div class="legend-item"><div class="legend-line bidirectional-consumes-line"></div><span>Bidirectional Consumes</span></div>
            <div class="legend-item"><div class="legend-line exposes-line"></div><span>Exposes</span></div>
            <div class="legend-item"><div class="legend-line shares-line"></div><span>Shares</span></div>
        </div>
    </div>

    <div class="stats">
        <div class="stat-item">Hosts: <span class="stat-value" id="stat-hosts">0</span></div>
        <div class="stat-item">Workspace Remotes: <span class="stat-value" id="stat-workspace-remotes">0</span></div>
        <div class="stat-item">External Remotes: <span class="stat-value" id="stat-external-remotes">0</span></div>
        <div class="stat-item">Bidirectional: <span class="stat-value" id="stat-bidirectional">0</span></div>
        <div class="stat-item">Shared Deps: <span class="stat-value" id="stat-shared">0</span></div>
        <div class="stat-item">Modules: <span class="stat-value" id="stat-modules">0</span></div>
    </div>

    <div class="loading" id="loading">Loading Enhanced Module Federation Graph...</div>
    <script>
        const graphRawData = ${serializeForScript(d3GraphData)};
        let simulation;
        let svg, g, zoom;
        let physicsEnabled = true;
        const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;

        if (graphRawData.nodes.length === 0) {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('no-data').style.display = 'block';
        } else {
            loadD3();
        }

        function loadD3() {
            const d3CDNs = [
                '${d3Uri}',
                'https://d3js.org/d3.v7.min.js',
                'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js',
                'https://unpkg.com/d3@7/dist/d3.min.js'
            ];

            function tryLoadD3(cdnIndex) {
                if (cdnIndex >= d3CDNs.length) {
                    showError("Failed to load D3.js from all available CDNs.");
                    return;
                }
                const d3Script = document.createElement('script');
                d3Script.src = d3CDNs[cdnIndex];
                const loadTimeout = setTimeout(() => { d3Script.remove(); tryLoadD3(cdnIndex + 1); }, 10000);
                d3Script.onload = () => {
                    clearTimeout(loadTimeout);
                    if (typeof d3 !== 'undefined') { initializeGraph(); }
                    else { tryLoadD3(cdnIndex + 1); }
                };
                d3Script.onerror = () => { clearTimeout(loadTimeout); d3Script.remove(); tryLoadD3(cdnIndex + 1); };
                document.head.appendChild(d3Script);
            }
            tryLoadD3(0);
        }

        function log(message, ...args) { console.log('[MF Graph]', message, ...args); }

        function showError(message) {
            document.getElementById('loading').style.display = 'none';
            const el = document.getElementById('error-message');
            el.textContent = message; el.style.display = 'block';
            try { vscodeApi?.postMessage({ command: 'error', text: message }); } catch (_) {}
        }

        function resetZoom() {
            if (svg && zoom) { svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity); }
        }

        function togglePhysics() {
            physicsEnabled = !physicsEnabled;
            if (simulation) { physicsEnabled ? simulation.alpha(0.3).restart() : simulation.stop(); }
        }

        function exportGraph() {
            const graphData = { nodes: graphRawData.nodes, links: graphRawData.links, metadata: ${serializeForScript(graph.metadata || {})} };
            const blob = new Blob([JSON.stringify(graphData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url; link.download = 'module-federation-graph.json'; link.click();
            URL.revokeObjectURL(url);
        }

        function updateStats(nodes) {
            const stats = {
                hosts: nodes.filter(n => n.type === 'host').length,
                workspaceRemotes: nodes.filter(n => n.type === 'remote' && !n.id.startsWith('external-')).length,
                externalRemotes: nodes.filter(n => n.type === 'remote' && n.id.startsWith('external-')).length,
                bidirectional: nodes.filter(n => n.group === 'bidirectional').length,
                shared: nodes.filter(n => n.type === 'shared-dependency').length,
                modules: nodes.filter(n => n.type === 'exposed-module').length
            };
            document.getElementById('stat-hosts').textContent = stats.hosts;
            document.getElementById('stat-workspace-remotes').textContent = stats.workspaceRemotes;
            document.getElementById('stat-external-remotes').textContent = stats.externalRemotes;
            document.getElementById('stat-bidirectional').textContent = stats.bidirectional;
            document.getElementById('stat-shared').textContent = stats.shared;
            document.getElementById('stat-modules').textContent = stats.modules;
        }

        function initializeGraph() {
            try {
                document.getElementById('loading').style.display = 'none';
                const graphData = { nodes: graphRawData.nodes, links: graphRawData.links };
                updateStats(graphData.nodes);

                const width = window.innerWidth, height = window.innerHeight;
                svg = d3.select('#graph-container').append('svg').attr('width', width).attr('height', height);
                g = svg.append('g');
                const defs = svg.append("defs");

                // Bidirectional gradient
                const gradient = defs.append("linearGradient").attr("id", "bidirectionalGradient")
                    .attr("x1", "0%").attr("y1", "0%").attr("x2", "100%").attr("y2", "100%");
                gradient.append("stop").attr("offset", "0%").attr("stop-color", "#007ACC");
                gradient.append("stop").attr("offset", "100%").attr("stop-color", "#6F42C1");

                // Arrow markers
                const markers = [
                    { id: 'arrow-consumes', color: '#007ACC' },
                    { id: 'arrow-exposes', color: '#FD7E14' },
                    { id: 'arrow-shares', color: '#28A745', mw: 5, mh: 5 },
                    { id: 'arrow-bidirectional', color: '#FF6B35' },
                    { id: 'arrow-bidirectional-start', color: '#FF6B35', refX: -20, orient: 'auto-start-reverse' }
                ];
                markers.forEach(m => {
                    const marker = defs.append("marker")
                        .attr("id", m.id).attr("viewBox", "0 -5 10 10")
                        .attr("refX", m.refX ?? 30).attr("refY", 0)
                        .attr("markerWidth", m.mw ?? 6).attr("markerHeight", m.mh ?? 6)
                        .attr("orient", m.orient ?? "auto");
                    marker.append("path")
                        .attr("d", m.id.includes('start') ? "M10,-5L0,0L10,5" : "M0,-5L10,0L0,5")
                        .attr("fill", m.color);
                });

                zoom = d3.zoom().scaleExtent([0.1, 4]).on('zoom', e => { g.attr('transform', e.transform); });
                svg.call(zoom);

                simulation = d3.forceSimulation(graphData.nodes)
                    .force('link', d3.forceLink(graphData.links).id(d => d.id).distance(d => {
                        switch(d.type) { case 'exposes': return 80; case 'shares': return 200; case 'consumes': return 150; default: return 120; }
                    }).strength(d => d.strength || 0.5))
                    .force('charge', d3.forceManyBody().strength(d => -300 * ((d.size || 1) * 0.5)))
                    .force('center', d3.forceCenter(width / 2, height / 2))
                    .force('collide', d3.forceCollide().radius(d => 30 + (d.size || 1) * 5))
                    .force('x', d3.forceX(width / 2).strength(0.1))
                    .force('y', d3.forceY(height / 2).strength(0.1));

                const edges = g.selectAll('.edge').data(graphData.links).enter().append('line')
                    .attr('class', d => { let c = \`edge \${d.type || 'default'}\`; if (d.bidirectional) c += ' bidirectional'; return c; })
                    .attr('marker-end', d => {
                        if (d.bidirectional && d.type === 'consumes') return 'url(#arrow-bidirectional)';
                        switch(d.type) { case 'consumes': return 'url(#arrow-consumes)'; case 'exposes': return 'url(#arrow-exposes)'; case 'shares': return 'url(#arrow-shares)'; default: return 'url(#arrow-consumes)'; }
                    })
                    .attr('marker-start', d => d.bidirectional && d.type === 'consumes' ? 'url(#arrow-bidirectional-start)' : null)
                    .style('stroke-width', d => (d.strength || 1) * 2);

                const edgeLabels = g.selectAll('.edge-label')
                    .data(graphData.links.filter(d => d.label && d.type !== 'shares')).enter().append('text')
                    .attr('class', 'edge-label')
                    .text(d => d.label && d.label.length > 30 ? d.label.substring(0, 30) + '...' : d.label);

                const nodeGroups = g.selectAll('.node').data(graphData.nodes).enter().append('g')
                    .attr('class', 'node')
                    .attr('data-testid', 'graph-node')
                    .attr('data-node-id', d => d.id)
                    .attr('aria-label', d => \`\${d.label} (\${d.type})\`)
                    .call(d3.drag().on('start', dragstarted).on('drag', dragged).on('end', dragended));

                nodeGroups.append('circle')
                    .attr('r', d => {
                        const base = { 'host': 30, 'remote': 25, 'shared-dependency': 20, 'exposed-module': 15 }[d.type] || 20;
                        return base + Math.min((d.size || 1) * 2, 15);
                    })
                    .attr('class', d => {
                        if (d.type === 'host' && d.group === 'bidirectional') return 'bidirectional-node';
                        if (d.type === 'remote') { if (d.group === 'bidirectional') return 'bidirectional-node'; if (d.id.startsWith('external-')) return 'external-remote-node'; return 'remote-node'; }
                        if (d.type === 'shared-dependency') return 'shared-dependency-node';
                        if (d.type === 'exposed-module') return 'exposed-module-node';
                        return 'host-node';
                    })
                    .on('mouseover', showTooltip).on('mouseout', hideTooltip).on('click', nodeClick);

                nodeGroups.append('text').attr('class', 'node-label').attr('dy', 5)
                    .text(d => { const max = d.type === 'exposed-module' ? 8 : 12; return d.label.length > max ? d.label.substring(0, max) + '...' : d.label; });

                function dragstarted(e, d) { if (!e.active && physicsEnabled) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
                function dragged(e, d) { d.fx = e.x; d.fy = e.y; }
                function dragended(e, d) { if (!e.active && physicsEnabled) simulation.alphaTarget(0); }

                function showTooltip(event, d) {
                    let c = \`<h4>\${d.label}</h4><div class="detail"><strong>Type:</strong> \${d.type.replace('-', ' ')}</div><div class="detail"><strong>Config:</strong> \${d.configType}</div>\`;
                    if (d.url) c += \`<div class="detail"><strong>URL:</strong> \${d.url}</div>\`;
                    if (d.version) c += \`<div class="detail"><strong>Version:</strong> \${d.version}</div>\`;
                    if (d.exposedModules?.length) c += \`<div class="detail"><strong>Exposes:</strong> \${d.exposedModules.join(', ')}</div>\`;
                    if (d.sharedDependencies?.length) c += \`<div class="detail"><strong>Shared Deps:</strong> \${d.sharedDependencies.join(', ')}</div>\`;
                    if (d.size && d.size > 1) c += \`<div class="detail"><strong>Connections:</strong> \${d.size}</div>\`;
                    if (d.status) c += \`<div class="detail"><strong>Status:</strong> \${d.status}</div>\`;
                    d3.select('#tooltip').style('opacity', 1).html(c).style('left', (event.pageX + 15) + 'px').style('top', (event.pageY - 30) + 'px');
                }
                function hideTooltip() { d3.select('#tooltip').style('opacity', 0); }

                function nodeClick(event, d) {
                    const node = {
                        id: d.id,
                        label: d.label,
                        type: d.type,
                        configType: d.configType,
                        url: d.url,
                        version: d.version,
                        exposedModules: d.exposedModules,
                        sharedDependencies: d.sharedDependencies,
                        configPath: d.configPath,
                        size: d.size,
                        group: d.group,
                        status: d.status
                    };
                    try { vscodeApi?.postMessage({ command: 'nodeClick', node }); } catch (_) {}
                }

                simulation.on('tick', () => {
                    edges.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
                    edgeLabels.attr('x', d => (d.source.x + d.target.x) / 2).attr('y', d => (d.source.y + d.target.y) / 2);
                    nodeGroups.attr('transform', d => \`translate(\${d.x}, \${d.y})\`);
                });

                window.addEventListener('resize', () => {
                    const nw = window.innerWidth, nh = window.innerHeight;
                    svg.attr('width', nw).attr('height', nh);
                    simulation.force('center', d3.forceCenter(nw / 2, nh / 2));
                    simulation.alpha(0.3).restart();
                });

                try { vscodeApi?.postMessage({ command: 'loaded', metadata: ${JSON.stringify(graph.metadata || {})} }); } catch (_) {}
            } catch (error) { showError("Error initializing graph: " + error.message); }
        }
    </script>
</body>
</html>`;
}
