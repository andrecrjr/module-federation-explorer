import { readFile } from 'node:fs/promises';
import path from 'node:path';

const reportPath = path.resolve('reports/coverage/coverage-summary.json');
const baselinePath = path.resolve('coverage-baseline.json');
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
const metrics = ['lines', 'statements', 'functions', 'branches'];
const minimum = Number(process.env.COVERAGE_MINIMUM ?? 80);
const regressions = [];

if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) {
  console.error(`Invalid COVERAGE_MINIMUM: ${process.env.COVERAGE_MINIMUM}`);
  process.exit(1);
}

for (const metric of metrics) {
  const current = Number(report.total?.[metric]?.pct);
  const baselineValue = Number(baseline[metric]);
  const expected = Math.max(minimum, baselineValue);
  if (!Number.isFinite(current) || !Number.isFinite(baselineValue)) {
    regressions.push(`${metric}: missing coverage value`);
    continue;
  }
  if (current + 0.01 < expected) {
    regressions.push(`${metric}: ${current.toFixed(2)}% is below required ${expected.toFixed(2)}%`);
  }
}

if (regressions.length > 0) {
  console.error('Coverage regression detected:');
  for (const regression of regressions) console.error(`- ${regression}`);
  process.exitCode = 1;
} else {
  console.log(`Coverage meets ${minimum.toFixed(0)}% minimum: ${metrics.map(metric => `${metric} ${Number(report.total[metric].pct).toFixed(2)}%`).join(', ')}`);
}
