import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { 
  DependencyGraph, 
  DependencyGraphNode, 
  DependencyGraphEdge, 
  Remote, 
  ModuleFederationConfig,
  SharedDependency
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
    console.log(`[Graph] Starting dependency graph generation with ${configs.size} root paths:`, 
      Array.from(configs.entries()).map(([path, cfgs]) => ({
        path,
        configCount: cfgs.length,
        configs: cfgs.map(c => ({
          name: c.name,
          type: c.configType,
          remotes: c.remotes.length,
          exposes: c.exposes.length,
          shared: c.shared.length
        }))
      }))
    );
    const graph: DependencyGraph = {
      nodes: [],
      edges: [],
      sharedDependencies: [],
      metadata: {
        totalHosts: 0,
        totalRemotes: 0,
        totalSharedDeps: 0,
        totalExposedModules: 0
      }
    };
    
    const nodeMap = new Map<string, DependencyGraphNode>();
    const exposedModulesMap = new Map<string, string[]>(); // Track exposed modules per app
    const remoteToHostMap = new Map<string, string[]>(); // Track which hosts consume each remote
    const appCapabilities = new Map<string, { isHost: boolean; isRemote: boolean; config: ModuleFederationConfig }>(); // Track app capabilities
    
    // First pass: Analyze all applications to determine their capabilities (host, remote, or both)
    configs.forEach((rootConfigs, rootPath) => {
      rootConfigs.forEach(config => {
        // Skip configurations without names
        if (!config.name || config.name.trim() === '') {
          console.log(`[Graph] ⚠️  Skipping config without name in ${rootPath}:`, config);
          return;
        }
        const rootPathHash = this.hashPath(rootPath);
        const appId = `${rootPathHash}-${config.name}-${config.configType}`;
        
        // Revised logic for Module Federation roles:
        // - Host: Consumes remotes (has remotes array) 
        // - Remote: Exposes modules to be consumed by others (has exposes array)
        // - Bidirectional: Both consumes remotes AND exposes modules
        const hasRemotes = config.remotes.length > 0;
        const hasExposes = config.exposes.length > 0;
        
        // Determine roles based on actual capabilities
        const isHost = hasRemotes; // Only true hosts consume remotes
        const isRemote = hasExposes; // Only true remotes expose modules
        const isBidirectional = hasRemotes && hasExposes; // Both consume and expose
        
        // If app has neither remotes nor exposes, treat it as a standalone host
        const isStandaloneHost = !hasRemotes && !hasExposes;
        
        appCapabilities.set(appId, {
          isHost: isHost || isStandaloneHost || isBidirectional,
          isRemote: isRemote || isBidirectional,
          config
        });
        
        console.log(`[Graph] App '${config.name}' capabilities:`, {
          isHost: isHost || isStandaloneHost || isBidirectional,
          isRemote: isRemote || isBidirectional,
          isBidirectional,
          isStandaloneHost,
          hasRemotes,
          hasExposes,
          remotesCount: config.remotes.length,
          exposesCount: config.exposes.length,
          sharedCount: config.shared.length,
          configType: config.configType,
          role: isBidirectional ? 'bidirectional' : (isHost ? 'host' : (isRemote ? 'remote' : 'standalone'))
        });
        
        // Track exposed modules for later reference
        if (config.exposes.length > 0) {
          exposedModulesMap.set(appId, config.exposes.map(e => e.name));
        }
      });
    });
    
    // Second pass: Create unified nodes based on capabilities and track relationships
    appCapabilities.forEach((capabilities, appId) => {
      const { isHost, isRemote, config } = capabilities;
      
      // Determine basic capabilities
      const hasRemotes = config.remotes.length > 0;
      const hasExposes = config.exposes.length > 0;
      
      // Check if this app is being consumed as a remote by other apps
      const isConsumedAsRemote = remoteToHostMap.has(appId);
      
      // True bidirectional: has remotes/exposes AND is consumed by others
      const isBidirectional = (hasRemotes || hasExposes) && isConsumedAsRemote;
      
      // Determine the primary type
      let nodeType: 'host' | 'remote';
      let nodeGroup: string;
      
      if (isBidirectional) {
        // True bidirectional app (has capabilities AND is consumed by others)
        nodeType = 'host'; 
        nodeGroup = 'bidirectional';
      } else if (hasRemotes && !hasExposes) {
        // Pure consumer host (only consumes)
        nodeType = 'host';
        nodeGroup = 'hosts';
      } else if (hasExposes && !hasRemotes) {
        // Provider host (only exposes - still a host that provides services)
        nodeType = 'host';
        nodeGroup = 'hosts';
      } else {
        // Standalone app (neither consumes nor exposes)
        nodeType = 'host';
        nodeGroup = 'hosts';
      }
      
      console.log(`[Graph] App '${config.name}' node type determination:`, {
        isHost,
        isRemote,
        nodeType,
        nodeGroup,
        hasRemotes,
        hasExposes,
        isConsumedAsRemote,
        isBidirectional,
        remotesCount: config.remotes.length,
        exposesCount: config.exposes.length,
        sharedCount: config.shared.length,
        reason: isBidirectional 
          ? `bidirectional: has capabilities (${hasRemotes ? 'remotes' : ''}${hasRemotes && hasExposes ? '+' : ''}${hasExposes ? 'exposes' : ''}) AND is consumed by ${remoteToHostMap.get(appId)?.length || 0} other apps`
          : hasRemotes 
            ? `consumer host: consumes ${config.remotes.length} remotes`
            : hasExposes
              ? `provider host: exposes ${config.exposes.length} modules`
              : 'standalone host (no remotes or exposes)'
      });
      
      // Create a single unified node for this application
      const appNode: DependencyGraphNode = {
        id: appId,
        label: config.name,
        type: nodeType,
        configType: config.configType,
        exposedModules: hasExposes ? config.exposes.map(e => e.name) : undefined,
        sharedDependencies: config.shared.map(s => s.name),
        size: Math.max(1, config.remotes.length + config.exposes.length + config.shared.length),
        group: nodeGroup
      };
      
      nodeMap.set(appId, appNode);
      graph.nodes.push(appNode);
      
      // Update metadata based on capabilities
      if (isHost) {
        graph.metadata!.totalHosts++;
      }
      if (isRemote) {
        graph.metadata!.totalRemotes++;
      }
      if (config.exposes.length > 0) {
        graph.metadata!.totalExposedModules += config.exposes.length;
      }
      
      // Track remote consumption relationships
      config.remotes.forEach(remote => {
        // Find if this remote exists as an application in our configurations
        const remoteAppId = this.findAppIdByName(remote.name, appCapabilities);
        
        console.log(`[Graph] Processing remote '${remote.name}' for app '${config.name}':`, {
          remoteAppId: remoteAppId ? 'found in workspace' : 'not in workspace',
          remoteUrl: remote.url,
          remoteConfigType: remote.configType
        });
        
        if (remoteAppId) {
          // This remote is another app in our workspace
          if (!remoteToHostMap.has(remoteAppId)) {
            remoteToHostMap.set(remoteAppId, []);
          }
          remoteToHostMap.get(remoteAppId)!.push(appId);
        } else {
          // This remote is not in our workspace - create a regular remote node for it
          const externalRemoteId = `external-${remote.name}`;
          if (!nodeMap.has(externalRemoteId)) {
            const externalRemoteNode: DependencyGraphNode = {
              id: externalRemoteId,
              label: remote.name,
              type: 'remote',
              configType: remote.configType || 'external',
              url: remote.url,
              size: 1,
              group: 'remotes'
            };
            nodeMap.set(externalRemoteId, externalRemoteNode);
            graph.nodes.push(externalRemoteNode);
            graph.metadata!.totalRemotes++;
          } else {
            // Update existing external remote with more information if available
            const existingNode = nodeMap.get(externalRemoteId)!;
            if (remote.url && !existingNode.url) {
              existingNode.url = remote.url;
            }
            if (remote.configType && existingNode.configType !== remote.configType) {
              existingNode.configType = remote.configType;
            }
            // Increment size to reflect multiple consumers
            existingNode.size = (existingNode.size || 1) + 1;
          }
          
          // Track the relationship
          if (!remoteToHostMap.has(externalRemoteId)) {
            remoteToHostMap.set(externalRemoteId, []);
          }
          remoteToHostMap.get(externalRemoteId)!.push(appId);
        }
      });
    });
    
    // Third pass: Create consolidated consumption edges (avoid overlapping bidirectional edges)
    const edgeMap = new Map<string, DependencyGraphEdge>(); // Track unique edges
    const processedPairs = new Set<string>(); // Track processed node pairs
    
    remoteToHostMap.forEach((hostIds, remoteId) => {
      hostIds.forEach(hostId => {
        const hostNode = nodeMap.get(hostId);
        const remoteNode = nodeMap.get(remoteId);
        
        if (hostNode && remoteNode) {
          // Create a unique pair identifier (always use lexicographically smaller ID first)
          const pairId = hostId < remoteId ? `${hostId}-${remoteId}` : `${remoteId}-${hostId}`;
          
          // Skip if we've already processed this pair
          if (processedPairs.has(pairId)) {
            return;
          }
          
          // Check if this is a bidirectional relationship
          const isHostAlsoRemote = remoteToHostMap.has(hostId) && remoteToHostMap.get(hostId)!.includes(remoteId);
          
          // Find the specific remote configuration for edge labeling
          const hostConfig = appCapabilities.get(hostId)?.config;
          const remoteConfig = hostConfig?.remotes.find(r => 
            this.findAppIdByName(r.name, appCapabilities) === remoteId || 
            `external-${r.name}` === remoteId
          );
          
          // Ensure remote node has proper URL information
          if (remoteConfig?.url && !remoteNode.url) {
            remoteNode.url = remoteConfig.url;
          }
          
          let edge: DependencyGraphEdge;
          
          if (isHostAlsoRemote) {
            // Bidirectional relationship - create a single bidirectional edge
            edge = {
            from: hostId,
              to: remoteId,
              type: 'consumes',
              label: `↔ ${remoteConfig?.url || remoteNode.url || remoteNode.label}`,
              strength: 1.5, // Stronger connection for bidirectional
              bidirectional: true
            };
            
            console.log(`[Graph] Created bidirectional consume edge: ${hostNode.label} ↔ ${remoteNode.label}`);
          } else {
            // Unidirectional relationship
            edge = {
              from: hostId,
              to: remoteId,
              type: 'consumes',
              label: remoteConfig?.url || remoteNode.url || remoteNode.label,
              strength: 1,
              bidirectional: false
            };
            
            console.log(`[Graph] Created unidirectional consume edge: ${hostNode.label} → ${remoteNode.label}`);
          }
          
          // Add the edge and mark this pair as processed
          graph.edges.push(edge);
          processedPairs.add(pairId);
        }
        });
      });
    
    // Fourth pass: Create exposed module nodes for applications that expose modules
    exposedModulesMap.forEach((moduleNames, appId) => {
      const appNode = nodeMap.get(appId);
      if (appNode) {
        moduleNames.forEach(moduleName => {
          const moduleId = `${appId}-module-${moduleName}`;
          
          const moduleNode: DependencyGraphNode = {
            id: moduleId,
            label: moduleName,
            type: 'exposed-module',
            configType: appNode.configType,
            size: remoteToHostMap.get(appId)?.length || 1,
            group: appId
          };
          
          nodeMap.set(moduleId, moduleNode);
          graph.nodes.push(moduleNode);
          
          // Add expose edge
          const exposeEdge: DependencyGraphEdge = {
            from: appId,
            to: moduleId,
            type: 'exposes',
            label: moduleName,
            strength: 1
          };
          
          graph.edges.push(exposeEdge);
        });
      }
    });
    
    // Fifth pass: Create shared dependency nodes from actual configurations
    const sharedDepsMap = new Map<string, Set<string>>(); // Track which apps share each dependency
    
    // Collect all shared dependencies from configurations
    appCapabilities.forEach((capabilities, appId) => {
      console.log(`[Graph] Processing shared deps for app '${capabilities.config.name}':`, {
        appId,
        sharedDeps: capabilities.config.shared.map(s => s.name),
        sharedCount: capabilities.config.shared.length
      });
      
      capabilities.config.shared.forEach(sharedDep => {
        if (!sharedDepsMap.has(sharedDep.name)) {
          sharedDepsMap.set(sharedDep.name, new Set());
        }
        sharedDepsMap.get(sharedDep.name)!.add(appId);
      });
    });
    
    console.log(`[Graph] Shared dependencies map:`, Array.from(sharedDepsMap.entries()).map(([depName, appIds]) => ({
      dependency: depName,
      usedByApps: Array.from(appIds).map(appId => {
        const app = Array.from(appCapabilities.entries()).find(([id]) => id === appId);
        return app ? app[1].config.name : appId;
      }),
      count: appIds.size
    })));
    
    // Create shared dependency nodes for dependencies used by multiple apps
    sharedDepsMap.forEach((hostIds, depName) => {
      if (hostIds.size > 1 && depName !== '[DYNAMIC_SHARED]') {
        console.log(`[Graph] Creating shared dependency node for '${depName}' used by ${hostIds.size} apps:`, 
          Array.from(hostIds).map(appId => {
            const app = Array.from(appCapabilities.entries()).find(([id]) => id === appId);
            return app ? app[1].config.name : appId;
          })
        );
        
        const sharedDepId = `shared-${depName}`;
        
        // Find the most detailed shared dependency configuration
        let sharedDepConfig: SharedDependency | undefined;
        appCapabilities.forEach((capabilities) => {
          const foundShared = capabilities.config.shared.find(s => s.name === depName);
          if (foundShared && (!sharedDepConfig || Object.keys(foundShared).length > Object.keys(sharedDepConfig).length)) {
            sharedDepConfig = foundShared;
          }
        });
        
        const sharedDepNode: DependencyGraphNode = {
          id: sharedDepId,
          label: depName,
          type: 'shared-dependency',
          configType: 'webpack',
          size: hostIds.size,
          group: 'shared',
          version: sharedDepConfig?.version,
          sharedDependencies: [depName]
        };
        
        nodeMap.set(sharedDepId, sharedDepNode);
        graph.nodes.push(sharedDepNode);
        graph.metadata!.totalSharedDeps++;
        
        // Add sharing edges to all apps that use this dependency
        hostIds.forEach(hostId => {
          const hostNode = nodeMap.get(hostId);
          if (hostNode) {
            const shareEdge: DependencyGraphEdge = {
              from: hostId,
              to: sharedDepId,
              type: 'shares',
              label: depName,
              strength: 0.5,
              bidirectional: true
            };
            graph.edges.push(shareEdge);
            
            console.log(`[Graph] Created sharing edge: ${hostNode.label} ↔ ${depName}`);
          }
        });
      } else {
        console.log(`[Graph] Skipping shared dependency '${depName}' - used by ${hostIds.size} apps (need 2+)`);
      }
    });
    
    // Update final metadata with accurate counts
    let consumerHosts = 0;
    let providerHosts = 0;
    let bidirectionalApps = 0;
    let standaloneApps = 0;
    
    appCapabilities.forEach((capabilities) => {
      const hasRemotes = capabilities.config.remotes.length > 0;
      const hasExposes = capabilities.config.exposes.length > 0;
      
      if (hasRemotes && hasExposes) {
        bidirectionalApps++;
      } else if (hasRemotes && !hasExposes) {
        consumerHosts++;
      } else if (!hasRemotes && hasExposes) {
        providerHosts++;
      } else {
        standaloneApps++;
      }
    });
    
    // Set metadata based on actual app types
    // All workspace apps are now hosts (consumer, provider, bidirectional, or standalone)
    graph.metadata!.totalHosts = consumerHosts + providerHosts + bidirectionalApps + standaloneApps;
    // Only external remotes count as remotes
    graph.metadata!.totalRemotes = graph.nodes.filter(n => n.group === 'remotes' && n.id.startsWith('external-')).length;
    
    // Debug log the enhanced graph data
    console.log(`Generated bidirectional-aware dependency graph:`, {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      consumerHosts,
      providerHosts,
      bidirectionalApps,
      standaloneApps,
      externalRemotes: graph.nodes.filter(n => n.group === 'remotes' && n.id.startsWith('external-')).length,
      totalHosts: graph.metadata!.totalHosts,
      totalRemotes: graph.metadata!.totalRemotes,
      sharedDeps: graph.metadata!.totalSharedDeps,
      exposedModules: graph.metadata!.totalExposedModules
    });
    
    // Debug: Show all created nodes and their types
    console.log(`[Graph] Created nodes:`, graph.nodes.map(node => ({
      label: node.label,
      type: node.type,
      group: node.group,
      size: node.size
    })));
    
    return graph;
  }

  /**
   * Helper method to find an application ID by its name
   */
  private findAppIdByName(appName: string, appCapabilities: Map<string, { isHost: boolean; isRemote: boolean; config: ModuleFederationConfig }>): string | undefined {
    // First try exact match
    for (const [appId, capabilities] of appCapabilities.entries()) {
      if (capabilities.config.name === appName) {
        return appId;
      }
    }
    
    // Try case-insensitive match
    const lowerAppName = appName.toLowerCase();
    for (const [appId, capabilities] of appCapabilities.entries()) {
      if (capabilities.config.name.toLowerCase() === lowerAppName) {
        return appId;
      }
    }
    
    // Try partial match (for cases where remote name might be a subset)
    for (const [appId, capabilities] of appCapabilities.entries()) {
      const configName = capabilities.config.name.toLowerCase();
      if (configName.includes(lowerAppName) || lowerAppName.includes(configName)) {
        return appId;
      }
    }
    
    return undefined;
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
              console.log("Enhanced dependency graph loaded successfully");
              if (message.metadata) {
                console.log("Graph metadata:", message.metadata);
              }
              break;
            case 'nodeClick':
              this.handleNodeClick(message.node);
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
   * Handle node click events from the webview
   */
  private handleNodeClick(node: DependencyGraphNode): void {
    console.log('Node clicked in graph:', node);
    
    // Show information about the clicked node
    const nodeType = node.type.replace('-', ' ');
    let message = `**${node.label}** (${nodeType})\n\n`;
    message += `**Config Type:** ${node.configType}\n`;
    
    if (node.url) {
      message += `**URL:** ${node.url}\n`;
    }
    
    if (node.version) {
      message += `**Version:** ${node.version}\n`;
    }
    
    if (node.exposedModules && node.exposedModules.length > 0) {
      message += `**Exposed Modules:** ${node.exposedModules.join(', ')}\n`;
    }
    
    if (node.sharedDependencies && node.sharedDependencies.length > 0) {
      message += `**Shared Dependencies:** ${node.sharedDependencies.join(', ')}\n`;
    }
    
    if (node.size && node.size > 1) {
      message += `**Connections:** ${node.size}\n`;
    }
    
    if (node.status) {
      message += `**Status:** ${node.status}\n`;
    }
    
    if (node.group) {
      message += `**Group:** ${node.group}\n`;
    }
    
    // Show the information in a VS Code information message
    vscode.window.showInformationMessage(
      `Module Federation Node: ${node.label}`,
      { modal: false, detail: message }
    );
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
        label: edge.label,
        type: edge.type,
        strength: edge.strength || 1,
        bidirectional: edge.bidirectional || false
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
                font-family: var(--vscode-font-family);
            }
            #graph-container {
                width: 100%;
                height: 100vh;
                background-color: var(--vscode-editor-background);
                position: relative;
            }
            
            /* Enhanced Node Styles */
            .host-node {
                fill: #007ACC;
                stroke: #005A9C;
                stroke-width: 3px;
            }
            .remote-node {
                fill: #6F42C1;
                stroke: #4B2882;
                stroke-width: 2px;
            }
            .bidirectional-node {
                fill: url(#bidirectionalGradient);
                stroke: #FF6B35;
                stroke-width: 3px;
            }
            .external-remote-node {
                fill: #DC3545;
                stroke: #C82333;
                stroke-width: 2px;
                opacity: 0.8;
            }
            .shared-dependency-node {
                fill: #28A745;
                stroke: #1E7E34;
                stroke-width: 2px;
            }
            .exposed-module-node {
                fill: #FD7E14;
                stroke: #E55100;
                stroke-width: 1px;
            }
            
            /* Node hover effects */
            .node:hover circle {
                stroke-width: 4px !important;
                filter: brightness(1.2);
            }
            
            /* Enhanced Link Styles */
            .edge {
                stroke-width: 1.5px;
                fill: none;
            }
            .edge.consumes {
                stroke: #007ACC;
                stroke-dasharray: none;
            }
            .edge.consumes.bidirectional {
                stroke: #FF6B35;
                stroke-width: 2.5px;
                stroke-dasharray: none;
            }
            .edge.exposes {
                stroke: #FD7E14;
                stroke-dasharray: 5,5;
            }
            .edge.shares {
                stroke: #28A745;
                stroke-dasharray: 3,3;
                opacity: 0.7;
            }
            .edge.depends-on {
                stroke: #6C757D;
                stroke-dasharray: 2,2;
            }
            .edge:hover {
                stroke-width: 3px !important;
                opacity: 1 !important;
            }
            
            /* Node Labels */
            .node-label {
                fill: #FFFFFF;
                font-family: var(--vscode-font-family);
                font-size: 11px;
                text-anchor: middle;
                pointer-events: none;
                font-weight: 500;
            }
            
            /* Edge Labels */
            .edge-label {
                fill: var(--vscode-editor-foreground);
                font-family: var(--vscode-font-family);
                font-size: 9px;
                text-anchor: middle;
                pointer-events: none;
                opacity: 0.8;
            }
            
            /* Enhanced Tooltip */
            .tooltip {
                position: absolute;
                background: var(--vscode-editor-widget-background);
                border: 1px solid var(--vscode-widget-border);
                padding: 12px;
                border-radius: 6px;
                font-family: var(--vscode-font-family);
                font-size: 12px;
                color: var(--vscode-editor-foreground);
                z-index: 100;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.2s;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                max-width: 300px;
            }
            .tooltip h4 {
                margin: 0 0 8px 0;
                color: var(--vscode-textLink-foreground);
            }
            .tooltip .detail {
                margin: 4px 0;
                font-size: 11px;
                opacity: 0.9;
            }
            
            /* Enhanced Legend */
            .legend {
                position: absolute;
                top: 20px;
                right: 20px;
                background: var(--vscode-editor-widget-background);
                border: 1px solid var(--vscode-widget-border);
                padding: 16px;
                border-radius: 6px;
                font-family: var(--vscode-font-family);
                font-size: 12px;
                color: var(--vscode-editor-foreground);
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                min-width: 220px;
                max-width: 280px;
            }
            .legend h3 {
                margin: 0 0 12px 0;
                font-size: 14px;
                color: var(--vscode-textLink-foreground);
            }
            .legend-section {
                margin-bottom: 18px;
            }
            .legend-section:last-child {
                margin-bottom: 0;
            }
            .legend-section h4 {
                margin: 0 0 10px 0;
                font-size: 11px;
                text-transform: uppercase;
                opacity: 0.8;
                font-weight: 600;
                border-bottom: 1px solid var(--vscode-widget-border);
                padding-bottom: 4px;
            }
            .legend-item {
                display: flex;
                align-items: flex-start;
                margin-bottom: 12px;
                min-height: 24px;
                line-height: 1.4;
                clear: both;
            }
            .legend-item small {
                opacity: 0.7;
                font-size: 10px;
                margin-left: 4px;
                white-space: nowrap;
            }
            .legend-color {
                width: 16px;
                height: 16px;
                margin-right: 10px;
                margin-top: 2px;
                border-radius: 50%;
                border: 2px solid;
                flex-shrink: 0;
            }
            .host-color {
                background-color: #007ACC;
                border-color: #005A9C;
            }
            .remote-color {
                background-color: #6F42C1;
                border-color: #4B2882;
            }
            .bidirectional-color {
                background: #007ACC;
                border: 2px solid #6F42C1;
                box-shadow: 0 0 0 1px #FF6B35;
                position: relative;
                display: inline-block;
            }
            .external-color {
                background-color: #DC3545;
                border-color: #C82333;
            }
            .shared-color {
                background-color: #28A745;
                border-color: #1E7E34;
            }
            .module-color {
                background-color: #FD7E14;
                border-color: #E55100;
            }
            .legend-line {
                width: 20px;
                height: 2px;
                margin-right: 8px;
                border-radius: 1px;
            }
            .consumes-line {
                background-color: #007ACC;
            }
            .bidirectional-consumes-line {
                background-color: #FF6B35;
                height: 3px;
            }
            .exposes-line {
                background-color: #FD7E14;
                background-image: repeating-linear-gradient(90deg, transparent, transparent 3px, #FFF 3px, #FFF 6px);
            }
            .shares-line {
                background-color: #28A745;
                background-image: repeating-linear-gradient(90deg, transparent, transparent 2px, #FFF 2px, #FFF 4px);
            }
            
            /* Controls */
            .controls {
                position: absolute;
                top: 20px;
                left: 20px;
                background: var(--vscode-editor-widget-background);
                border: 1px solid var(--vscode-widget-border);
                padding: 10px;
                border-radius: 6px;
                font-family: var(--vscode-font-family);
                font-size: 12px;
            }
            .control-button {
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                padding: 6px 12px;
                margin: 2px;
                border-radius: 3px;
                cursor: pointer;
                font-size: 11px;
            }
            .control-button:hover {
                background: var(--vscode-button-hoverBackground);
            }
            
            /* Stats Panel */
            .stats {
                position: absolute;
                bottom: 20px;
                left: 20px;
                background: var(--vscode-editor-widget-background);
                border: 1px solid var(--vscode-widget-border);
                padding: 10px;
                border-radius: 6px;
                font-family: var(--vscode-font-family);
                font-size: 11px;
                color: var(--vscode-editor-foreground);
            }
            .stats .stat-item {
                margin: 2px 0;
            }
            .stats .stat-value {
                font-weight: bold;
                color: var(--vscode-textLink-foreground);
            }
            
            /* Loading and Error States */
            .loading {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                font-family: var(--vscode-font-family);
                font-size: 16px;
                color: var(--vscode-editor-foreground);
            }
            #error-message {
                color: var(--vscode-errorForeground);
                text-align: center;
                margin-top: 20px;
                display: none;
            }
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
        
        <div class="controls">
            <button class="control-button" onclick="resetZoom()">Reset View</button>
            <button class="control-button" onclick="togglePhysics()">Toggle Physics</button>
            <button class="control-button" onclick="exportGraph()">Export</button>
        </div>
        
        <div class="legend">
            <h3>Module Federation Graph</h3>
            <div class="legend-section">
                <h4>Node Types</h4>
            <div class="legend-item">
                <div class="legend-color host-color"></div>
                <span>Host Application<br><small>(Workspace Apps)</small></span>
            </div>
            <div class="legend-item">
                <div class="legend-color remote-color"></div>
                <span>Remote Module<br><small>(External Apps)</small></span>
            </div>
            <div class="legend-item">
                <div class="legend-color bidirectional-color"></div>
                <span>Bidirectional App<br><small>(Host + Consumed as Remote)</small></span>
            </div>
            <div class="legend-item">
                <div class="legend-color external-color"></div>
                <span>External Remote</span>
            </div>
            <div class="legend-item">
                <div class="legend-color shared-color"></div>
                <span>Shared Dependency</span>
            </div>
            <div class="legend-item">
                <div class="legend-color module-color"></div>
                <span>Exposed Module</span>
            </div>
            </div>
            <div class="legend-section">
                <h4>Relationships</h4>
                <div class="legend-item">
                    <div class="legend-line consumes-line"></div>
                    <span>Consumes</span>
                </div>
                <div class="legend-item">
                    <div class="legend-line bidirectional-consumes-line"></div>
                    <span>Bidirectional Consumes</span>
                </div>
                <div class="legend-item">
                    <div class="legend-line exposes-line"></div>
                    <span>Exposes</span>
                </div>
                <div class="legend-item">
                    <div class="legend-line shares-line"></div>
                    <span>Shares</span>
                </div>
            </div>
        </div>
        
        <div class="stats">
            <div class="stat-item">Hosts: <span class="stat-value" id="stat-hosts">0</span></div>
            <div class="stat-item">Remotes: <span class="stat-value" id="stat-remotes">0</span></div>
            <div class="stat-item">Bidirectional: <span class="stat-value" id="stat-bidirectional">0</span></div>
            <div class="stat-item">External: <span class="stat-value" id="stat-external">0</span></div>
            <div class="stat-item">Shared Deps: <span class="stat-value" id="stat-shared">0</span></div>
            <div class="stat-item">Modules: <span class="stat-value" id="stat-modules">0</span></div>
        </div>
        
        <div class="loading" id="loading">Loading Enhanced Module Federation Graph...</div>
        <script>
            // Store the graph data
            const graphRawData = ${JSON.stringify(d3GraphData)};
            let simulation;
            let svg, g, zoom;
            let physicsEnabled = true;
            
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
            
            // Control functions
            function resetZoom() {
                if (svg && zoom) {
                    svg.transition().duration(750).call(
                        zoom.transform,
                        d3.zoomIdentity
                    );
                }
            }
            
            function togglePhysics() {
                physicsEnabled = !physicsEnabled;
                if (simulation) {
                    if (physicsEnabled) {
                        simulation.alpha(0.3).restart();
                    } else {
                        simulation.stop();
                    }
                }
            }
            
            function exportGraph() {
                // Simple export functionality
                const graphData = {
                    nodes: graphRawData.nodes,
                    links: graphRawData.links,
                    metadata: ${JSON.stringify(graph.metadata || {})}
                };
                const dataStr = JSON.stringify(graphData, null, 2);
                const dataBlob = new Blob([dataStr], {type: 'application/json'});
                const url = URL.createObjectURL(dataBlob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'module-federation-graph.json';
                link.click();
                URL.revokeObjectURL(url);
            }
            
            // Function to update statistics
            function updateStats(nodes) {
                const stats = {
                    hosts: nodes.filter(n => n.type === 'host').length,
                    remotes: nodes.filter(n => n.type === 'remote').length,
                    bidirectional: nodes.filter(n => n.group === 'bidirectional').length,
                    external: nodes.filter(n => n.group === 'remotes' && n.id.startsWith('external-')).length,
                    shared: nodes.filter(n => n.type === 'shared-dependency').length,
                    modules: nodes.filter(n => n.type === 'exposed-module').length
                };
                
                document.getElementById('stat-hosts').textContent = stats.hosts;
                document.getElementById('stat-remotes').textContent = stats.remotes;
                document.getElementById('stat-bidirectional').textContent = stats.bidirectional;
                document.getElementById('stat-external').textContent = stats.external;
                document.getElementById('stat-shared').textContent = stats.shared;
                document.getElementById('stat-modules').textContent = stats.modules;
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
                    
                    console.log("Enhanced graph data for D3:", JSON.stringify(graphData));
                    updateStats(graphData.nodes);
                    
                    const width = window.innerWidth;
                    const height = window.innerHeight;
                    
                    // Create the SVG container
                    svg = d3.select('#graph-container')
                        .append('svg')
                        .attr('width', width)
                        .attr('height', height);
                    
                    // Create a group for the graph
                    g = svg.append('g');
                    
                    // Add enhanced arrow markers for different edge types
                    const defs = svg.append("defs");
                    
                    // Add gradient for bidirectional nodes
                    const gradient = defs.append("linearGradient")
                        .attr("id", "bidirectionalGradient")
                        .attr("x1", "0%")
                        .attr("y1", "0%")
                        .attr("x2", "100%")
                        .attr("y2", "100%");
                    
                    gradient.append("stop")
                        .attr("offset", "0%")
                        .attr("stop-color", "#007ACC")
                        .attr("stop-opacity", 1);
                    
                    gradient.append("stop")
                        .attr("offset", "100%")
                        .attr("stop-color", "#6F42C1")
                        .attr("stop-opacity", 1);
                    
                    // Consumes arrow
                    defs.append("marker")
                        .attr("id", "arrow-consumes")
                        .attr("viewBox", "0 -5 10 10")
                        .attr("refX", 30)
                        .attr("refY", 0)
                        .attr("markerWidth", 6)
                        .attr("markerHeight", 6)
                        .attr("orient", "auto")
                        .append("path")
                        .attr("d", "M0,-5L10,0L0,5")
                        .attr("fill", "#007ACC");
                    
                    // Exposes arrow
                    defs.append("marker")
                        .attr("id", "arrow-exposes")
                        .attr("viewBox", "0 -5 10 10")
                        .attr("refX", 30)
                        .attr("refY", 0)
                        .attr("markerWidth", 6)
                        .attr("markerHeight", 6)
                        .attr("orient", "auto")
                        .append("path")
                        .attr("d", "M0,-5L10,0L0,5")
                        .attr("fill", "#FD7E14");
                    
                    // Shares arrow (bidirectional)
                    defs.append("marker")
                        .attr("id", "arrow-shares")
                        .attr("viewBox", "0 -5 10 10")
                        .attr("refX", 30)
                        .attr("refY", 0)
                        .attr("markerWidth", 5)
                        .attr("markerHeight", 5)
                        .attr("orient", "auto")
                        .append("path")
                        .attr("d", "M0,-5L10,0L0,5")
                        .attr("fill", "#28A745");
                    
                    // Bidirectional consume arrow
                    defs.append("marker")
                        .attr("id", "arrow-bidirectional")
                        .attr("viewBox", "0 -5 10 10")
                        .attr("refX", 30)
                        .attr("refY", 0)
                        .attr("markerWidth", 6)
                        .attr("markerHeight", 6)
                        .attr("orient", "auto")
                        .append("path")
                        .attr("d", "M0,-5L10,0L0,5")
                        .attr("fill", "#FF6B35");
                    
                    // Bidirectional start arrow (for the other end)
                    defs.append("marker")
                        .attr("id", "arrow-bidirectional-start")
                        .attr("viewBox", "0 -5 10 10")
                        .attr("refX", -20)
                        .attr("refY", 0)
                        .attr("markerWidth", 6)
                        .attr("markerHeight", 6)
                        .attr("orient", "auto")
                        .append("path")
                        .attr("d", "M10,-5L0,0L10,5")
                        .attr("fill", "#FF6B35");
                    
                    // Create a zoom behavior
                    zoom = d3.zoom()
                        .scaleExtent([0.1, 4])
                        .on('zoom', (event) => {
                            g.attr('transform', event.transform);
                        });
                    
                    // Apply zoom behavior to SVG
                    svg.call(zoom);
                    
                    // Create enhanced force simulation
                    simulation = d3.forceSimulation(graphData.nodes)
                        .force('link', d3.forceLink(graphData.links)
                            .id(d => d.id)
                            .distance(d => {
                                // Vary distance based on relationship type
                                switch(d.type) {
                                    case 'exposes': return 80;
                                    case 'shares': return 200;
                                    case 'consumes': return 150;
                                    default: return 120;
                                }
                            })
                            .strength(d => d.strength || 0.5))
                        .force('charge', d3.forceManyBody()
                            .strength(d => {
                                // Vary charge based on node type and size
                                const baseStrength = -300;
                                const sizeMultiplier = (d.size || 1) * 0.5;
                                return baseStrength * sizeMultiplier;
                            }))
                        .force('center', d3.forceCenter(width / 2, height / 2))
                        .force('collide', d3.forceCollide()
                            .radius(d => {
                                // Vary collision radius based on node size
                                const baseRadius = 30;
                                return baseRadius + (d.size || 1) * 5;
                            }))
                        .force('x', d3.forceX(width / 2).strength(0.1))
                        .force('y', d3.forceY(height / 2).strength(0.1));
                    
                    // Draw enhanced edges
                    const edges = g.selectAll('.edge')
                        .data(graphData.links)
                        .enter()
                        .append('line')
                        .attr('class', d => {
                            let classes = \`edge \${d.type || 'default'}\`;
                            if (d.bidirectional) {
                                classes += ' bidirectional';
                            }
                            return classes;
                        })
                        .attr('marker-end', d => {
                            if (d.bidirectional && d.type === 'consumes') {
                                return 'url(#arrow-bidirectional)';
                            }
                            switch(d.type) {
                                case 'consumes': return 'url(#arrow-consumes)';
                                case 'exposes': return 'url(#arrow-exposes)';
                                case 'shares': return 'url(#arrow-shares)';
                                default: return 'url(#arrow-consumes)';
                            }
                        })
                        .attr('marker-start', d => {
                            // Add start marker for bidirectional consume edges
                            if (d.bidirectional && d.type === 'consumes') {
                                return 'url(#arrow-bidirectional-start)';
                            }
                            return null;
                        })
                        .style('stroke-width', d => (d.strength || 1) * 2);
                    
                    // Add edge labels for important relationships
                    const edgeLabels = g.selectAll('.edge-label')
                        .data(graphData.links.filter(d => d.label && d.type !== 'shares'))
                        .enter()
                        .append('text')
                        .attr('class', 'edge-label')
                        .text(d => {
                            // Truncate long URLs
                            if (d.label && d.label.length > 30) {
                                return d.label.substring(0, 30) + '...';
                            }
                            return d.label;
                        });
                    
                    // Create enhanced node groups
                    const nodeGroups = g.selectAll('.node')
                        .data(graphData.nodes)
                        .enter()
                        .append('g')
                        .attr('class', 'node')
                        .call(d3.drag()
                            .on('start', dragstarted)
                            .on('drag', dragged)
                            .on('end', dragended));
                    
                    // Add enhanced circles for nodes with size variation
                    nodeGroups.append('circle')
                        .attr('r', d => {
                            // Vary radius based on node type and size
                            const baseRadius = {
                                'host': 30,
                                'remote': 25,
                                'shared-dependency': 20,
                                'exposed-module': 15
                            };
                            const base = baseRadius[d.type] || 20;
                            return base + Math.min((d.size || 1) * 2, 15);
                        })
                        .attr('class', d => {
                            // More precise node styling based on actual configuration
                            if (d.type === 'host' && d.group === 'bidirectional') {
                                return 'bidirectional-node';
                            } else if (d.type === 'host') {
                                return 'host-node';
                            } else if (d.type === 'remote') {
                                if (d.group === 'bidirectional') return 'bidirectional-node';
                                if (d.id.startsWith('external-')) return 'external-remote-node';
                                return 'remote-node';
                            } else if (d.type === 'shared-dependency') {
                                return 'shared-dependency-node';
                            } else if (d.type === 'exposed-module') {
                                return 'exposed-module-node';
                            } else {
                                return 'host-node';
                            }
                        })
                        .on('mouseover', showTooltip)
                        .on('mouseout', hideTooltip)
                        .on('click', nodeClick);
                    
                    // Add enhanced labels to nodes
                    nodeGroups.append('text')
                        .attr('class', 'node-label')
                        .attr('dy', 5)
                        .text(d => {
                            const maxLength = d.type === 'exposed-module' ? 8 : 12;
                            return d.label.length > maxLength ? 
                                d.label.substring(0, maxLength) + '...' : d.label;
                        });
                    
                    // Define enhanced drag behavior
                    function dragstarted(event, d) {
                        if (!event.active && physicsEnabled) simulation.alphaTarget(0.3).restart();
                        d.fx = d.x;
                        d.fy = d.y;
                    }
                    
                    function dragged(event, d) {
                        d.fx = event.x;
                        d.fy = event.y;
                    }
                    
                    function dragended(event, d) {
                        if (!event.active && physicsEnabled) simulation.alphaTarget(0);
                    }
                    
                    // Enhanced tooltip behavior
                    function showTooltip(event, d) {
                        const tooltip = d3.select('#tooltip');
                        let content = \`<h4>\${d.label}</h4>\`;
                        content += \`<div class="detail"><strong>Type:</strong> \${d.type.replace('-', ' ')}</div>\`;
                        content += \`<div class="detail"><strong>Config:</strong> \${d.configType}</div>\`;
                        
                        if (d.url) {
                            content += \`<div class="detail"><strong>URL:</strong> \${d.url}</div>\`;
                        }
                        if (d.version) {
                            content += \`<div class="detail"><strong>Version:</strong> \${d.version}</div>\`;
                        }
                        if (d.exposedModules && d.exposedModules.length > 0) {
                            content += \`<div class="detail"><strong>Exposes:</strong> \${d.exposedModules.join(', ')}</div>\`;
                        }
                        if (d.sharedDependencies && d.sharedDependencies.length > 0) {
                            content += \`<div class="detail"><strong>Shared Deps:</strong> \${d.sharedDependencies.join(', ')}</div>\`;
                        }
                        if (d.size && d.size > 1) {
                            content += \`<div class="detail"><strong>Connections:</strong> \${d.size}</div>\`;
                        }
                        if (d.status) {
                            content += \`<div class="detail"><strong>Status:</strong> \${d.status}</div>\`;
                        }
                        
                        tooltip.style('opacity', 1)
                            .html(content)
                            .style('left', (event.pageX + 15) + 'px')
                            .style('top', (event.pageY - 30) + 'px');
                    }
                    
                    function hideTooltip() {
                        d3.select('#tooltip').style('opacity', 0);
                    }
                    
                    function nodeClick(event, d) {
                        console.log('Node clicked:', d);
                        // Could send message to extension for navigation
                        try {
                            acquireVsCodeApi().postMessage({
                                command: 'nodeClick',
                                node: d
                            });
                        } catch (err) {
                            console.warn("Failed to communicate node click to extension:", err);
                        }
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
                    
                    // Handle window resize
                    window.addEventListener('resize', () => {
                        const newWidth = window.innerWidth;
                        const newHeight = window.innerHeight;
                        svg.attr('width', newWidth).attr('height', newHeight);
                        simulation.force('center', d3.forceCenter(newWidth / 2, newHeight / 2));
                        simulation.alpha(0.3).restart();
                    });
                    
                    // Notify extension that graph loaded successfully
                    try {
                        acquireVsCodeApi().postMessage({
                            command: 'loaded',
                            metadata: ${JSON.stringify(graph.metadata || {})}
                        });
                    } catch (err) {
                        console.warn("Failed to communicate with VS Code extension:", err);
                    }
                } catch (error) {
                    showError("Error initializing enhanced graph: " + error.message);
                    console.error("Graph initialization error:", error);
                }
            }
        </script>
    </body>
    </html>`;
    }
} 