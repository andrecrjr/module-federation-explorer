function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

export function parsePerformanceSnapshot(value) {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.measurements)) {
    throw new Error('Invalid extension performance snapshot');
  }

  const measurements = value.measurements.map(measurement => {
    if (
      !isRecord(measurement) ||
      typeof measurement.name !== 'string' ||
      typeof measurement.durationMs !== 'number' ||
      !Number.isFinite(measurement.durationMs)
    ) {
      throw new Error('Invalid performance measurement');
    }
    return { name: measurement.name, durationMs: measurement.durationMs };
  });

  return {
    schemaVersion: 1,
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : undefined,
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : undefined,
    measurements,
    marks: Array.isArray(value.marks) ? value.marks : []
  };
}

export function latestMeasurement(snapshot, name) {
  for (let index = snapshot.measurements.length - 1; index >= 0; index -= 1) {
    const measurement = snapshot.measurements[index];
    if (measurement.name === name) return measurement.durationMs;
  }
  return undefined;
}

export function summarize(values) {
  const numericValues = values.filter(value => typeof value === 'number' && Number.isFinite(value));
  if (numericValues.length === 0) {
    return { count: 0, minMs: null, maxMs: null, medianMs: null, p95Ms: null };
  }

  const sorted = [...numericValues].sort((left, right) => left - right);
  const percentile = ratio => {
    const position = (sorted.length - 1) * ratio;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  };

  return {
    count: sorted.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95)
  };
}

export function formatMilliseconds(value) {
  return value === null || value === undefined ? 'n/a' : `${value.toFixed(1)} ms`;
}
