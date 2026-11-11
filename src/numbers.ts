const KWH_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Parse a kWh token. Empty strings and non-finite values return null. */
export function parseKwh(raw: string): number | null {
  const text = raw.trim();
  if (!KWH_RE.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Round half away from zero to 3 decimal places, for displayed kWh and kW. */
export function round3(value: number): number {
  return Number(value.toFixed(3));
}

export function format3(value: number): string {
  return value.toFixed(3);
}

export function countsOf(findings: { severity: 'error' | 'warning' }[]): {
  errors: number;
  warnings: number;
} {
  let errors = 0;
  let warnings = 0;
  for (const finding of findings) {
    if (finding.severity === 'error') errors += 1;
    else warnings += 1;
  }
  return { errors, warnings };
}
