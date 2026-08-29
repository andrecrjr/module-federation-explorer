import type { PerformanceMark, PerformanceMeasurement, PerformancePort, PerformanceSnapshot } from './ports';

export interface PerformanceRuntime {
  now(): number;
  timestamp(): string;
}

export type PerformanceSink = (snapshot: PerformanceSnapshot) => Promise<void>;

export class NoopPerformancePort implements PerformancePort {
  readonly enabled = false;

  mark(_name: string): void {}

  async measure<T>(_name: string, operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  getSnapshot(): PerformanceSnapshot {
    return {
      schemaVersion: 1,
      startedAt: '',
      measurements: [],
      marks: []
    };
  }

  async flush(): Promise<void> {}
}

export const NOOP_PERFORMANCE: PerformancePort = new NoopPerformancePort();

/** Collects deterministic timing data while keeping the application VS Code-free. */
export class PerformanceRecorder implements PerformancePort {
  readonly enabled = true;
  private readonly startedAt: string;
  private readonly origin: number;
  private completedAt: string | undefined;
  private readonly measurements: PerformanceMeasurement[] = [];
  private readonly marks: PerformanceMark[] = [];

  constructor(
    private readonly runtime: PerformanceRuntime,
    private readonly sink: PerformanceSink = async () => {}
  ) {
    this.origin = runtime.now();
    this.startedAt = runtime.timestamp();
  }

  mark(name: string): void {
    this.marks.push({ name, elapsedMs: this.runtime.now() - this.origin });
  }

  async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const started = this.runtime.now();
    try {
      return await operation();
    } finally {
      this.measurements.push({ name, durationMs: this.runtime.now() - started });
    }
  }

  getSnapshot(): PerformanceSnapshot {
    return {
      schemaVersion: 1,
      startedAt: this.startedAt,
      ...(this.completedAt ? { completedAt: this.completedAt } : {}),
      measurements: [...this.measurements],
      marks: [...this.marks]
    };
  }

  async flush(): Promise<void> {
    this.completedAt = this.runtime.timestamp();
    await this.sink(this.getSnapshot());
  }
}
