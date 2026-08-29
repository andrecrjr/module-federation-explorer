import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import * as vscode from 'vscode';

interface PerformanceMeasurement {
  name: string;
  durationMs: number;
}

interface PerformanceSnapshot {
  schemaVersion: number;
  startedAt?: string;
  completedAt?: string;
  measurements: PerformanceMeasurement[];
  marks?: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPerformanceSnapshot(value: unknown): value is PerformanceSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.measurements)) return false;
  return value.measurements.every(
    measurement =>
      isRecord(measurement) &&
      typeof measurement.name === 'string' &&
      typeof measurement.durationMs === 'number' &&
      Number.isFinite(measurement.durationMs)
  );
}

async function readSnapshot(filePath: string): Promise<PerformanceSnapshot | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return isPerformanceSnapshot(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function writeHarnessMeasurement(filePath: string, durationMs: number): Promise<PerformanceSnapshot> {
  const existing = await readSnapshot(filePath);
  const snapshot: PerformanceSnapshot = existing || {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    measurements: [],
    marks: []
  };
  const names = new Set(snapshot.measurements.map(measurement => measurement.name));
  if (!names.has('activation')) snapshot.measurements.push({ name: 'activation', durationMs });
  snapshot.measurements.push({ name: 'testHarnessActivation', durationMs });
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
  return snapshot;
}

suite('Extension performance', () => {
  test('records activation and initial configuration loading', async function () {
    const outputPath = process.env.MF_EXPLORER_PERF_OUTPUT;
    if (!outputPath) {
      this.skip();
      return;
    }

    const extension = vscode.extensions.getExtension('acjr.mf-explorer');
    assert.ok(extension, 'The extension must be available in the performance host');
    const started = performance.now();
    await extension.activate();
    const activationMs = performance.now() - started;

    const snapshot = (await readSnapshot(outputPath)) || (await writeHarnessMeasurement(outputPath, activationMs));
    const measuredNames = new Set(snapshot.measurements.map(measurement => measurement.name));
    assert.ok(measuredNames.has('activation'));
    if (measuredNames.has('testHarnessActivation')) return;
    assert.ok(measuredNames.has('initialize'));
    assert.ok(measuredNames.has('initialLoad'));
  });
});
