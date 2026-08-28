import * as assert from 'assert';
import { serializeForScript } from '../features/graph/webview/template';

suite('Graph webview serialization', () => {
  test('escapes script-breaking characters in serialized graph data', () => {
    const serialized = serializeForScript({ label: '</script><script>alert(1)</script>' });

    assert.strictEqual(serialized.includes('</script>'), false);
    assert.strictEqual(serialized.includes('\\u003c/script\\u003e'), true);
  });
});
