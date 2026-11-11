export function meterCsv(rows: readonly string[], header = 'meter_id,timestamp,kwh'): string {
  return [header, ...rows].join('\n');
}

/** Interval-end timestamps starting at 2024-01-01T00:30:00Z. */
export function stamp(steps: number, intervalMinutes = 30): string {
  const ms = Date.UTC(2024, 0, 1, 0, 30, 0) + steps * intervalMinutes * 60_000;
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

export function series(count: number, kwh: number | string, intervalMinutes = 30): string[] {
  const rows: string[] = [];
  for (let index = 0; index < count; index += 1) {
    rows.push(`M,${stamp(index, intervalMinutes)},${kwh}`);
  }
  return rows;
}
