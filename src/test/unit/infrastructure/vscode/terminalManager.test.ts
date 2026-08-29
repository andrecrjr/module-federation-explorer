import * as assert from 'assert';
import { TerminalManager, TerminalLike } from '../../../../infrastructure/vscode/terminalManager';

class FakeTerminal implements TerminalLike {
  constructor(
    public readonly name: string,
    public processId: number | undefined
  ) {}

  disposed = false;

  dispose(): void {
    this.disposed = true;
    this.processId = undefined;
  }
}

class CreatedTerminal extends FakeTerminal {
  readonly sentTexts: string[] = [];
  shown = false;

  show(): void {
    this.shown = true;
  }

  sendText(text: string): void {
    this.sentTexts.push(text);
  }
}

suite('TerminalManager', () => {
  test('tracks and disposes remote terminals as one lifecycle', () => {
    const changes: string[] = [];
    const manager = new TerminalManager(() => changes.push('changed'));
    const buildTerminal = new FakeTerminal('remote-build', 1);
    const startTerminal = new FakeTerminal('remote-start', 2);

    manager.setRunningRemote('remote-auth', startTerminal, buildTerminal);

    assert.strictEqual(manager.getRunningRemoteTerminal('remote-auth'), startTerminal);
    manager.stopRemote('remote-auth');

    assert.strictEqual(startTerminal.disposed, true);
    assert.strictEqual(buildTerminal.disposed, true);
    assert.strictEqual(manager.getRunningRemoteTerminal('remote-auth'), undefined);
    assert.strictEqual(changes.length, 2);
  });

  test('removes only the tracked app when its terminal closes', () => {
    const manager = new TerminalManager();
    const remoteTerminal = new FakeTerminal('remote', 3);
    const rootTerminal = new FakeTerminal('root', 4);

    manager.setRunningRemote('remote-key', remoteTerminal);
    manager.setRunningRootApp('/workspace/host', rootTerminal);
    manager.handleTerminalClosed(new FakeTerminal('remote', 3));

    assert.strictEqual(manager.getRunningRemoteTerminal('remote-key'), undefined);
    assert.strictEqual(manager.isRootAppRunning('/workspace/host'), true);
  });

  test('cleans up terminals whose process is no longer available', () => {
    const manager = new TerminalManager();
    const remoteTerminal = new FakeTerminal('remote', undefined);
    const rootTerminal = new FakeTerminal('root', 5);

    manager.setRunningRemote('remote-key', remoteTerminal);
    manager.setRunningRootApp('/workspace/host', rootTerminal);

    assert.deepStrictEqual(manager.cleanupDisposedTerminals(), { remotes: 1, rootApps: 0 });
    assert.strictEqual(manager.getRunningRemoteTerminal('remote-key'), undefined);
    assert.strictEqual(manager.isRootAppRunning('/workspace/host'), true);
  });

  test('owns terminal creation and command dispatch for roots and remotes', () => {
    const created: Array<{ terminal: CreatedTerminal; parent?: TerminalLike }> = [];
    const manager = new TerminalManager({
      createTerminal: (name, parent) => {
        const terminal = new CreatedTerminal(name, created.length + 10);
        created.push({ terminal, parent });
        return terminal;
      }
    });

    manager.startRootApp('/workspace/host', 'Host', 'npm run start');
    manager.startRemote('remote-auth', 'auth', '/workspace/auth', 'npm run build', 'npm run preview');

    assert.deepStrictEqual(
      created.map(entry => entry.terminal.name),
      ['MFE App: Host', 'Build: auth - Remote', 'Preview: auth - Remote']
    );
    assert.strictEqual(created[0].terminal.sentTexts[0], 'cd "/workspace/host" && npm run start');
    assert.strictEqual(created[1].terminal.sentTexts[0], 'cd "/workspace/auth" && npm run build');
    assert.strictEqual(created[2].terminal.sentTexts[0], 'cd "/workspace/auth" && npm run preview');
    assert.strictEqual(created[2].parent, created[1].terminal);
    assert.strictEqual(manager.isRootAppRunning('/workspace/host'), true);
    assert.ok(manager.getRunningRemoteTerminal('remote-auth'));
  });
});
