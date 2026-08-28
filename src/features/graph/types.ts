import type { ModuleFederationConfig, SharedDependency } from '../../types';

export type GraphNodeType = 'host' | 'remote' | 'shared-dependency' | 'exposed-module';
export type GraphEdgeType = 'consumes' | 'exposes' | 'shares' | 'depends-on';

/** Graph model owned by the graph feature rather than the federation domain model. */
export interface DependencyGraphNode {
  id: string;
  label: string;
  type: GraphNodeType;
  configType: 'webpack' | 'vite' | 'modernjs' | 'rsbuild' | 'rspack' | 'external';
  version?: string;
  url?: string;
  status?: 'running' | 'stopped' | 'unknown';
  configPath?: string;
  exposedModules?: string[];
  sharedDependencies?: string[];
  size?: number;
  group?: string;
}

export interface DependencyGraphEdge {
  from: string;
  to: string;
  label?: string;
  type: GraphEdgeType;
  strength?: number;
  bidirectional?: boolean;
}

export interface DependencyGraph {
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
  sharedDependencies?: SharedDependency[];
  metadata: {
    totalHosts: number;
    totalRemotes: number;
    totalSharedDeps: number;
    totalExposedModules: number;
  };
}

/**
 * Internal capability info for an app during graph generation
 */
export interface AppCapability {
  isHost: boolean;
  isRemote: boolean;
  config: ModuleFederationConfig;
}

/**
 * Result of the graph generation — mirrors DependencyGraph but with
 * internal helper maps exposed for debugging/testing.
 */
export interface GraphGenerationResult {
  graph: DependencyGraph;
  nodeMap: Map<string, DependencyGraphNode>;
  edgeMap: Map<string, DependencyGraphEdge>;
  remoteToHostMap: Map<string, string[]>;
  appCapabilities: Map<string, AppCapability>;
  diagnostics: GraphDiagnostic[];
}

export interface GraphDiagnostic {
  code: 'missing-config-name' | 'self-reference' | 'ambiguous-app-name';
  severity: 'warning' | 'error';
  message: string;
  rootPath?: string;
}

/**
 * D3-compatible link format (source/target instead of from/to)
 */
export interface D3Link {
  source: string;
  target: string;
  label?: string;
  type: string;
  strength?: number;
  bidirectional?: boolean;
}

/**
 * D3-compatible graph data for webview serialization
 */
export interface D3GraphData {
  nodes: DependencyGraphNode[];
  links: D3Link[];
}
