import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { PerformancePort } from '../../app/ports';
import { NOOP_PERFORMANCE, PerformanceRecorder } from '../../app/performance';

/** Enables file-backed performance snapshots only when explicitly requested. */
export function createExtensionPerformancePort(): PerformancePort {
  const outputPath = process.env.MF_EXPLORER_PERF_OUTPUT;
  if (!outputPath) return NOOP_PERFORMANCE;

  const resolvedOutputPath = path.resolve(outputPath);
  return new PerformanceRecorder(
    {
      now: () => performance.now(),
      timestamp: () => new Date().toISOString()
    },
    async snapshot => {
      try {
        await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
        await writeFile(resolvedOutputPath, JSON.stringify(snapshot, null, 2), 'utf8');
      } catch {
        // Performance diagnostics must never prevent extension activation.
      }
    }
  );
}
