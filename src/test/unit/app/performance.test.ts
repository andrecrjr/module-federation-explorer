import * as assert from 'node:assert/strict';
import { NoopPerformancePort, PerformanceRecorder } from '../../../app/performance';
import type { PerformanceSnapshot } from '../../../app/ports';

class FakePerformanceRuntime {
  private elapsed = 0;

  now(): number {
    return this.elapsed;
  }

  timestamp(): string {
    return `timestamp-${this.elapsed}`;
  }

  advance(milliseconds: number): void {
    this.elapsed += milliseconds;
  }
}

suite('PerformanceRecorder', () => {
  test('records phase durations, marks, and flushes a snapshot', async () => {
    const runtime = new FakePerformanceRuntime();
    let flushedSnapshot: PerformanceSnapshot | undefined;
    const recorder = new PerformanceRecorder(runtime, async snapshot => {
      flushedSnapshot = snapshot;
    });

    runtime.advance(3);
    recorder.mark('before-load');
    await recorder.measure('load', async () => {
      runtime.advance(25);
    });
    await recorder.flush();

    assert.deepEqual(recorder.getSnapshot(), {
      schemaVersion: 1,
      startedAt: 'timestamp-0',
      completedAt: 'timestamp-28',
      measurements: [{ name: 'load', durationMs: 25 }],
      marks: [{ name: 'before-load', elapsedMs: 3 }]
    });
    assert.deepEqual(flushedSnapshot, recorder.getSnapshot());
  });

  test('keeps disabled instrumentation transparent', async () => {
    const performance = new NoopPerformancePort();
    const result = await performance.measure('ignored', async () => 'result');

    assert.equal(performance.enabled, false);
    assert.equal(result, 'result');
    assert.deepEqual(performance.getSnapshot().measurements, []);
  });
});
