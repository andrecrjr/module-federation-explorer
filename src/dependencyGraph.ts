// Re-export from the feature module for backward compatibility.
export { DependencyGraphManager } from './features/graph/dependencyGraph';
export { GraphGenerator } from './features/graph/generator';
export { WebviewMessageHandler, isWebviewMessage } from './features/graph/webview/handlers';
export { generateWebviewContent, serializeForScript } from './features/graph/webview/template';
export type {
  AppCapability,
  D3GraphData,
  D3Link,
  DependencyGraph,
  DependencyGraphEdge,
  DependencyGraphNode,
  GraphDiagnostic,
  GraphGenerationResult
} from './features/graph/types';
