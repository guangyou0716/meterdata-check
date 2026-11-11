import { extractMeterRows } from './csv.js';
import { countsOf, parseKwh } from './numbers.js';
import { resolveOptions } from './options.js';
import { collectFindings } from './rules.js';
import { summarize } from './summary.js';
import { parseTimestamp } from './time.js';
import type { CheckOptions, CheckResult, ParsedRow } from './types.js';

export type {
  CheckOptions,
  CheckResult,
  Counts,
  Finding,
  MeterSummary,
  RuleId,
  Severity,
} from './types.js';
export { CheckOptionsError } from './options.js';
export { formatJson, formatText } from './report.js';
export type { ReportContext } from './report.js';

function enrich(text: string): { headerLine: number | null; missing: string[]; rows: ParsedRow[] } {
  const table = extractMeterRows(text);
  const rows: ParsedRow[] = table.rows.map((row) => ({
    line: row.line,
    meterId: row.meterId,
    rawTimestamp: row.rawTimestamp,
    rawKwh: row.rawKwh,
    ms: parseTimestamp(row.rawTimestamp),
    kwh: parseKwh(row.rawKwh),
    quality: row.quality,
  }));
  return { headerLine: table.headerLine, missing: table.missing, rows };
}

/** Check interval-meter CSV text. Throws CheckOptionsError when options are invalid. */
export function check(csvText: string, options: CheckOptions = {}): CheckResult {
  const resolved = resolveOptions(options);
  const table = enrich(csvText);
  if (table.missing.length > 0) {
    const findings = [
      {
        rule: 'structure.header' as const,
        severity: 'error' as const,
        meterId: null,
        rows: table.headerLine === null ? [] : [table.headerLine],
        timestamp: null,
        message: `Missing required column(s): ${table.missing.join(', ')}`,
      },
    ];
    return { version: 1, meters: [], findings, counts: countsOf(findings) };
  }
  const findings = collectFindings(table.rows, resolved);
  const meters = summarize(table.rows, resolved);
  return { version: 1, meters, findings, counts: countsOf(findings) };
}
