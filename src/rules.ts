import type { ResolvedOptions } from './options.js';
import { canonicalPoints, groupByMeter, parsedInstants } from './summary.js';
import type { CanonicalPoint } from './summary.js';
import { coverageOf, formatUtc, isAligned } from './time.js';
import type { Finding, ParsedRow } from './types.js';

function sharedQuality(rows: readonly { quality: string | null }[]): string | undefined {
  const first = rows[0];
  if (first === undefined || first.quality === null || first.quality === '') return undefined;
  for (const row of rows) {
    if (row.quality !== first.quality) return undefined;
  }
  return first.quality;
}

function withQuality(finding: Finding, quality: string | undefined): Finding {
  if (quality === undefined) return finding;
  return { ...finding, quality };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  const left = sorted[mid - 1];
  const right = sorted[mid];
  if (left === undefined || right === undefined) return 0;
  return (left + right) / 2;
}

function sameNumericValue(left: ParsedRow, right: ParsedRow): boolean {
  if (left.kwh !== null && right.kwh !== null) return left.kwh === right.kwh;
  return left.kwh === null && right.kwh === null && left.rawKwh === right.rawKwh;
}

function rowStructure(row: ParsedRow, options: ResolvedOptions): Finding[] {
  const findings: Finding[] = [];
  const quality = sharedQuality([row]);
  if (row.ms === null) {
    findings.push(
      withQuality(
        {
          rule: 'structure.timestamp',
          severity: 'error',
          meterId: row.meterId,
          rows: [row.line],
          timestamp: row.rawTimestamp === '' ? null : row.rawTimestamp,
          message: `Unparseable timestamp or missing offset: ${row.rawTimestamp === '' ? '(empty)' : row.rawTimestamp}`,
        },
        quality,
      ),
    );
  } else if (!isAligned(row.ms, options.intervalMs)) {
    findings.push(
      withQuality(
        {
          rule: 'time.alignment',
          severity: 'error',
          meterId: row.meterId,
          rows: [row.line],
          timestamp: row.rawTimestamp,
          message: `Timestamp ${row.rawTimestamp} is not on a ${options.intervalMinutes}-minute boundary`,
        },
        quality,
      ),
    );
  }
  if (row.kwh === null) {
    findings.push(
      withQuality(
        {
          rule: 'structure.value',
          severity: 'error',
          meterId: row.meterId,
          rows: [row.line],
          timestamp: row.rawTimestamp === '' ? null : row.rawTimestamp,
          message: `kWh is not a finite number: ${row.rawKwh === '' ? '(empty)' : row.rawKwh}`,
        },
        quality,
      ),
    );
  } else if (row.kwh < 0 && !options.allowNegative) {
    findings.push(
      withQuality(
        {
          rule: 'value.negative',
          severity: 'error',
          meterId: row.meterId,
          rows: [row.line],
          timestamp: row.rawTimestamp,
          message: `Negative kWh ${row.rawKwh}`,
        },
        quality,
      ),
    );
  }
  return findings;
}

function orderFindings(meterId: string, rows: readonly ParsedRow[]): Finding[] {
  const findings: Finding[] = [];
  let previous: ParsedRow | null = null;
  for (const row of rows) {
    if (row.ms === null) continue;
    if (previous !== null && previous.ms !== null && row.ms < previous.ms) {
      findings.push(
        withQuality(
          {
            rule: 'time.order',
            severity: 'warning',
            meterId,
            rows: [row.line],
            timestamp: row.rawTimestamp,
            message: `Timestamp ${row.rawTimestamp} is out of ascending order after row ${previous.line} (${previous.rawTimestamp})`,
          },
          sharedQuality([row]),
        ),
      );
    }
    previous = row;
  }
  return findings;
}

function duplicateFindings(meterId: string, rows: readonly ParsedRow[]): Finding[] {
  const findings: Finding[] = [];
  const seen = new Map<number, ParsedRow>();
  for (const row of rows) {
    if (row.ms === null) continue;
    const first = seen.get(row.ms);
    if (first === undefined) {
      seen.set(row.ms, row);
      continue;
    }
    const same = sameNumericValue(first, row);
    const when =
      first.rawTimestamp === row.rawTimestamp
        ? row.rawTimestamp
        : `${first.rawTimestamp} / ${row.rawTimestamp}`;
    findings.push(
      withQuality(
        {
          rule: 'time.duplicate',
          severity: same ? 'warning' : 'error',
          meterId,
          rows: [first.line, row.line],
          timestamp: row.rawTimestamp,
          message: same
            ? `Duplicate timestamp ${when} with the same kWh`
            : `Duplicate timestamp ${when} with conflicting kWh (${first.rawKwh} and ${row.rawKwh})`,
        },
        sharedQuality([first, row]),
      ),
    );
  }
  return findings;
}

/**
 * `--from` past the latest parsed reading, with `--to` omitted, is not a gap:
 * the open end collapses onto that reading and the window is empty.
 * Both bounds still use `time.gap`, including a window that sits entirely after the data.
 */
function fromAfterLastFindings(
  meterId: string,
  rows: readonly ParsedRow[],
  options: ResolvedOptions,
): Finding[] {
  const fromMs = options.fromMs;
  const fromRaw = options.fromRaw;
  if (fromMs === null || fromRaw === null || options.toMs !== null) return [];
  let lastMs: number | null = null;
  for (const row of rows) {
    if (row.ms === null) continue;
    if (lastMs === null || row.ms > lastMs) lastMs = row.ms;
  }
  if (lastMs === null || fromMs <= lastMs) return [];
  const lastText = formatUtc(lastMs);
  return [
    {
      rule: 'time.window',
      severity: 'warning',
      meterId,
      rows: [],
      timestamp: formatUtc(fromMs),
      message: `--from ${fromRaw} is after this meter's last reading ${lastText}; no rows are in the window`,
    },
  ];
}

function gapFindings(meterId: string, rows: readonly ParsedRow[], options: ResolvedOptions): Finding[] {
  const coverage = coverageOf(parsedInstants(rows), options.intervalMs, options.fromMs, options.toMs);
  return coverage.gaps.map((gap) => {
    const start = formatUtc(gap.start);
    const end = formatUtc(gap.end);
    const noun = gap.count === 1 ? 'interval' : 'intervals';
    return {
      rule: 'time.gap' as const,
      severity: 'error' as const,
      meterId,
      rows: [],
      timestamp: start,
      message: `Missing ${gap.count} ${noun} from ${start} to ${end}`,
      start,
      end,
      count: gap.count,
    };
  });
}

function spikeFindings(meterId: string, points: readonly CanonicalPoint[], options: ResolvedOptions): Finding[] {
  const positives = points.filter((point) => point.kwh > 0).map((point) => point.kwh);
  if (positives.length < 10) return [];
  const mid = median(positives);
  const threshold = options.spikeFactor * mid;
  const findings: Finding[] = [];
  for (const point of points) {
    if (point.kwh > threshold) {
      findings.push(
        withQuality(
          {
            rule: 'value.spike',
            severity: 'warning',
            meterId,
            rows: [point.line],
            timestamp: point.rawTimestamp,
            message: `kWh ${point.kwh} exceeds ${options.spikeFactor}× median ${mid}`,
          },
          sharedQuality([point]),
        ),
      );
    }
  }
  return findings;
}

function runFindings(meterId: string, points: readonly CanonicalPoint[], options: ResolvedOptions): Finding[] {
  const findings: Finding[] = [];
  let index = 0;
  while (index < points.length) {
    const origin = points[index];
    if (origin === undefined) break;
    let end = index + 1;
    while (end < points.length && points[end]?.kwh === origin.kwh) end += 1;
    const length = end - index;
    const run = points.slice(index, end);
    if (origin.kwh === 0 && length >= options.zeroRun) {
      const start = formatUtc(origin.ms);
      const last = run[run.length - 1] ?? origin;
      const finish = formatUtc(last.ms);
      findings.push(
        withQuality(
          {
            rule: 'value.zero-run',
            severity: 'warning',
            meterId,
            rows: run.map((point) => point.line),
            timestamp: origin.rawTimestamp,
            message: `${length} consecutive zero readings from ${start} to ${finish}`,
            start,
            end: finish,
            count: length,
          },
          sharedQuality(run),
        ),
      );
    } else if (origin.kwh !== 0 && length >= options.flatline) {
      const start = formatUtc(origin.ms);
      const last = run[run.length - 1] ?? origin;
      const finish = formatUtc(last.ms);
      findings.push(
        withQuality(
          {
            rule: 'value.flatline',
            severity: 'warning',
            meterId,
            rows: run.map((point) => point.line),
            timestamp: origin.rawTimestamp,
            message: `${length} consecutive identical non-zero readings of ${origin.kwh} kWh from ${start} to ${finish}`,
            start,
            end: finish,
            count: length,
          },
          sharedQuality(run),
        ),
      );
    }
    index = end;
  }
  return findings;
}

export function collectFindings(rows: readonly ParsedRow[], options: ResolvedOptions): Finding[] {
  const findings: Finding[] = [];
  for (const row of rows) findings.push(...rowStructure(row, options));
  for (const [meterId, meterRows] of groupByMeter(rows)) {
    const points = canonicalPoints(meterRows);
    findings.push(
      ...orderFindings(meterId, meterRows),
      ...duplicateFindings(meterId, meterRows),
      ...gapFindings(meterId, meterRows, options),
      ...fromAfterLastFindings(meterId, meterRows, options),
      ...spikeFindings(meterId, points, options),
      ...runFindings(meterId, points, options),
    );
  }
  return findings;
}
