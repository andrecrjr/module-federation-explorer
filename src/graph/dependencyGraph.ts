import * as vscode from 'vscode';
import { DependencyGraph, ModuleFederationConfig } from '../types';
import { GraphGenerator } from './generator';
import { generateWebviewContent } from './webview/template';
import { WebviewMessageHandler } from './webview/handlers';

/**
 * Thin coordinator for the Module Federation dependency graph.
 * Delegates graph generation, webview rendering, and message handling
 * to specialized modules.
 */
export class DependencyGraphManager {
  private _panel: vscode.WebviewPanel | undefined;
  private readonly generator: GraphGenerator;
  private readonly messageHandler: WebviewMessageHandler;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.generator = new GraphGenerator();
    this.messageHandler = new WebviewMessageHandler(context);
  }

  /**
   * Generate a dependency graph from the provided configurations.
   * Delegates to GraphGenerator (six-pass algorithm).
   */
  generateDependencyGraph(configs: Map<string, ModuleFederationConfig[]>): DependencyGraph {
    return this.generator.generate(configs).graph;
  }

  /**
   * Show the dependency graph in a webview panel.
   */
  showDependencyGraph(graph: DependencyGraph): void {
    if (graph.nodes.length === 0) {
      vscode.window.showInformationMessage("No Module Federation configurations found to display in the graph.");
      return;
    }

    const columnToShowIn = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (this._panel) {
      this._panel.reveal(columnToShowIn);
      this.updateWebviewContent(this._panel.webview, graph);
    } else {
      this._panel = vscode.window.createWebviewPanel(
        'moduleFederationGraph',
        'Module Federation Explorer Graph',
        columnToShowIn || vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.file(this.context.extensionPath),
          ]
        }
      );

      this.updateWebviewContent(this._panel.webview, graph);

      this._panel.onDidDispose(() => { this._panel = undefined; }, null, this.context.subscriptions);

      this._panel.webview.onDidReceiveMessage(
        message => this.messageHandler.handleMessage(message),
        undefined,
        this.context.subscriptions
      );
    }
  }

  /** Refresh the open graph panel after configuration changes. */
  refreshDependencyGraph(configs: Map<string, ModuleFederationConfig[]>): void {
    if (!this._panel) return;

    const graph = this.generateDependencyGraph(configs);
    this.updateWebviewContent(this._panel.webview, graph);
  }

  /**
   * Update the webview content with the graph data.
   * Delegates to the template generator.
   */
  private updateWebviewContent(webview: vscode.Webview, graph: DependencyGraph): void {
    webview.html = generateWebviewContent(webview, this.context.extensionPath, graph);
  }
}
