import * as vscode from 'vscode';
import type { DependencyGraphNode } from '../types';

export type WebviewMessage =
  | { command: 'error'; text: string }
  | { command: 'loaded'; metadata?: Record<string, unknown> }
  | { command: 'nodeClick'; node: DependencyGraphNode };

/**
 * Handle webview messages from the graph visualization.
 */
export class WebviewMessageHandler {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: (message: string) => void = () => {}
  ) {}

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
        this.log("Enhanced dependency graph loaded successfully");
        if (message.metadata) {
          this.log(`Graph metadata: ${JSON.stringify(message.metadata)}`);
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
    this.log(`Node clicked in graph: ${node.label} (${node.type})`);

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

export function isWebviewMessage(message: unknown): message is WebviewMessage {
  if (!message || typeof message !== 'object' || !('command' in message)) return false;

  const command = (message as { command?: unknown }).command;
  if (command === 'error') return typeof (message as { text?: unknown }).text === 'string';
  if (command === 'loaded') {
    const metadata = (message as { metadata?: unknown }).metadata;
    return metadata === undefined || isRecord(metadata);
  }
  if (command !== 'nodeClick') return false;

  const node = (message as { node?: unknown }).node;
  return isDependencyGraphNode(node);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDependencyGraphNode(value: unknown): value is DependencyGraphNode {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.label !== 'string'
    || !isGraphNodeType(value.type)
    || !isConfigType(value.configType)) {
    return false;
  }

  if (value.url !== undefined && typeof value.url !== 'string') return false;
  if (value.version !== undefined && typeof value.version !== 'string') return false;
  if (value.configPath !== undefined && typeof value.configPath !== 'string') return false;
  if (value.group !== undefined && typeof value.group !== 'string') return false;
  if (value.size !== undefined && typeof value.size !== 'number') return false;
  if (value.status !== undefined && !['running', 'stopped', 'unknown'].includes(value.status as string)) return false;
  if (value.exposedModules !== undefined && !isStringArray(value.exposedModules)) return false;
  if (value.sharedDependencies !== undefined && !isStringArray(value.sharedDependencies)) return false;
  return true;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isGraphNodeType(value: unknown): value is DependencyGraphNode['type'] {
  return value === 'host'
    || value === 'remote'
    || value === 'shared-dependency'
    || value === 'exposed-module';
}

function isConfigType(value: unknown): value is DependencyGraphNode['configType'] {
  return value === 'webpack'
    || value === 'vite'
    || value === 'modernjs'
    || value === 'rsbuild'
    || value === 'rspack'
    || value === 'external';
}
