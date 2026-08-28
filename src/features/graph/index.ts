export { DependencyGraphManager } from './dependencyGraph';
export { GraphGenerator } from './generator';
export { WebviewMessageHandler, isWebviewMessage } from './webview/handlers';
export { generateWebviewContent, serializeForScript } from './webview/template';
export type {
  AppCapability,
  D3GraphData,
  D3Link,
  DependencyGraph,
  DependencyGraphEdge,
  DependencyGraphNode,
  GraphDiagnostic,
  GraphGenerationResult
} from './types';
