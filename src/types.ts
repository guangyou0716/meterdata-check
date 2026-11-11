export type Severity = 'error' | 'warning';

export type RuleId =
  | 'structure.header'
  | 'structure.timestamp'
  | 'structure.value'
  | 'time.alignment'
  | 'time.duplicate'
  | 'time.order'
  | 'time.gap'
  | 'time.window'
  | 'value.negative'
  | 'value.spike'
  | 'value.zero-run'
  | 'value.flatline';

/** One data-quality finding. `rows` is empty when there is no source row (a gap, or an empty window). */
export interface Finding {
  rule: RuleId;
  severity: Severity;
  meterId: string | null;
  /** 1-based line numbers in the CSV file. */
  rows: number[];
  /** Source timestamp, or the gap start when the finding has no source row. */
  timestamp: string | null;
  message: string;
  /** First missing or run-start instant (UTC). */
  start?: string;
  /** Last missing or run-end instant (UTC). */
  end?: string;
  /** Missing intervals, or readings in a zero-run or flatline. */
  count?: number;
  /** Copied from the `quality` column when every referenced row shares one value. */
  quality?: string;
}

export interface MeterSummary {
  meterId: string;
  /** Data rows for this meter, including invalid rows and duplicate timestamps. */
  rows: number;
  /** Aligned interval-end slots in the meter's window (or the `--from`/`--to` window). */
  expectedIntervals: number;
  missingIntervals: number;
  /** `100 * (expected - missing) / expected`, or null when nothing was expected. */
  coveragePercent: number | null;
  /** Sum of kWh on the first finite row at each timestamp. Null when there are none. */
  totalKwh: number | null;
  /** `max(kWh) * 60 / intervalMinutes` over those same rows. */
  maxDemandKw: number | null;
  /** UTC timestamp of the earliest row that holds the max kWh. */
  maxDemandTimestamp: string | null;
  /** Mean demand of the rows included in `totalKwh`. Gaps are not treated as zero. */
  averageKw: number | null;
  /** `averageKw / maxDemandKw`, or null when max demand is zero or unknown. */
  loadFactor: number | null;
}

export interface Counts {
  errors: number;
  warnings: number;
}

export interface CheckResult {
  version: 1;
  meters: MeterSummary[];
  findings: Finding[];
  counts: Counts;
}

export interface CheckOptions {
  /** Interval length in minutes. Allowed: 1, 5, 10, 15, 30, 60. Default 30. */
  intervalMinutes?: number;
  /** A reading above this multiple of the median positive kWh is a spike. Default 10. */
  spikeFactor?: number;
  /** Consecutive identical non-zero readings that count as a stuck register. Default 8. */
  flatline?: number;
  /** Consecutive zero readings that count as a zero run. Default 48. */
  zeroRun?: number;
  /** When true, negative kWh is allowed (export or bidirectional meters). */
  allowNegative?: boolean;
  /** Inclusive expected-period start, ISO 8601 with an explicit offset. */
  from?: string;
  /** Inclusive expected-period end, ISO 8601 with an explicit offset. */
  to?: string;
}

/** A CSV data row after timestamp and kWh parsing. */
export interface ParsedRow {
  line: number;
  meterId: string;
  rawTimestamp: string;
  rawKwh: string;
  /** UTC epoch milliseconds, or null when the timestamp could not be parsed. */
  ms: number | null;
  /** Parsed kWh, or null when the field is not a finite number. */
  kwh: number | null;
  quality: string | null;
}
