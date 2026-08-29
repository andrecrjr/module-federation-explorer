import * as assert from 'node:assert/strict';
import { isOnboardingMessage } from '../../../../features/onboarding/messages';

suite('Onboarding webview message validation', () => {
  test('accepts typed browse, selection, and skip messages', () => {
    assert.equal(isOnboardingMessage({ command: 'browseHostFolder', idx: 0 }), true);
    assert.equal(
      isOnboardingMessage({
        command: 'addSelectedFolders',
        items: [{ path: '/workspace/host', role: 'host', hostFolder: null }]
      }),
      true
    );
    assert.equal(isOnboardingMessage({ command: 'skipOnboarding' }), true);
  });

  test('rejects malformed or unsafe message payloads', () => {
    assert.equal(isOnboardingMessage({ command: 'browseHostFolder', idx: -1 }), false);
    assert.equal(isOnboardingMessage({ command: 'browseHostFolder', idx: '0' }), false);
    assert.equal(
      isOnboardingMessage({
        command: 'addSelectedFolders',
        items: [{ path: '/workspace/host', role: 'unknown', hostFolder: null }]
      }),
      false
    );
    assert.equal(
      isOnboardingMessage({
        command: 'addSelectedFolders',
        items: [{ path: '/workspace/host', role: 'remote', hostFolder: 42 }]
      }),
      false
    );
    assert.equal(isOnboardingMessage({ command: 'unexpected' }), false);
  });
});
