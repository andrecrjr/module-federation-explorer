import type { ModuleFederationConfig, SharedDependency } from '../../federation/types';
import {
  AppCapability,
  DependencyGraph,
  DependencyGraphEdge,
  DependencyGraphNode,
  GraphDiagnostic,
  GraphGenerationResult
} from './types';

interface AppNameIndex {
  exact: Map<string, string[]>;
  caseInsensitive: Map<string, string[]>;
}

interface SharedDependencyAggregate {
  hostIds: Set<string>;
  config?: SharedDependency;
  configDetail: number;
}

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
    const remoteToHostSet = new Map<string, Set<string>>();
    const appCapabilities = new Map<string, AppCapability>();
    const diagnostics: GraphDiagnostic[] = [];

    // ── Pass 1: Analyze capabilities ──────────────────────────────
    this._pass1_analyzeCapabilities(configs, appCapabilities, exposedModulesMap, diagnostics);
    const appNameIndex = this._buildAppNameIndex(appCapabilities);

    // ── Pass 2: Build remote consumption map ───────────────────────
    this._pass2_buildRemoteConsumptionMap(
      appCapabilities,
      nodeMap,
      graph,
      remoteToHostMap,
      remoteToHostSet,
      appNameIndex,
      diagnostics
    );

    // ── Pass 3: Create unified nodes ───────────────────────────────
    this._pass3_createUnifiedNodes(appCapabilities, remoteToHostMap, nodeMap, graph);

    // ── Pass 4: Create consolidated consumption edges ──────────────
    this._pass4_createConsumptionEdges(
      remoteToHostMap,
      remoteToHostSet,
      nodeMap,
      graph,
      appCapabilities,
      appNameIndex,
      diagnostics
    );

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
    remoteToHostSet: Map<string, Set<string>>,
    appNameIndex: AppNameIndex,
    diagnostics: GraphDiagnostic[]
  ): void {
    appCapabilities.forEach((capabilities, appId) => {
      const { config } = capabilities;

      config.remotes.forEach(remote => {
        const remoteAppId = this._findAppIdByName(remote.name, appNameIndex, diagnostics);

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
            remoteToHostSet.set(remoteAppId, new Set());
          }
          remoteToHostMap.get(remoteAppId)!.push(appId);
          remoteToHostSet.get(remoteAppId)!.add(appId);
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
            remoteToHostSet.set(externalRemoteId, new Set());
          }
          remoteToHostMap.get(externalRemoteId)!.push(appId);
          remoteToHostSet.get(externalRemoteId)!.add(appId);
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
    remoteToHostSet: Map<string, Set<string>>,
    nodeMap: Map<string, DependencyGraphNode>,
    graph: DependencyGraph,
    appCapabilities: Map<string, AppCapability>,
    appNameIndex: AppNameIndex,
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

        const isHostAlsoRemote = remoteToHostSet.get(hostId)?.has(remoteId) ?? false;

        const hostConfig = appCapabilities.get(hostId)?.config;
        const remoteConfig = hostConfig?.remotes.find(
          r =>
            this._findAppIdByName(r.name, appNameIndex, diagnostics) === remoteId || `external-${r.name}` === remoteId
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
    const sharedDepsMap = new Map<string, SharedDependencyAggregate>();

    appCapabilities.forEach((capabilities, appId) => {
      const seenInConfig = new Set<string>();
      capabilities.config.shared.forEach(sharedDep => {
        let aggregate = sharedDepsMap.get(sharedDep.name);
        if (!aggregate) {
          aggregate = { hostIds: new Set(), configDetail: 0 };
          sharedDepsMap.set(sharedDep.name, aggregate);
        }
        aggregate.hostIds.add(appId);

        // Match the previous selection rule: only the first occurrence in a
        // configuration participates in the "most detailed" comparison.
        if (seenInConfig.has(sharedDep.name)) return;
        seenInConfig.add(sharedDep.name);

        const configDetail = Object.keys(sharedDep).length;
        if (!aggregate.config || configDetail > aggregate.configDetail) {
          aggregate.config = sharedDep;
          aggregate.configDetail = configDetail;
        }
      });
    });

    sharedDepsMap.forEach((aggregate, depName) => {
      if (aggregate.hostIds.size <= 1 || depName === '[DYNAMIC_SHARED]') return;

      const sharedDepId = `shared-${depName}`;

      const sharedDepNode: DependencyGraphNode = {
        id: sharedDepId,
        label: depName,
        type: 'shared-dependency',
        configType: 'webpack',
        size: aggregate.hostIds.size,
        group: 'shared',
        version: aggregate.config?.version,
        sharedDependencies: [depName]
      };

      nodeMap.set(sharedDepId, sharedDepNode);
      graph.nodes.push(sharedDepNode);
      graph.metadata!.totalSharedDeps++;

      aggregate.hostIds.forEach(hostId => {
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
    let totalHosts = 0;
    let totalRemotes = 0;
    for (const node of graph.nodes) {
      if (node.type === 'host') totalHosts++;
      if (node.type === 'remote') totalRemotes++;
    }
    graph.metadata!.totalHosts = totalHosts;
    graph.metadata!.totalRemotes = totalRemotes;
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
    return this._findAppIdByName(appName, this._buildAppNameIndex(appCapabilities), diagnostics);
  }

  private _buildAppNameIndex(appCapabilities: Map<string, AppCapability>): AppNameIndex {
    const exact = new Map<string, string[]>();
    const caseInsensitive = new Map<string, string[]>();

    for (const [appId, capabilities] of appCapabilities) {
      const name = capabilities.config.name;
      const exactMatches = exact.get(name) ?? [];
      exactMatches.push(appId);
      exact.set(name, exactMatches);

      const normalizedName = name.toLowerCase();
      const normalizedMatches = caseInsensitive.get(normalizedName) ?? [];
      normalizedMatches.push(appId);
      caseInsensitive.set(normalizedName, normalizedMatches);
    }

    return { exact, caseInsensitive };
  }

  private _findAppIdByName(
    appName: string,
    appNameIndex: AppNameIndex,
    diagnostics?: GraphDiagnostic[]
  ): string | undefined {
    const exactMatch = appNameIndex.exact.get(appName)?.[0];
    if (exactMatch) return exactMatch;

    const matchingIds = appNameIndex.caseInsensitive.get(appName.toLowerCase()) ?? [];
    if (matchingIds.length > 1) {
      diagnostics?.push({
        code: 'ambiguous-app-name',
        severity: 'warning',
        message: `Ambiguous app name '${appName}' matched ${matchingIds.length} configurations`
      });
      return undefined;
    }

    return matchingIds[0];
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
