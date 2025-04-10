import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { 
  DependencyGraph, 
  DependencyGraphNode, 
  DependencyGraphEdge, 
  Remote, 
  ModuleFederationConfig 
} from './types';
import { log } from './outputChannel';

/**
 * Generates a dependency graph from Module Federation configurations
 */
export class DependencyGraphManager {
  private _panel: vscode.WebviewPanel | undefined;
  
  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Generate a dependency graph from the provided configurations
   */
  generateDependencyGraph(configs: Map<string, ModuleFederationConfig[]>): DependencyGraph {
    const graph: DependencyGraph = {
      nodes: [],
      edges: []
    };
    
    const nodeMap = new Map<string, DependencyGraphNode>();
    
    // Process all configs to create nodes and edges
    configs.forEach((rootConfigs, rootPath) => {
      rootConfigs.forEach(config => {
        // Add the host application as a node
        // Include the rootPath in the host ID to ensure uniqueness across different roots
        const rootPathHash = this.hashPath(rootPath);
        const hostId = `${rootPathHash}-${config.name}-${config.configType}`;
        if (!nodeMap.has(hostId)) {
          const hostNode: DependencyGraphNode = {
            id: hostId,
            label: config.name,
            type: 'host',
            configType: config.configType
          };
          nodeMap.set(hostId, hostNode);
          graph.nodes.push(hostNode);
        }
        
        // Process remotes
        config.remotes.forEach(remote => {
          // For remotes, include the host ID they're connected to in their ID
          // This ensures remotes are properly connected to the correct host
          const remoteId = `${rootPathHash}-${remote.name}-${remote.configType}`;
          
          // Add remote as a node if not already added
          if (!nodeMap.has(remoteId)) {
            const remoteNode: DependencyGraphNode = {
              id: remoteId,
              label: remote.name,
              type: 'remote',
              configType: remote.configType
            };
            nodeMap.set(remoteId, remoteNode);
            graph.nodes.push(remoteNode);
          }
          
          // Add edge from host to remote
          const edge: DependencyGraphEdge = {
            from: hostId,
            to: remoteId
          };
          
          // Check if we have an entry point URL to add as a label
          if (remote.url) {
            edge.label = remote.url;
          }
          
          graph.edges.push(edge);
        });
      });
    });
    
    // Debug log the graph data to help troubleshooting
    console.log(`Generated dependency graph with ${graph.nodes.length} nodes and ${graph.edges.length} edges`);
    
    return graph;
  }

  /**
   * Helper method to create a short hash of a path to use in IDs
   */
  private hashPath(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36).substring(0, 8);
  }

  /**
   * Show the dependency graph in a webview panel
   */
  showDependencyGraph(graph: DependencyGraph): void {
    // Skip if there are no nodes to display
    if (graph.nodes.length === 0) {
      vscode.window.showInformationMessage("No Module Federation configurations found to display in the graph.");
      return;
    }
    
    const columnToShowIn = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (this._panel) {
      // If we already have a panel, show it in the same column
      this._panel.reveal(columnToShowIn);
      this.updateWebviewContent(this._panel.webview, graph);
    } else {
      // Otherwise, create a new panel
      this._panel = vscode.window.createWebviewPanel(
        'moduleFederationGraph',
        'Module Federation Explorer Graph',
        columnToShowIn || vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.file(path.join(this.context.extensionPath, 'media')),
            vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules'))
          ]
        }
      );

      // Set initial HTML content
      this.updateWebviewContent(this._panel.webview, graph);

      // Reset when the panel is closed
      this._panel.onDidDispose(
        () => {
          this._panel = undefined;
        },
        null,
        this.context.subscriptions
      );
      
      // Handle messages from the webview
      this._panel.webview.onDidReceiveMessage(
        message => {
          switch (message.command) {
            case 'error':
              vscode.window.showErrorMessage(`Graph Error: ${message.text}`);
              break;
            case 'loaded':
              console.log("Dependency graph loaded successfully");
              break;
          }
        },
        undefined,
        this.context.subscriptions
      );
    }
  }

  /**
   * Update the webview content with the graph data
   */
  private updateWebviewContent(webview: vscode.Webview, graph: DependencyGraph): void {
    webview.html = this.getWebviewContent(webview, graph);
  }

  /**
   * Generate HTML for the webview panel
   */
    private getWebviewContent(webview: vscode.Webview, graph: DependencyGraph): string {
    // Convert nodes and edges to JSON for the webview
    const graphData = JSON.stringify(graph);
    // Transform edges from 'from/to' naming format to 'source/target' for D3.js
    const d3GraphData = {
        nodes: graph.nodes,
        links: graph.edges.map(edge => ({
        source: edge.from,
        target: edge.to,
        label: edge.label
        }))
    };
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval' https://d3js.org;">
        <title>Module Federation Dependency Graph</title>
        <style>
            body, html {
                height: 100%;
                margin: 0;
                padding: 0;
                overflow: hidden;
            }
            #graph-container {
                width: 100%;
                height: 100vh;
                background-color: var(--vscode-editor-background);
            }
            /* Host Nodes */
            .host-node {
                fill: #007ACC; /* Vibrant blue */
                stroke: #005A9C; /* Darker blue for border */
                stroke-width: 2px;
            }
            /* Remote Nodes */
            .remote-node {
                fill: #6F42C1; /* Distinct purple */
                stroke: #4B2882; /* Darker purple for border */
                stroke-width: 2px;
            }
            /* Node Labels */
            .node-label {
                fill: #FFFFFF; /* White text for contrast */
                font-family: var(--vscode-font-family);
                font-size: 12px;
                text-anchor: middle;
                pointer-events: none;
            }
            /* Links */
            .edge {
                stroke: #9E9E9E; /* Neutral gray */
                stroke-width: 1.5px;
            }
            .edge:hover {
                stroke: #FFC107; /* Highlight with yellow */
                stroke-width: 2px;
            }
            /* Edge Labels */
            .edge-label {
                fill: #FFFFFF; /* White text for contrast */
                font-family: var(--vscode-font-family);
                font-size: 10px;
                text-anchor: middle;
                pointer-events: none;
            }
            /* Tooltip */
            .tooltip {
                position: absolute;
                background: var(--vscode-editor-widget-background);
                border: 1px solid var(--vscode-widget-border);
                padding: 8px;
                border-radius: 4px;
                font-family: var(--vscode-font-family);
                font-size: 12px;
                color: var(--vscode-editor-foreground);
                z-index: 100;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.2s;
            }
            /* Legend */
            .legend {
                position: absolute;
                top: 20px;
                right: 20px;
                background: var(--vscode-editor-widget-background);
                border: 1px solid var(--vscode-widget-border);
                padding: 10px;
                border-radius: 4px;
                font-family: var(--vscode-font-family);
                font-size: 12px;
                color: var(--vscode-editor-foreground);
            }
            .legend-item {
                display: flex;
                align-items: center;
                margin-bottom: 8px;
            }
            .legend-color {
                width: 15px;
                height: 15px;
                margin-right: 8px;
                border-radius: 3px;
            }
            .host-color {
                background-color: #007ACC; /* Match host node color */
            }
            .remote-color {
                background-color: #6F42C1; /* Match remote node color */
            }
            /* Loading Message */
            .loading {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                font-family: var(--vscode-font-family);
                font-size: 16px;
                color: var(--vscode-editor-foreground);
            }
            /* Error Message */
            #error-message {
                color: var(--vscode-errorForeground);
                text-align: center;
                margin-top: 20px;
                display: none;
            }
            /* No Data Message */
            #no-data {
                display: none;
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                font-family: var(--vscode-font-family);
                font-size: 16px;
                color: var(--vscode-descriptionForeground);
                text-align: center;
            }
        </style>
    </head>
    <body>
        <div id="graph-container"></div>
        <div class="tooltip" id="tooltip"></div>
        <div id="error-message"></div>
        <div id="no-data">No Module Federation configurations found to display.</div>
        <div class="legend">
            <div class="legend-item">
                <div class="legend-color host-color"></div>
                <span>Host Application</span>
            </div>
            <div class="legend-item">
                <div class="legend-color remote-color"></div>
                <span>Remote Module</span>
            </div>
        </div>
        <div class="loading" id="loading">Loading Module Federation Dependency Graph...</div>
        <script>
            // Store the graph data
            const graphRawData = ${JSON.stringify(d3GraphData)};
            // Check if we have data
            if (graphRawData.nodes.length === 0) {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('no-data').style.display = 'block';
            } else {
                // Load D3.js from CDN
                loadD3();
            }
            // Function to load D3.js from CDN
            function loadD3() {
                console.log("Loading D3.js from CDN...");
                const d3Script = document.createElement('script');
                d3Script.src = 'https://d3js.org/d3.v7.min.js';
                d3Script.onload = () => { 
                    console.log("D3.js loaded successfully");
                    initializeGraph(); 
                };
                d3Script.onerror = (error) => {
                    showError("Failed to load D3.js library. Please check your internet connection.");
                    console.error("D3 load error:", error);
                };
                document.head.appendChild(d3Script);
            }
            // Error handling function
            function showError(message) {
                document.getElementById('loading').style.display = 'none';
                const errorElement = document.getElementById('error-message');
                errorElement.textContent = message;
                errorElement.style.display = 'block';
                // Send error to extension
                try {
                    acquireVsCodeApi().postMessage({
                        command: 'error',
                        text: message
                    });
                } catch (err) {
                    console.error("Failed to communicate with VS Code extension:", err);
                }
            }
            // Function to initialize the graph once D3 is loaded
            function initializeGraph() {
                try {
                    // Hide the loading message
                    document.getElementById('loading').style.display = 'none';
                    // Create the graph data structure
                    const graphData = {
                        nodes: graphRawData.nodes,
                        links: graphRawData.links
                    };
                    console.log("Graph data for D3:", JSON.stringify(graphData));
                    const width = window.innerWidth;
                    const height = window.innerHeight;
                    // Create the SVG container
                    const svg = d3.select('#graph-container')
                        .append('svg')
                        .attr('width', width)
                        .attr('height', height);
                    // Create a group for the graph
                    const g = svg.append('g');
                    // Add arrow marker definition
                    svg.append("defs").append("marker")
                        .attr("id", "arrow")
                        .attr("viewBox", "0 -5 10 10")
                        .attr("refX", 35)
                        .attr("refY", 0)
                        .attr("markerWidth", 6)
                        .attr("markerHeight", 6)
                        .attr("orient", "auto")
                        .append("path")
                        .attr("d", "M0,-5L10,0L0,5")
                        .attr("fill", "#9E9E9E"); /* Match link color */
                    // Create a zoom behavior
                    const zoom = d3.zoom()
                        .scaleExtent([0.1, 4])
                        .on('zoom', (event) => {
                            g.attr('transform', event.transform);
                        });
                    // Apply zoom behavior to SVG
                    svg.call(zoom);
                    // Create a force simulation
                    const simulation = d3.forceSimulation(graphData.nodes)
                        .force('link', d3.forceLink(graphData.links)
                            .id(d => d.id)
                            .distance(150))
                        .force('charge', d3.forceManyBody().strength(-200))
                        .force('center', d3.forceCenter(width / 2, height / 2))
                        .force('collide', d3.forceCollide().radius(60));
                    // Draw edges
                    const edges = g.selectAll('.edge')
                        .data(graphData.links)
                        .enter()
                        .append('line')
                        .attr('class', 'edge')
                        .attr('marker-end', 'url(#arrow)');
                    // Add edge labels if they exist
                    const edgeLabels = g.selectAll('.edge-label')
                        .data(graphData.links.filter(d => d.label))
                        .enter()
                        .append('text')
                        .attr('class', 'edge-label')
                        .text(d => d.label);
                    // Create node groups
                    const nodeGroups = g.selectAll('.node')
                        .data(graphData.nodes)
                        .enter()
                        .append('g')
                        .attr('class', 'node')
                        .call(d3.drag()
                            .on('start', dragstarted)
                            .on('drag', dragged)
                            .on('end', dragended));
                    // Add circles for nodes
                    nodeGroups.append('circle')
                        .attr('r', 25)
                        .attr('class', d => d.type === 'host' ? 'host-node' : 'remote-node')
                        .on('mouseover', showTooltip)
                        .on('mouseout', hideTooltip);
                    // Add labels to nodes
                    nodeGroups.append('text')
                        .attr('class', 'node-label')
                        .attr('dy', 5)
                        .text(d => d.label.length > 10 ? d.label.substring(0, 10) + '...' : d.label);
                    // Define drag behavior
                    function dragstarted(event, d) {
                        if (!event.active) simulation.alphaTarget(0.3).restart();
                        d.fx = d.x;
                        d.fy = d.y;
                    }
                    function dragged(event, d) {
                        d.fx = event.x;
                        d.fy = event.y;
                    }
                    function dragended(event, d) {
                        if (!event.active) simulation.alphaTarget(0);
                    }
                    // Define tooltip behavior
                    function showTooltip(event, d) {
                        const tooltip = d3.select('#tooltip');
                        tooltip.style('opacity', 1)
                            .html(\`<div><strong>\${d.label}</strong></div>
                                <div>Type: \${d.type}</div>
                                <div>Config Type: \${d.configType}</div>\`)
                            .style('left', (event.pageX + 15) + 'px')
                            .style('top', (event.pageY - 30) + 'px');
                    }
                    function hideTooltip() {
                        d3.select('#tooltip').style('opacity', 0);
                    }
                    // Update positions on each tick of the simulation
                    simulation.on('tick', () => {
                        edges
                            .attr('x1', d => d.source.x)
                            .attr('y1', d => d.source.y)
                            .attr('x2', d => d.target.x)
                            .attr('y2', d => d.target.y);
                        edgeLabels
                            .attr('x', d => (d.source.x + d.target.x) / 2)
                            .attr('y', d => (d.source.y + d.target.y) / 2);
                        nodeGroups.attr('transform', d => \`translate(\${d.x}, \${d.y})\`);
                    });
                    // Notify extension that graph loaded successfully
                    try {
                        acquireVsCodeApi().postMessage({
                            command: 'loaded'
                        });
                    } catch (err) {
                        console.warn("Failed to communicate with VS Code extension:", err);
                    }
                } catch (error) {
                    showError("Error initializing graph: " + error.message);
                    console.error("Graph initialization error:", error);
                }
            }
        </script>
    </body>
    </html>`;
    }
} 