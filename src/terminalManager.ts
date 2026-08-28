export interface TerminalLike {
  readonly name: string;
  readonly processId: unknown;
  dispose(): void;
}

export interface RunningRemote {
  readonly startTerminal: TerminalLike;
  readonly buildTerminal?: TerminalLike;
}

export interface TerminalCleanupResult {
  remotes: number;
  rootApps: number;
}

interface RunningRootApp {
  readonly terminal: TerminalLike;
}

/** Owns terminal state so tree rendering and command registration stay independent. */
export class TerminalManager implements TerminalPort {
  private readonly runningRemotes = new Map<string, RunningRemote>();
  private readonly runningRootApps = new Map<string, RunningRootApp>();

  constructor(private readonly onChange: () => void = () => {}) {}

  setRunningRemote(remoteKey: string, startTerminal: TerminalLike, buildTerminal?: TerminalLike): void {
    this.runningRemotes.set(remoteKey, { startTerminal, buildTerminal });
    this.onChange();
  }

  getRunningRemoteTerminal(remoteKey: string): TerminalLike | undefined {
    const runningRemote = this.runningRemotes.get(remoteKey);
    if (!runningRemote) return undefined;

    if (this.isAlive(runningRemote.startTerminal)) {
      return runningRemote.startTerminal;
    }

    this.runningRemotes.delete(remoteKey);
    this.onChange();
    return undefined;
  }

  stopRemote(remoteKey: string): void {
    const runningRemote = this.runningRemotes.get(remoteKey);
    if (!runningRemote) return;

    runningRemote.buildTerminal?.dispose();
    runningRemote.startTerminal.dispose();
    this.runningRemotes.delete(remoteKey);
    this.onChange();
  }

  setRunningRootApp(rootPath: string, terminal: TerminalLike): void {
    this.runningRootApps.set(rootPath, { terminal });
  }

  isRootAppRunning(rootPath: string): boolean {
    return this.runningRootApps.has(rootPath);
  }

  stopRootApp(rootPath: string): boolean {
    const runningApp = this.runningRootApps.get(rootPath);
    if (!runningApp) return false;

    runningApp.terminal.dispose();
    this.runningRootApps.delete(rootPath);
    return true;
  }

  clearAllRunningApps(): void {
    this.runningRemotes.clear();
    this.runningRootApps.clear();
  }

  cleanupDisposedTerminals(): TerminalCleanupResult {
    const remotes = this.removeDisposed(this.runningRemotes, remote => this.isAlive(remote.startTerminal)
      && (!remote.buildTerminal || this.isAlive(remote.buildTerminal)));
    const rootApps = this.removeDisposed(this.runningRootApps, app => this.isAlive(app.terminal));

    if (remotes > 0 || rootApps > 0) {
      this.onChange();
    }

    return { remotes, rootApps };
  }

  handleTerminalClosed(closedTerminal: TerminalLike): boolean {
    for (const [remoteKey, remote] of this.runningRemotes) {
      if (this.terminalsMatch(remote.startTerminal, closedTerminal)
        || (remote.buildTerminal && this.terminalsMatch(remote.buildTerminal, closedTerminal))) {
        this.runningRemotes.delete(remoteKey);
        this.onChange();
        return true;
      }
    }

    for (const [rootPath, app] of this.runningRootApps) {
      if (this.terminalsMatch(app.terminal, closedTerminal)) {
        this.runningRootApps.delete(rootPath);
        this.onChange();
        return true;
      }
    }

    return false;
  }

  private isAlive(terminal: TerminalLike): boolean {
    try {
      return terminal.processId !== undefined;
    } catch {
      return false;
    }
  }

  private terminalsMatch(first: TerminalLike, second: TerminalLike): boolean {
    if (first === second) return true;

    try {
      return first.name === second.name
        && first.processId !== undefined
        && second.processId !== undefined
        && first.processId === second.processId;
    } catch {
      return first.name === second.name;
    }
  }

  private removeDisposed<T>(
    entries: Map<string, T>,
    isAlive: (entry: T) => boolean
  ): number {
    let removed = 0;
    for (const [key, entry] of entries) {
      if (!isAlive(entry)) {
        entries.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
import type { TerminalPort } from './app/ports';
