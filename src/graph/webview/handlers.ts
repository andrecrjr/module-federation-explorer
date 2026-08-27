import * as vscode from 'vscode';
import { DependencyGraphNode } from '../../types';
import { log } from '../../outputChannel';

type WebviewMessage =
  | { command: 'error'; text: string }
  | { command: 'loaded'; metadata?: Record<string, unknown> }
  | { command: 'nodeClick'; node: DependencyGraphNode };

/**
 * Handle webview messages from the graph visualization.
 */
export class WebviewMessageHandler {
  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Process a message received from the graph webview.
   */
  handleMessage(message: unknown): void {
    if (!isWebviewMessage(message)) return;

    switch (message.command) {
      case 'error':
        vscode.window.showErrorMessage(`Graph Error: ${message.text}`);
        break;

      case 'loaded':
        log("Enhanced dependency graph loaded successfully");
        if (message.metadata) {
          log(`Graph metadata: ${JSON.stringify(message.metadata)}`);
        }
        break;

      case 'nodeClick':
        this.handleNodeClick(message.node);
        break;
    }
  }

  /**
   * Handle a node click event from the webview.
   * Improved: instead of just showing an info message, offer actionable options.
   */
  private handleNodeClick(node: DependencyGraphNode): void {
    log(`Node clicked in graph: ${node.label} (${node.type})`);

    const actions: string[] = ['View Details'];

    // If this is a workspace node (not external/shared/module), offer to open config
    if (node.type === 'host' || node.type === 'remote') {
      actions.push('Open Config');
    }

    vscode.window.showQuickPick(actions, { placeHolder: `${node.label} (${node.type})` })
      .then(selection => {
        if (!selection) return;

        if (selection === 'View Details') {
          this.showNodeDetails(node);
        }

        if (selection === 'Open Config') {
          this.openConfigForNode(node);
        }
      });
  }

  /**
   * Show detailed info about a node in an output panel.
   */
  private showNodeDetails(node: DependencyGraphNode): void {
    const lines = [
      `## ${node.label}`,
      `**Type:** ${node.type.replace('-', ' ')}`,
      `**Config Type:** ${node.configType}`,
    ];

    if (node.url) lines.push(`**URL:** ${node.url}`);
    if (node.version) lines.push(`**Version:** ${node.version}`);
    if (node.exposedModules?.length) lines.push(`**Exposed Modules:** ${node.exposedModules.join(', ')}`);
    if (node.sharedDependencies?.length) lines.push(`**Shared Dependencies:** ${node.sharedDependencies.join(', ')}`);
    if (node.size && node.size > 1) lines.push(`**Connections:** ${node.size}`);
    if (node.status) lines.push(`**Status:** ${node.status}`);
    if (node.group) lines.push(`**Group:** ${node.group}`);

    // Show as information message
    vscode.window.showInformationMessage(
      `${node.label} (${node.type})`,
      { modal: false, detail: lines.join('\n') }
    );
  }

  /**
   * Attempt to find and open the config file for a workspace node.
   */
  private openConfigForNode(node: DependencyGraphNode): void {
    if (!node.configPath) {
      vscode.window.showWarningMessage(`No workspace configuration is associated with "${node.label}"`);
      return;
    }

    vscode.workspace.openTextDocument(vscode.Uri.file(node.configPath))
      .then(document => vscode.window.showTextDocument(document))
      .then(undefined, error => vscode.window.showWarningMessage(`Could not open configuration for "${node.label}": ${String(error)}`));
  }
}

function isWebviewMessage(message: unknown): message is WebviewMessage {
  if (!message || typeof message !== 'object' || !('command' in message)) return false;

  const command = (message as { command?: unknown }).command;
  if (command === 'error') return typeof (message as { text?: unknown }).text === 'string';
  if (command === 'loaded') return true;
  if (command !== 'nodeClick') return false;

  const node = (message as { node?: unknown }).node;
  return !!node && typeof node === 'object' &&
    typeof (node as { id?: unknown }).id === 'string' &&
    typeof (node as { label?: unknown }).label === 'string';
}
