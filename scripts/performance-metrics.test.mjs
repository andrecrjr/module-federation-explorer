import assert from 'node:assert/strict';
import test from 'node:test';
import { latestMeasurement, parsePerformanceSnapshot, summarize } from './performance-metrics.mjs';

test('parses a valid snapshot and returns the latest repeated measurement', () => {
  const snapshot = parsePerformanceSnapshot({
    schemaVersion: 1,
    measurements: [
      { name: 'initialLoad', durationMs: 20 },
      { name: 'initialLoad', durationMs: 15 }
    ]
  });

  assert.equal(latestMeasurement(snapshot, 'initialLoad'), 15);
});

test('rejects malformed performance snapshots', () => {
  assert.throws(() => parsePerformanceSnapshot({ schemaVersion: 1, measurements: [{}] }));
});

test('summarizes values with median and p95', () => {
  assert.deepEqual(summarize([5, 1, 3, 2, 4]), {
    count: 5,
    minMs: 1,
    maxMs: 5,
    medianMs: 3,
    p95Ms: 4.8
  });
  assert.deepEqual(summarize([]), {
    count: 0,
    minMs: null,
    maxMs: null,
    medianMs: null,
    p95Ms: null
  });
});

test('ignores missing measurements', () => {
  assert.deepEqual(summarize([10, undefined, 30]), {
    count: 2,
    minMs: 10,
    maxMs: 30,
    medianMs: 20,
    p95Ms: 29
  });
  assert.deepEqual(summarize([undefined]), {
    count: 0,
    minMs: null,
    maxMs: null,
    medianMs: null,
    p95Ms: null
  });
});
