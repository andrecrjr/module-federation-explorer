import * as assert from 'assert';
import { isWebviewMessage } from '../../features/graph/webview/handlers';

suite('Graph webview message validation', () => {
  test('accepts a fully typed node click message', () => {
    assert.strictEqual(isWebviewMessage({
      command: 'nodeClick',
      node: {
        id: 'host-id',
        label: 'host',
        type: 'host',
        configType: 'webpack'
      }
    }), true);
  });

  test('rejects malformed node and loaded messages at the boundary', () => {
    assert.strictEqual(isWebviewMessage({
      command: 'nodeClick',
      node: { id: 'host-id', label: 'host' }
    }), false);
    assert.strictEqual(isWebviewMessage({
      command: 'loaded',
      metadata: 'not-an-object'
    }), false);
  });

  test('accepts error messages and loaded metadata records', () => {
    assert.strictEqual(isWebviewMessage({ command: 'error', text: 'D3 failed' }), true);
    assert.strictEqual(isWebviewMessage({ command: 'loaded' }), true);
    assert.strictEqual(isWebviewMessage({ command: 'loaded', metadata: { nodeCount: 2 } }), true);
  });

  test('rejects invalid optional node fields instead of trusting the webview', () => {
    const node = {
      id: 'host-id',
      label: 'host',
      type: 'host',
      configType: 'webpack'
    };
    assert.strictEqual(isWebviewMessage({ command: 'nodeClick', node: { ...node, size: '2' } }), false);
    assert.strictEqual(isWebviewMessage({ command: 'nodeClick', node: { ...node, status: 'running-now' } }), false);
    assert.strictEqual(isWebviewMessage({ command: 'nodeClick', node: { ...node, exposedModules: ['ok', 1] } }), false);
  });
});
