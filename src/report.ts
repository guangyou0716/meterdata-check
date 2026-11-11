import { format3, round3 } from './numbers.js';
import type { CheckResult, Finding, MeterSummary } from './types.js';

export interface ReportContext {
  intervalMinutes: number;
  spikeFactor: number;
  flatline: number;
  zeroRun: number;
  allowNegative: boolean;
  from: string | null;
  to: string | null;
}

function formatMetric(value: number | null): number | null {
  if (value === null) return null;
  return round3(value);
}

function roundMeter(meter: MeterSummary): MeterSummary {
  return {
    ...meter,
    coveragePercent: formatMetric(meter.coveragePercent),
    totalKwh: formatMetric(meter.totalKwh),
    maxDemandKw: formatMetric(meter.maxDemandKw),
    averageKw: formatMetric(meter.averageKw),
    loadFactor: formatMetric(meter.loadFactor),
  };
}

function findingLine(finding: Finding): string {
  const severity = finding.severity === 'error' ? 'ERROR' : 'WARN';
  const meter = finding.meterId === null ? '-' : finding.meterId;
  const rows = finding.rows.length === 0 ? '-' : finding.rows.join(',');
  const timestamp = finding.timestamp ?? '-';
  const quality = finding.quality === undefined ? '' : `  quality=${finding.quality}`;
  return `${severity}  ${finding.rule}  meter=${meter}  rows=${rows}  ${timestamp}${quality}\n  ${finding.message}`;
}

function meterBlock(meter: MeterSummary): string {
  const name = meter.meterId === '' ? '(blank meter id)' : meter.meterId;
  const coverage = meter.coveragePercent === null ? 'n/a' : `${format3(meter.coveragePercent)}%`;
  const total = meter.totalKwh === null ? 'n/a' : format3(meter.totalKwh);
  const demand =
    meter.maxDemandKw === null || meter.maxDemandTimestamp === null
      ? 'n/a'
      : `${format3(meter.maxDemandKw)} kW at ${meter.maxDemandTimestamp}`;
  const average = meter.averageKw === null ? 'n/a' : `${format3(meter.averageKw)} kW`;
  const load = meter.loadFactor === null ? 'n/a' : format3(meter.loadFactor);
  return [
    name,
    `  rows: ${meter.rows}`,
    `  expected intervals: ${meter.expectedIntervals}`,
    `  missing intervals: ${meter.missingIntervals}`,
    `  coverage: ${coverage}`,
    `  total kWh: ${total}`,
    `  max demand: ${demand}`,
    `  average: ${average}`,
    `  load factor: ${load}`,
  ].join('\n');
}

export function formatText(result: CheckResult, context?: ReportContext): string {
  const interval = context?.intervalMinutes ?? 30;
  const spike = context?.spikeFactor ?? 10;
  const flatline = context?.flatline ?? 8;
  const zeroRun = context?.zeroRun ?? 48;
  const negatives = context?.allowNegative ? 'allowed' : 'rejected';
  const lines = [
    'meterdata-check',
    `interval ${interval} min, spike factor ${spike}, flatline ${flatline}, zero-run ${zeroRun}, negatives ${negatives}`,
  ];
  if (context?.from !== undefined || context?.to !== undefined) {
    if (context.from !== null || context.to !== null) {
      lines.push(`bounds ${context.from ?? '(first timestamp)'} .. ${context.to ?? '(last timestamp)'}`);
    }
  }
  lines.push('');
  if (result.meters.length === 0) {
    lines.push('No meters.');
    lines.push('');
  } else {
    for (const meter of result.meters) {
      lines.push(meterBlock(meter));
      lines.push('');
    }
  }
  if (result.findings.length === 0) lines.push('No findings.');
  else for (const finding of result.findings) lines.push(findingLine(finding));
  const errors = result.counts.errors;
  const warnings = result.counts.warnings;
  lines.push(
    `${errors} ${errors === 1 ? 'error' : 'errors'}, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`,
  );
  return `${lines.join('\n')}\n`;
}

export function formatJson(result: CheckResult): string {
  return `${JSON.stringify(
    {
      version: result.version,
      meters: result.meters.map(roundMeter),
      findings: result.findings,
      counts: result.counts,
    },
    null,
    2,
  )}\n`;
}
