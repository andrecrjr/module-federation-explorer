import type { ModuleFederationConfig, SharedDependency } from '../../federation/types';
import {
  AppCapability,
  DependencyGraph,
  DependencyGraphEdge,
  DependencyGraphNode,
  GraphDiagnostic,
  GraphGenerationResult
} from './types';

/**
 * Multi-pass graph generation algorithm.
 * Extracted from the original monolithic DependencyGraphManager.
 */
export class GraphGenerator {
  /**
   * Generate a dependency graph from the provided configurations.
   * Six-pass algorithm:
   *  1. Analyze capabilities (host, remote, bidirectional, standalone)
   *  2. Build remote consumption map
   *  3. Create unified nodes
   *  4. Create consolidated consumption edges
   *  5. Create exposed module nodes and expose edges
   *  6. Create shared dependency nodes and sharing edges
   */
  generate(configs: Map<string, ModuleFederationConfig[]>): GraphGenerationResult {
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
    const exposedModulesMap = new Map<string, string[]>();
    const remoteToHostMap = new Map<string, string[]>();
    const appCapabilities = new Map<string, AppCapability>();
    const diagnostics: GraphDiagnostic[] = [];

    // ── Pass 1: Analyze capabilities ──────────────────────────────
    this._pass1_analyzeCapabilities(configs, appCapabilities, exposedModulesMap, diagnostics);

    // ── Pass 2: Build remote consumption map ───────────────────────
    this._pass2_buildRemoteConsumptionMap(appCapabilities, nodeMap, graph, remoteToHostMap, diagnostics);

    // ── Pass 3: Create unified nodes ───────────────────────────────
    this._pass3_createUnifiedNodes(appCapabilities, remoteToHostMap, nodeMap, graph);

    // ── Pass 4: Create consolidated consumption edges ──────────────
    this._pass4_createConsumptionEdges(remoteToHostMap, nodeMap, graph, appCapabilities, diagnostics);

    // ── Pass 5: Create exposed module nodes and expose edges ───────
    this._pass5_createExposedModuleNodes(exposedModulesMap, nodeMap, graph, remoteToHostMap);

    // ── Pass 6: Create shared dependency nodes and sharing edges ───
    this._pass6_createSharedDependencyNodes(appCapabilities, nodeMap, graph);

    // ── Finalize metadata ──────────────────────────────────────────
    this._finalizeMetadata(graph);

    return {
      graph,
      nodeMap,
      edgeMap: new Map(graph.edges.map(e => [`${e.from}->${e.to}`, e])),
      remoteToHostMap,
      appCapabilities,
      diagnostics
    };
  }

  // ─── Pass 1 ────────────────────────────────────────────────────────
  private _pass1_analyzeCapabilities(
    configs: Map<string, ModuleFederationConfig[]>,
    appCapabilities: Map<string, AppCapability>,
    exposedModulesMap: Map<string, string[]>,
    diagnostics: GraphDiagnostic[]
  ): void {
    configs.forEach((rootConfigs, rootPath) => {
      rootConfigs.forEach(config => {
        if (!config.name || config.name.trim() === '') {
          diagnostics.push({
            code: 'missing-config-name',
            severity: 'warning',
            message: `Skipping config without name in ${rootPath}`,
            rootPath
          });
          return;
        }

        const appId = this._makeAppId(rootPath, config);
        const hasRemotes = config.remotes.length > 0;
        const hasExposes = config.exposes.length > 0;
        const isBidirectional = hasRemotes && hasExposes;
        const isStandaloneHost = !hasRemotes && !hasExposes;
        const isHost = isStandaloneHost || hasRemotes;
        const isRemote = hasExposes;

        appCapabilities.set(appId, { isHost: isHost || isBidirectional, isRemote, config });

        if (config.exposes.length > 0) {
          exposedModulesMap.set(
            appId,
            config.exposes.map(e => e.name)
          );
        }
      });
    });
  }

  // ─── Pass 2 ────────────────────────────────────────────────────────
  private _pass2_buildRemoteConsumptionMap(
    appCapabilities: Map<string, AppCapability>,
    nodeMap: Map<string, DependencyGraphNode>,
    graph: DependencyGraph,
    remoteToHostMap: Map<string, string[]>,
    diagnostics: GraphDiagnostic[]
  ): void {
    appCapabilities.forEach((capabilities, appId) => {
      const { config } = capabilities;

      config.remotes.forEach(remote => {
        const remoteAppId = this.findAppIdByName(remote.name, appCapabilities, diagnostics);

        // Skip self-references
        if (remoteAppId === appId) {
          diagnostics.push({
            code: 'self-reference',
            severity: 'warning',
            message: `Skipping self-reference: app '${config.name}' references itself as remote '${remote.name}'`,
            rootPath: appId
          });
          return;
        }

        if (remoteAppId) {
          if (!remoteToHostMap.has(remoteAppId)) {
            remoteToHostMap.set(remoteAppId, []);
          }
          remoteToHostMap.get(remoteAppId)!.push(appId);
        } else {
          // External remote (not in workspace)
          const externalRemoteId = `external-${remote.name}`;
          const existingNode = nodeMap.get(externalRemoteId);

          if (!existingNode) {
            const node: DependencyGraphNode = {
              id: externalRemoteId,
              label: remote.name,
              type: 'remote',
              configType: remote.configType || 'external',
              url: remote.url,
              size: 1,
              group: remote.isExternal || remote.configType === 'external' ? 'external-remotes' : 'remotes'
            };
            nodeMap.set(externalRemoteId, node);
            graph.nodes.push(node);
            graph.metadata!.totalRemotes++;
          } else {
            if (remote.url && !existingNode.url) existingNode.url = remote.url;
            if (remote.configType && existingNode.configType !== remote.configType) {
              existingNode.configType = remote.configType;
            }
            if (remote.isExternal || remote.configType === 'external') {
              existingNode.group = 'external-remotes';
            }
            existingNode.size = (existingNode.size || 1) + 1;
          }

          if (!remoteToHostMap.has(externalRemoteId)) {
            remoteToHostMap.set(externalRemoteId, []);
          }
          remoteToHostMap.get(externalRemoteId)!.push(appId);
        }
      });
    });
  }

  // ─── Pass 3 ────────────────────────────────────────────────────────
  private _pass3_createUnifiedNodes(
    appCapabilities: Map<string, AppCapability>,
    remoteToHostMap: Map<string, string[]>,
    nodeMap: Map<string, DependencyGraphNode>,
    graph: DependencyGraph
  ): void {
    appCapabilities.forEach((capabilities, appId) => {
      const { isHost, isRemote, config } = capabilities;
      const hasRemotes = config.remotes.length > 0;
      const hasExposes = config.exposes.length > 0;
      const isConsumedAsRemote = remoteToHostMap.has(appId);

      let nodeType: 'host' | 'remote';
      let nodeGroup: string;

      if (hasRemotes && hasExposes) {
        nodeType = 'host';
        nodeGroup = isConsumedAsRemote ? 'bidirectional' : 'hosts';
      } else if (hasRemotes && !hasExposes) {
        nodeType = 'host';
        nodeGroup = 'hosts';
      } else if (!hasRemotes && hasExposes) {
        if (isConsumedAsRemote) {
          nodeType = 'remote';
          nodeGroup = 'remotes';
        } else {
          nodeType = 'host';
          nodeGroup = 'hosts';
        }
      } else {
        nodeType = 'host';
        nodeGroup = 'hosts';
      }

      const appNode: DependencyGraphNode = {
        id: appId,
        label: config.name,
        type: nodeType,
        configType: config.configType,
        exposedModules: hasExposes ? config.exposes.map(e => e.name) : undefined,
        sharedDependencies: config.shared.map(s => s.name),
        configPath: config.configPath,
        size: Math.max(1, config.remotes.length + config.exposes.length + config.shared.length),
        group: nodeGroup
      };

      nodeMap.set(appId, appNode);
      graph.nodes.push(appNode);

      if (isHost) graph.metadata!.totalHosts++;
      if (isRemote) graph.metadata!.totalRemotes++;
      if (config.exposes.length > 0) {
        graph.metadata!.totalExposedModules += config.exposes.length;
      }
    });
  }

  // ─── Pass 4 ────────────────────────────────────────────────────────
  private _pass4_createConsumptionEdges(
    remoteToHostMap: Map<string, string[]>,
    nodeMap: Map<string, DependencyGraphNode>,
    graph: DependencyGraph,
    appCapabilities: Map<string, AppCapability>,
    diagnostics: GraphDiagnostic[]
  ): void {
    const processedPairs = new Set<string>();

    remoteToHostMap.forEach((hostIds, remoteId) => {
      hostIds.forEach(hostId => {
        const hostNode = nodeMap.get(hostId);
        const remoteNode = nodeMap.get(remoteId);

        if (!hostNode || !remoteNode) return;
        if (hostId === remoteId) return; // safety

        // Use directed pair key to preserve both directions
        const directedPairKey = `${hostId}->${remoteId}`;
        if (processedPairs.has(directedPairKey)) return;

        const isHostAlsoRemote = remoteToHostMap.has(hostId) && remoteToHostMap.get(hostId)!.includes(remoteId);

        const hostConfig = appCapabilities.get(hostId)?.config;
        const remoteConfig = hostConfig?.remotes.find(
          r =>
            this.findAppIdByName(r.name, appCapabilities, diagnostics) === remoteId || `external-${r.name}` === remoteId
        );

        if (remoteConfig?.url && !remoteNode.url) {
          remoteNode.url = remoteConfig.url;
        }

        const edge: DependencyGraphEdge = isHostAlsoRemote
          ? {
              from: hostId,
              to: remoteId,
              type: 'consumes',
              label: `↔ ${remoteConfig?.url || remoteNode.url || remoteNode.label}`,
              strength: 1.5,
              bidirectional: true
            }
          : {
              from: hostId,
              to: remoteId,
              type: 'consumes',
              label: remoteConfig?.url || remoteNode.url || remoteNode.label,
              strength: 1,
              bidirectional: false
            };

        graph.edges.push(edge);
        processedPairs.add(directedPairKey);
      });
    });
  }

  // ─── Pass 5 ────────────────────────────────────────────────────────
  private _pass5_createExposedModuleNodes(
    exposedModulesMap: Map<string, string[]>,
    nodeMap: Map<string, DependencyGraphNode>,
    graph: DependencyGraph,
    remoteToHostMap: Map<string, string[]>
  ): void {
    exposedModulesMap.forEach((moduleNames, appId) => {
      const appNode = nodeMap.get(appId);
      if (!appNode) return;

      moduleNames.forEach(moduleName => {
        const moduleId = `${appId}-module-${moduleName}`;
        const consumerCount = remoteToHostMap.get(appId)?.length || 1;

        const moduleNode: DependencyGraphNode = {
          id: moduleId,
          label: moduleName,
          type: 'exposed-module',
          configType: appNode.configType,
          size: consumerCount,
          group: appId
        };

        nodeMap.set(moduleId, moduleNode);
        graph.nodes.push(moduleNode);

        graph.edges.push({
          from: appId,
          to: moduleId,
          type: 'exposes',
          label: moduleName,
          strength: 1
        });
      });
    });
  }

  // ─── Pass 6 ────────────────────────────────────────────────────────
  private _pass6_createSharedDependencyNodes(
    appCapabilities: Map<string, AppCapability>,
    nodeMap: Map<string, DependencyGraphNode>,
    graph: DependencyGraph
  ): void {
    const sharedDepsMap = new Map<string, Set<string>>();

    appCapabilities.forEach((capabilities, appId) => {
      capabilities.config.shared.forEach(sharedDep => {
        if (!sharedDepsMap.has(sharedDep.name)) {
          sharedDepsMap.set(sharedDep.name, new Set());
        }
        sharedDepsMap.get(sharedDep.name)!.add(appId);
      });
    });

    sharedDepsMap.forEach((hostIds, depName) => {
      if (hostIds.size <= 1 || depName === '[DYNAMIC_SHARED]') return;

      const sharedDepId = `shared-${depName}`;

      // Find the most detailed shared dependency configuration
      let sharedDepConfig: SharedDependency | undefined;
      appCapabilities.forEach(({ config }) => {
        const found = config.shared.find(s => s.name === depName);
        if (found && (!sharedDepConfig || Object.keys(found).length > Object.keys(sharedDepConfig).length)) {
          sharedDepConfig = found;
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

      hostIds.forEach(hostId => {
        const hostNode = nodeMap.get(hostId);
        if (hostNode) {
          graph.edges.push({
            from: hostId,
            to: sharedDepId,
            type: 'shares',
            label: depName,
            strength: 0.5,
            bidirectional: true
          });
        }
      });
    });
  }

  // ─── Finalize metadata ─────────────────────────────────────────────
  private _finalizeMetadata(graph: DependencyGraph): void {
    graph.metadata!.totalHosts = graph.nodes.filter(n => n.type === 'host').length;
    graph.metadata!.totalRemotes = graph.nodes.filter(n => n.type === 'remote').length;
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  /** Create a unique app ID from root path and config */
  private _makeAppId(rootPath: string, config: ModuleFederationConfig): string {
    const rootPathHash = hashPath(rootPath);
    const configPathHash = hashPath(config.configPath);
    return `${rootPathHash}-${configPathHash}-${config.name}-${config.configType}`;
  }

  /**
   * Find an application ID by its name.
   * Uses exact and case-insensitive matching only — no substring matching.
   */
  findAppIdByName(
    appName: string,
    appCapabilities: Map<string, AppCapability>,
    diagnostics?: GraphDiagnostic[]
  ): string | undefined {
    const lowerAppName = appName.toLowerCase();
    let matchedId: string | undefined;

    for (const [appId, capabilities] of appCapabilities.entries()) {
      const configName = capabilities.config.name;

      if (configName === appName) {
        return appId;
      }

      if (configName.toLowerCase() === lowerAppName) {
        matchedId = matchedId ?? appId;
      }
    }

    if (matchedId) {
      const matchingIds = [...appCapabilities.entries()]
        .filter(([, capabilities]) => capabilities.config.name.toLowerCase() === lowerAppName)
        .map(([id]) => id);
      if (matchingIds.length > 1) {
        diagnostics?.push({
          code: 'ambiguous-app-name',
          severity: 'warning',
          message: `Ambiguous app name '${appName}' matched ${matchingIds.length} configurations`
        });
        return undefined;
      }
    }

    return matchedId;
  }
}

/** DJB2-style hash, truncated to 8 chars base-36 */
function hashPath(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36).substring(0, 8);
}
