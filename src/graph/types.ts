import { DependencyGraphNode, DependencyGraphEdge, DependencyGraph, ModuleFederationConfig } from '../types';

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
