import { parseTimestamp, isAligned } from './time.js';
import type { CheckOptions } from './types.js';

export class CheckOptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckOptionsError';
  }
}

const ALLOWED_INTERVALS = new Set([1, 5, 10, 15, 30, 60]);

export interface ResolvedOptions {
  intervalMinutes: number;
  intervalMs: number;
  spikeFactor: number;
  flatline: number;
  zeroRun: number;
  allowNegative: boolean;
  fromMs: number | null;
  toMs: number | null;
  fromRaw: string | null;
  toRaw: string | null;
}

function requireTimestamp(label: string, raw: string): number {
  const ms = parseTimestamp(raw);
  if (ms === null) {
    throw new CheckOptionsError(`${label} must be an ISO 8601 timestamp with an explicit offset`);
  }
  return ms;
}

export function resolveOptions(options: CheckOptions = {}): ResolvedOptions {
  const intervalMinutes = options.intervalMinutes ?? 30;
  if (!ALLOWED_INTERVALS.has(intervalMinutes)) {
    throw new CheckOptionsError('--interval must be one of 1, 5, 10, 15, 30, 60');
  }
  const spikeFactor = options.spikeFactor ?? 10;
  if (!Number.isFinite(spikeFactor) || spikeFactor <= 0) {
    throw new CheckOptionsError('--spike-factor must be a finite number greater than 0');
  }
  const flatline = options.flatline ?? 8;
  if (!Number.isInteger(flatline) || flatline < 1) {
    throw new CheckOptionsError('--flatline must be an integer greater than or equal to 1');
  }
  const zeroRun = options.zeroRun ?? 48;
  if (!Number.isInteger(zeroRun) || zeroRun < 1) {
    throw new CheckOptionsError('--zero-run must be an integer greater than or equal to 1');
  }

  const intervalMs = intervalMinutes * 60_000;
  const fromRaw = options.from ?? null;
  const toRaw = options.to ?? null;
  const fromMs = fromRaw === null ? null : requireTimestamp('--from', fromRaw);
  const toMs = toRaw === null ? null : requireTimestamp('--to', toRaw);
  if (fromMs !== null && !isAligned(fromMs, intervalMs)) {
    throw new CheckOptionsError(`--from ${fromRaw} is not on a ${intervalMinutes}-minute boundary`);
  }
  if (toMs !== null && !isAligned(toMs, intervalMs)) {
    throw new CheckOptionsError(`--to ${toRaw} is not on a ${intervalMinutes}-minute boundary`);
  }
  if (fromMs !== null && toMs !== null && fromMs > toMs) {
    throw new CheckOptionsError('--from is after --to');
  }

  return {
    intervalMinutes,
    intervalMs,
    spikeFactor,
    flatline,
    zeroRun,
    allowNegative: options.allowNegative ?? false,
    fromMs,
    toMs,
    fromRaw,
    toRaw,
  };
}
