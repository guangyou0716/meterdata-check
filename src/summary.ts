import { coverageOf, formatUtc } from './time.js';
import type { ResolvedOptions } from './options.js';
import type { MeterSummary, ParsedRow } from './types.js';

/** First finite kWh at each timestamp. Later duplicates do not add energy. */
export interface CanonicalPoint {
  line: number;
  ms: number;
  rawTimestamp: string;
  kwh: number;
  quality: string | null;
}

export function groupByMeter(rows: readonly ParsedRow[]): Map<string, ParsedRow[]> {
  const groups = new Map<string, ParsedRow[]>();
  for (const row of rows) {
    const list = groups.get(row.meterId);
    if (list === undefined) groups.set(row.meterId, [row]);
    else list.push(row);
  }
  return groups;
}

export function canonicalPoints(rows: readonly ParsedRow[]): CanonicalPoint[] {
  const first = new Map<number, ParsedRow>();
  for (const row of rows) {
    if (row.ms === null || first.has(row.ms)) continue;
    first.set(row.ms, row);
  }
  const points: CanonicalPoint[] = [];
  for (const row of first.values()) {
    if (row.ms === null || row.kwh === null) continue;
    points.push({
      line: row.line,
      ms: row.ms,
      rawTimestamp: row.rawTimestamp,
      kwh: row.kwh,
      quality: row.quality,
    });
  }
  points.sort((left, right) => left.ms - right.ms || left.line - right.line);
  return points;
}

export function parsedInstants(rows: readonly ParsedRow[]): number[] {
  const times: number[] = [];
  for (const row of rows) {
    if (row.ms !== null) times.push(row.ms);
  }
  return times;
}

/**
 * Per-meter summary.
 * Total kWh and demand use the first finite row at each timestamp.
 * Average kW is the mean of those rows; missing intervals stay in `coveragePercent`
 * and are not filled with zero. Load factor is average kW / max kW.
 */
export function summarize(rows: readonly ParsedRow[], options: ResolvedOptions): MeterSummary[] {
  const summaries: MeterSummary[] = [];
  for (const [meterId, meterRows] of groupByMeter(rows)) {
    const points = canonicalPoints(meterRows);
    const coverage = coverageOf(parsedInstants(meterRows), options.intervalMs, options.fromMs, options.toMs);
    let total = 0;
    let maxKwh: number | null = null;
    let maxMs: number | null = null;
    for (const point of points) {
      total += point.kwh;
      if (maxKwh === null || point.kwh > maxKwh) {
        maxKwh = point.kwh;
        maxMs = point.ms;
      }
    }
    const count = points.length;
    const totalKwh = count === 0 ? null : total;
    const maxDemandKw = maxKwh === null ? null : (maxKwh * 60) / options.intervalMinutes;
    const averageKw =
      totalKwh === null || count === 0 ? null : (totalKwh / count) * (60 / options.intervalMinutes);
    const loadFactor =
      averageKw === null || maxDemandKw === null || maxDemandKw === 0 ? null : averageKw / maxDemandKw;
    const coveragePercent =
      coverage.expected === 0 ? null : ((coverage.expected - coverage.missing) * 100) / coverage.expected;
    summaries.push({
      meterId,
      rows: meterRows.length,
      expectedIntervals: coverage.expected,
      missingIntervals: coverage.missing,
      coveragePercent,
      totalKwh,
      maxDemandKw,
      maxDemandTimestamp: maxMs === null ? null : formatUtc(maxMs),
      averageKw,
      loadFactor,
    });
  }
  return summaries;
}
