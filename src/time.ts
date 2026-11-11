const TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2}|[+-]\d{4})$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1] ?? 0;
}

/**
 * Parse an ISO 8601 timestamp that carries an explicit offset (`Z` or `±HH:MM` / `±HHMM`).
 * Returns UTC epoch milliseconds, or null when the text is not a real timestamp with an offset.
 * Fractional seconds are kept so a non-zero fraction fails interval alignment.
 * `24:00:00` with minutes, seconds, and fraction all zero is midnight at the end of that day:
 * the same instant as the next day's `00:00:00` with the same offset. Any other hour 24 is rejected.
 */
export function parseTimestamp(raw: string): number | null {
  const match = TIMESTAMP_RE.exec(raw.trim());
  if (match === null) return null;
  const yearText = match[1];
  const monthText = match[2];
  const dayText = match[3];
  const hourText = match[4];
  const minuteText = match[5];
  const zone = match[8];
  if (
    yearText === undefined ||
    monthText === undefined ||
    dayText === undefined ||
    hourText === undefined ||
    minuteText === undefined ||
    zone === undefined
  ) {
    return null;
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  let hour = Number(hourText);
  const minute = Number(minuteText);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (minute > 59 || second > 59) return null;

  let extraMs = 0;
  const frac = match[7];
  if (frac !== undefined) {
    extraMs = Math.round(Number(`0${frac}`) * 1000);
    if (extraMs === 0 && /[1-9]/.test(frac)) extraMs = 1;
  }

  // 24:00:00 is the only legal use of hour 24. Date.UTC rolls the extra day into the next month and year.
  let utcDay = day;
  if (hour === 24) {
    if (minute !== 0 || second !== 0 || extraMs !== 0) return null;
    hour = 0;
    utcDay += 1;
  } else if (hour > 23) {
    return null;
  }

  let offsetMinutes = 0;
  if (zone !== 'Z' && zone !== 'z') {
    const sign = zone[0] === '+' ? 1 : -1;
    const digits = zone.includes(':') ? `${zone.slice(1, 3)}${zone.slice(4, 6)}` : zone.slice(1);
    const offsetHour = Number(digits.slice(0, 2));
    const offsetMinute = Number(digits.slice(2, 4));
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offsetMinutes = sign * (offsetHour * 60 + offsetMinute);
  }

  return Date.UTC(year, month - 1, utcDay, hour, minute, second) - offsetMinutes * 60_000 + extraMs;
}

/** True when `ms` lands on an interval boundary in UTC epoch minutes. */
export function isAligned(ms: number, intervalMs: number): boolean {
  return ms % intervalMs === 0;
}

function ceilToGrid(ms: number, intervalMs: number): number {
  const rem = ms % intervalMs;
  if (rem === 0) return ms;
  if (rem > 0) return ms + (intervalMs - rem);
  return ms - rem;
}

function floorToGrid(ms: number, intervalMs: number): number {
  const rem = ms % intervalMs;
  if (rem === 0) return ms;
  if (rem > 0) return ms - rem;
  return ms - intervalMs - rem;
}

/** Inclusive aligned instants from `startMs` through `endMs`. Empty when the span holds none. */
export function intervalGrid(startMs: number, endMs: number, intervalMs: number): number[] {
  const first = ceilToGrid(startMs, intervalMs);
  const last = floorToGrid(endMs, intervalMs);
  if (first > last) return [];
  const slots: number[] = [];
  for (let cursor = first; cursor <= last; cursor += intervalMs) {
    slots.push(cursor);
  }
  return slots;
}

export function formatUtc(ms: number): string {
  return new Date(ms).toISOString();
}

export interface Coverage {
  expected: number;
  missing: number;
  /** Contiguous runs of missing slots. `start` and `end` are inclusive. */
  gaps: { start: number; end: number; count: number }[];
}

/**
 * Expected interval-end slots between the earliest and latest parsed instants,
 * replaced on either side when `fromMs` / `toMs` is set.
 * A slot is present when any row has that exact UTC instant.
 */
export function coverageOf(
  times: readonly number[],
  intervalMs: number,
  fromMs: number | null,
  toMs: number | null,
): Coverage {
  let minTs: number | null = null;
  let maxTs: number | null = null;
  for (const time of times) {
    if (minTs === null || time < minTs) minTs = time;
    if (maxTs === null || time > maxTs) maxTs = time;
  }
  const start = fromMs ?? minTs;
  const end = toMs ?? maxTs;
  if (start === null || end === null || start > end) {
    return { expected: 0, missing: 0, gaps: [] };
  }
  const slots = intervalGrid(start, end, intervalMs);
  const present = new Set(times);
  const missingSlots = slots.filter((slot) => !present.has(slot));
  const gaps: { start: number; end: number; count: number }[] = [];
  let runStart = 0;
  while (runStart < missingSlots.length) {
    let runEnd = runStart;
    while (
      runEnd + 1 < missingSlots.length &&
      missingSlots[runEnd + 1] === (missingSlots[runEnd] ?? 0) + intervalMs
    ) {
      runEnd += 1;
    }
    const startSlot = missingSlots[runStart];
    const endSlot = missingSlots[runEnd];
    if (startSlot !== undefined && endSlot !== undefined) {
      gaps.push({ start: startSlot, end: endSlot, count: runEnd - runStart + 1 });
    }
    runStart = runEnd + 1;
  }
  return { expected: slots.length, missing: missingSlots.length, gaps };
}
