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
});
