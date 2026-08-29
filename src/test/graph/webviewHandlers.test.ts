import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { WebviewMessageHandler } from '../../features/graph/webview/handlers';
import type { DependencyGraphNode } from '../../features/graph/types';

function replaceMethod(target: object, name: string, implementation: unknown): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { configurable: true, value: implementation });
  return () => {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else delete (target as Record<string, unknown>)[name];
  };
}

function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

const detailedNode: DependencyGraphNode = {
  id: 'auth-id',
  label: 'auth',
  type: 'remote',
  configType: 'webpack',
  configPath: '/workspace/auth/webpack.config.js',
  url: 'https://example.test/remoteEntry.js',
  version: '1.2.3',
  exposedModules: ['./Login'],
  sharedDependencies: ['react'],
  size: 2,
  status: 'running',
  group: 'platform'
};

suite('Graph webview message handler', () => {
  test('handles errors and loaded metadata messages', () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const restoreError = replaceMethod(vscode.window, 'showErrorMessage', (message: string) => {
      errors.push(message);
      return Promise.resolve(undefined);
    });

    try {
      const handler = new WebviewMessageHandler({} as vscode.ExtensionContext, message => logs.push(message));
      handler.handleMessage({ command: 'error', text: 'D3 failed' });
      handler.handleMessage({ command: 'loaded' });
      handler.handleMessage({ command: 'loaded', metadata: { nodeCount: 3 } });

      assert.deepStrictEqual(errors, ['Graph Error: D3 failed']);
      assert.deepStrictEqual(logs, [
        'Enhanced dependency graph loaded successfully',
        'Enhanced dependency graph loaded successfully',
        'Graph metadata: {"nodeCount":3}'
      ]);
    } finally {
      restoreError();
    }
  });

  test('shows all available node details for a view-details action', async () => {
    const details: string[] = [];
    const restoreQuickPick = replaceMethod(vscode.window, 'showQuickPick', () => Promise.resolve('View Details'));
    const restoreInfo = replaceMethod(vscode.window, 'showInformationMessage', (message: string, options: { detail?: string }) => {
      details.push(`${message}\n${options.detail || ''}`);
      return Promise.resolve(undefined);
    });

    try {
      const handler = new WebviewMessageHandler({} as vscode.ExtensionContext);
      handler.handleMessage({ command: 'nodeClick', node: detailedNode });
      await flushPromises();

      assert.strictEqual(details.length, 1);
      assert.match(details[0], /## auth/);
      assert.match(details[0], /URL/);
      assert.match(details[0], /Version/);
      assert.match(details[0], /Exposed Modules/);
      assert.match(details[0], /Shared Dependencies/);
      assert.match(details[0], /Connections/);
      assert.match(details[0], /Status/);
      assert.match(details[0], /Group/);
    } finally {
      restoreInfo();
      restoreQuickPick();
    }
  });

  test('warns when an open-config action has no associated config path', async () => {
    const warnings: string[] = [];
    const restoreQuickPick = replaceMethod(vscode.window, 'showQuickPick', () => Promise.resolve('Open Config'));
    const restoreWarning = replaceMethod(vscode.window, 'showWarningMessage', (message: string) => {
      warnings.push(message);
      return Promise.resolve(undefined);
    });

    try {
      const handler = new WebviewMessageHandler({} as vscode.ExtensionContext);
      handler.handleMessage({
        command: 'nodeClick',
        node: { ...detailedNode, configPath: undefined }
      });
      await flushPromises();

      assert.deepStrictEqual(warnings, ['No workspace configuration is associated with "auth"']);
    } finally {
      restoreWarning();
      restoreQuickPick();
    }
  });

  test('opens a config and reports failures from the editor', async () => {
    const opened: string[] = [];
    const warnings: string[] = [];
    const restoreQuickPick = replaceMethod(vscode.window, 'showQuickPick', () => Promise.resolve('Open Config'));
    const restoreWarning = replaceMethod(vscode.window, 'showWarningMessage', (message: string) => {
      warnings.push(message);
      return Promise.resolve(undefined);
    });
    const restoreOpenTextDocument = replaceMethod(vscode.workspace, 'openTextDocument', (uri: vscode.Uri) => {
      opened.push(uri.fsPath);
      return Promise.resolve({} as vscode.TextDocument);
    });
    const restoreShowTextDocument = replaceMethod(vscode.window, 'showTextDocument', () => Promise.resolve({} as vscode.TextEditor));

    try {
      const handler = new WebviewMessageHandler({} as vscode.ExtensionContext);
      handler.handleMessage({ command: 'nodeClick', node: detailedNode });
      await flushPromises();
      assert.deepStrictEqual(opened, ['/workspace/auth/webpack.config.js']);

      restoreOpenTextDocument();
      replaceMethod(vscode.workspace, 'openTextDocument', () => Promise.reject(new Error('permission denied')));
      handler.handleMessage({ command: 'nodeClick', node: detailedNode });
      await flushPromises();
      await flushPromises();
      assert.deepStrictEqual(warnings, ['Could not open configuration for "auth": Error: permission denied']);
    } finally {
      restoreShowTextDocument();
      restoreWarning();
      restoreQuickPick();
      restoreOpenTextDocument();
    }
  });
});
