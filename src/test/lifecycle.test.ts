import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { ExplorerApplication } from '../app/explorerApplication';
import { registerTerminalLifecycle, scheduleOnboarding } from '../app/lifecycle';
import { registerWatchers } from '../app/registerWatchers';

function createContext(): { context: vscode.ExtensionContext; subscriptions: vscode.Disposable[] } {
  const subscriptions: vscode.Disposable[] = [];
  return {
    context: { subscriptions } as unknown as vscode.ExtensionContext,
    subscriptions
  };
}

function disposeAll(subscriptions: vscode.Disposable[]): void {
  for (const subscription of subscriptions) subscription.dispose();
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

suite('Application lifecycle', () => {
  test('owns terminal cleanup listeners and intervals through context subscriptions', async () => {
    const { context, subscriptions } = createContext();
    let cleared = 0;
    let cleanups = 0;
    const application = {
      clearAllRunningApps: () => { cleared++; },
      handleTerminalClosed: () => {},
      cleanupDisposedTerminals: () => { cleanups++; }
    } as unknown as ExplorerApplication;

    registerTerminalLifecycle(context, application, 5);
    await wait(20);

    assert.equal(cleared, 1);
    assert.ok(cleanups > 0);
    disposeAll(subscriptions);
  });

  test('cancels scheduled onboarding when the extension context is disposed', async () => {
    const { context, subscriptions } = createContext();
    let configuredRootsChecks = 0;
    const application = {
      hasConfiguredRoots: async () => {
        configuredRootsChecks++;
        return true;
      },
      log: () => {},
      logError: () => {}
    } as unknown as ExplorerApplication;

    scheduleOnboarding(context, application, 10);
    disposeAll(subscriptions);
    await wait(25);

    assert.equal(configuredRootsChecks, 0);
  });

  test('returns file watchers and debounce cleanup as one disposable group', () => {
    const { subscriptions } = createContext();
    const application = {
      log: () => {},
      reloadConfigurations: async () => {},
      logError: () => {}
    } as unknown as ExplorerApplication;

    const watchers = registerWatchers(application);
    subscriptions.push(...watchers);

    assert.equal(watchers.length, 9);
    disposeAll(subscriptions);
  });
});
