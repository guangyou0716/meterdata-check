import { describe, expect, it } from 'vitest';
import { check, CheckOptionsError } from '../src/index.js';
import { meterCsv, series, stamp } from './helpers.js';

function ruleNames(csv: string, options?: Parameters<typeof check>[1]): string[] {
  return check(csv, options).findings.map((finding) => finding.rule);
}

describe('structure.header', () => {
  it('triggers when a required column is missing', () => {
    const result = check('meter_id,timestamp\nM,2024-06-01T00:30:00Z\n');
    expect(result.findings).toEqual([
      {
        rule: 'structure.header',
        severity: 'error',
        meterId: null,
        rows: [1],
        timestamp: null,
        message: 'Missing required column(s): kwh',
      },
    ]);
    expect(result.meters).toEqual([]);
  });

  it('does not trigger when the required columns are present in any order', () => {
    const reordered = check(meterCsv(['1,2024-06-01T00:30:00Z,M'], 'kwh,timestamp,meter_id'));
    expect(reordered.findings).toEqual([]);
    expect(ruleNames(meterCsv(['M,1,2024-06-01T00:30:00Z'], 'meter_id,kwh,timestamp'))).not.toContain(
      'structure.header',
    );
  });
});

describe('structure.timestamp', () => {
  it('triggers when the offset is missing or the calendar date is impossible', () => {
    const result = check(
      meterCsv(['M,2024-06-01T00:30:00,1', 'M,2023-02-29T00:30:00Z,1', 'M,2024-13-01T00:00:00Z,1']),
    );
    const timestampFindings = result.findings.filter((finding) => finding.rule === 'structure.timestamp');
    expect(timestampFindings).toHaveLength(3);
    expect(timestampFindings.every((finding) => finding.severity === 'error')).toBe(true);
  });

  it('does not trigger for Z, numeric offsets, or a leap day', () => {
    const result = check(
      meterCsv([
        'M,2024-06-01T00:30:00Z,1',
        'M,2024-06-01T01:00:00+00:00,1',
        'M,2024-06-01T09:30:00+08:00,1',
        'M,2024-02-29T02:00:00Z,1',
      ]),
    );
    expect(result.findings.filter((finding) => finding.rule === 'structure.timestamp')).toEqual([]);
  });
});

describe('structure.value', () => {
  it('triggers when kWh is blank, text, or non-finite', () => {
    const result = check(
      meterCsv([
        `M,${stamp(0)},`,
        `M,${stamp(1)},abc`,
        `M,${stamp(2)},Infinity`,
        `M,${stamp(3)},NaN`,
      ]),
    );
    const valueFindings = result.findings.filter((finding) => finding.rule === 'structure.value');
    expect(valueFindings).toHaveLength(4);
    expect(valueFindings.every((finding) => finding.severity === 'error')).toBe(true);
  });

  it('does not trigger for finite decimals, zero, or scientific notation', () => {
    const result = check(meterCsv([`M,${stamp(0)},1.5`, `M,${stamp(1)},0`, `M,${stamp(2)},1e1`]));
    expect(result.findings.filter((finding) => finding.rule === 'structure.value')).toEqual([]);
    expect(result.meters[0]?.totalKwh).toBe(11.5);
  });
});

describe('time.alignment', () => {
  it('triggers when the UTC instant is off the interval', () => {
    const result = check(
      meterCsv(['M,2024-06-01T00:15:00Z,1', 'M,2024-06-01T00:30:01Z,1', 'M,2024-06-01T00:30:00.001Z,1']),
    );
    const alignment = result.findings.filter((finding) => finding.rule === 'time.alignment');
    expect(alignment).toHaveLength(3);
    expect(alignment[0]?.message).toContain('30-minute');
  });

  it('uses UTC epoch minutes, so a +05:30 local hour is not a 60-minute boundary', () => {
    const off = check('meter_id,timestamp,kwh\nM,2024-01-01T01:00:00+05:30,1\n', { intervalMinutes: 60 });
    const on = check('meter_id,timestamp,kwh\nM,2024-01-01T01:30:00+05:30,1\n', { intervalMinutes: 60 });
    expect(off.findings.map((finding) => finding.rule)).toContain('time.alignment');
    expect(on.findings.map((finding) => finding.rule)).not.toContain('time.alignment');
  });

  it('does not trigger when the instant is on the selected boundary', () => {
    const halfHour = check(meterCsv(['M,2024-06-01T00:30:00+08:00,1', 'M,2024-06-01T01:00:00Z,1']));
    const quarter = check(meterCsv(['M,2024-06-01T00:15:00Z,1', 'M,2024-06-01T00:30:00Z,1']), {
      intervalMinutes: 15,
    });
    expect(halfHour.findings.filter((finding) => finding.rule === 'time.alignment')).toEqual([]);
    expect(quarter.findings.filter((finding) => finding.rule === 'time.alignment')).toEqual([]);
  });
});

describe('time.duplicate', () => {
  it('warns when the same instant repeats with an equal parsed number', () => {
    const result = check(
      meterCsv(['M,2024-06-01T00:30:00Z,1', 'M,2024-06-01T00:30:00+00:00,1.0', 'M,2024-06-01T01:00:00Z,2']),
    );
    const duplicates = result.findings.filter((finding) => finding.rule === 'time.duplicate');
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.severity).toBe('warning');
    expect(duplicates[0]?.rows).toEqual([2, 3]);
    expect(result.counts.errors).toBe(0);
  });

  it('is an error when the same instant has conflicting kWh', () => {
    const result = check(meterCsv(['M,2024-06-01T00:30:00Z,1', 'M,2024-06-01T00:30:00Z,1.0001']));
    const duplicates = result.findings.filter((finding) => finding.rule === 'time.duplicate');
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.severity).toBe('error');
    expect(duplicates[0]?.message).toContain('1');
    expect(duplicates[0]?.message).toContain('1.0001');
  });

  it('does not trigger when every instant is unique', () => {
    expect(ruleNames(meterCsv(series(3, 1)))).not.toContain('time.duplicate');
  });
});

describe('time.order', () => {
  it('warns when a later row goes backwards in time', () => {
    const result = check(meterCsv(['M,2024-06-01T01:00:00Z,1', 'M,2024-06-01T00:30:00Z,1']));
    const order = result.findings.filter((finding) => finding.rule === 'time.order');
    expect(order).toEqual([
      expect.objectContaining({
        severity: 'warning',
        rows: [3],
        message: 'Timestamp 2024-06-01T00:30:00Z is out of ascending order after row 2 (2024-06-01T01:00:00Z)',
      }),
    ]);
  });

  it('does not trigger for ascending rows or an equal timestamp', () => {
    const ascending = ruleNames(meterCsv(series(3, 1)));
    const equal = ruleNames(meterCsv(['M,2024-06-01T00:30:00Z,1', 'M,2024-06-01T00:30:00Z,1']));
    expect(ascending).not.toContain('time.order');
    expect(equal).not.toContain('time.order');
  });

  it('copies quality from the out-of-order row when that row has one', () => {
    const header = 'meter_id,timestamp,kwh,quality';
    const shared = check(
      meterCsv(
        ['A,2024-06-01T01:00:00Z,1,AAA', 'B,2024-06-01T01:00:00Z,1,BBB', 'A,2024-06-01T00:30:00Z,1,AAA'],
        header,
      ),
    );
    expect(shared.findings.filter((finding) => finding.rule === 'time.order')).toEqual([
      expect.objectContaining({
        meterId: 'A',
        severity: 'warning',
        rows: [4],
        quality: 'AAA',
      }),
    ]);

    const differs = check(
      meterCsv(['M,2024-06-01T01:00:00Z,1,EARLY', 'M,2024-06-01T00:30:00Z,1,LATE'], header),
    );
    expect(differs.findings.find((finding) => finding.rule === 'time.order')?.quality).toBe('LATE');

    const blank = check(
      meterCsv(['M,2024-06-01T01:00:00Z,1,EARLY', 'M,2024-06-01T00:30:00Z,1,'], header),
    );
    expect(blank.findings.find((finding) => finding.rule === 'time.order')?.quality).toBeUndefined();
  });
});

describe('time.gap', () => {
  it('triggers once per contiguous hole and counts the missing intervals', () => {
    const one = check(meterCsv(['M,2024-06-01T00:30:00Z,1', 'M,2024-06-01T01:30:00Z,1']));
    const gap = one.findings.find((finding) => finding.rule === 'time.gap');
    expect(gap).toMatchObject({
      severity: 'error',
      rows: [],
      count: 1,
      start: '2024-06-01T01:00:00.000Z',
      end: '2024-06-01T01:00:00.000Z',
      message: 'Missing 1 interval from 2024-06-01T01:00:00.000Z to 2024-06-01T01:00:00.000Z',
    });

    const block = check(
      meterCsv(['M,2024-06-01T00:30:00Z,1', 'M,2024-06-01T02:30:00Z,1']),
    );
    const blockGap = block.findings.find((finding) => finding.rule === 'time.gap');
    expect(blockGap).toMatchObject({
      count: 3,
      start: '2024-06-01T01:00:00.000Z',
      end: '2024-06-01T02:00:00.000Z',
      message: 'Missing 3 intervals from 2024-06-01T01:00:00.000Z to 2024-06-01T02:00:00.000Z',
    });
  });

  it('emits separate findings for holes that are not contiguous', () => {
    const result = check(
      meterCsv([
        'M,2024-06-01T00:30:00Z,1',
        'M,2024-06-01T01:30:00Z,1',
        'M,2024-06-01T02:00:00Z,1',
        'M,2024-06-01T03:00:00Z,1',
      ]),
    );
    const gaps = result.findings.filter((finding) => finding.rule === 'time.gap');
    expect(gaps.map((finding) => finding.start)).toEqual([
      '2024-06-01T01:00:00.000Z',
      '2024-06-01T02:30:00.000Z',
    ]);
  });

  it('does not trigger when every slot from the first timestamp to the last is present', () => {
    expect(ruleNames(meterCsv(series(4, 1)))).not.toContain('time.gap');
  });

  it('uses --from and --to as the window, including edge holes', () => {
    const csv = meterCsv(['M,2024-06-01T01:00:00Z,1', 'M,2024-06-01T01:30:00Z,1']);
    const edged = check(csv, { from: '2024-06-01T00:30:00Z', to: '2024-06-01T02:00:00Z' });
    const gaps = edged.findings.filter((finding) => finding.rule === 'time.gap');
    expect(gaps.map((finding) => [finding.start, finding.count])).toEqual([
      ['2024-06-01T00:30:00.000Z', 1],
      ['2024-06-01T02:00:00.000Z', 1],
    ]);
    expect(edged.meters[0]).toMatchObject({ expectedIntervals: 4, missingIntervals: 2, coveragePercent: 50 });

    const clipped = check(csv, { from: '2024-06-01T01:00:00Z', to: '2024-06-01T01:30:00Z' });
    expect(clipped.findings.filter((finding) => finding.rule === 'time.gap')).toEqual([]);
    expect(clipped.meters[0]).toMatchObject({ expectedIntervals: 2, missingIntervals: 0 });
  });

  it('rejects a bound that is unaligned or reversed', () => {
    expect(() => check(meterCsv(series(1, 1)), { from: '2024-06-01T00:15:00Z' })).toThrow(CheckOptionsError);
    expect(() =>
      check(meterCsv(series(1, 1)), { from: '2024-06-01T02:00:00Z', to: '2024-06-01T01:00:00Z' }),
    ).toThrow(/--from is after --to/);
  });

  it('keeps meters apart', () => {
    const result = check(
      meterCsv(['A,2024-06-01T00:30:00Z,1', 'A,2024-06-01T01:00:00Z,1', 'B,2024-06-01T00:30:00Z,1', 'B,2024-06-01T01:30:00Z,1']),
    );
    const gaps = result.findings.filter((finding) => finding.rule === 'time.gap');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.meterId).toBe('B');
  });
});

describe('time.window', () => {
  it('warns when --from is after the last reading and --to is omitted', () => {
    const result = check(meterCsv(['M,2024-06-01T00:30:00Z,1', 'M,2024-06-01T01:00:00Z,2']), {
      from: '2024-06-01T01:30:00Z',
    });
    expect(result.findings).toEqual([
      {
        rule: 'time.window',
        severity: 'warning',
        meterId: 'M',
        rows: [],
        timestamp: '2024-06-01T01:30:00.000Z',
        message:
          "--from 2024-06-01T01:30:00Z is after this meter's last reading 2024-06-01T01:00:00.000Z; no rows are in the window",
      },
    ]);
    expect(result.meters[0]).toMatchObject({
      rows: 2,
      expectedIntervals: 0,
      missingIntervals: 0,
      coveragePercent: null,
      totalKwh: 3,
    });
    expect(result.counts).toEqual({ errors: 0, warnings: 1 });
  });

  it('uses the latest parsed instant, not the last row in the file', () => {
    const inside = check(
      meterCsv(['M,2024-06-01T02:00:00Z,1', 'M,2024-06-01T00:30:00Z,1']),
      { from: '2024-06-01T01:00:00Z' },
    );
    expect(inside.findings.map((finding) => finding.rule)).toEqual(['time.order', 'time.gap']);
    expect(inside.meters[0]).toMatchObject({ expectedIntervals: 3, missingIntervals: 2, coveragePercent: 100 / 3 });

    const after = check(
      meterCsv(['M,2024-06-01T01:00:00Z,1', 'M,2024-06-01T00:30:00Z,1']),
      { from: '2024-06-01T01:30:00Z' },
    );
    expect(after.findings.map((finding) => finding.rule)).toEqual(['time.order', 'time.window']);
    expect(after.meters[0]).toMatchObject({ expectedIntervals: 0, coveragePercent: null });
  });

  it('does not attach quality, because the finding has no source rows', () => {
    const result = check(
      meterCsv(['M,2024-06-01T00:30:00Z,1,EST'], 'meter_id,timestamp,kwh,quality'),
      { from: '2024-06-01T01:00:00Z' },
    );
    const finding = result.findings.find((item) => item.rule === 'time.window');
    expect(finding?.rows).toEqual([]);
    expect(finding?.quality).toBeUndefined();
  });

  it('warns only for the meter whose last reading is before --from', () => {
    const result = check(
      meterCsv([
        'A,2024-06-01T00:30:00Z,1',
        'A,2024-06-01T01:00:00Z,1',
        'B,2024-06-01T02:00:00Z,1',
        'B,2024-06-01T02:30:00Z,1',
      ]),
      { from: '2024-06-01T01:30:00Z' },
    );
    const windows = result.findings.filter((finding) => finding.rule === 'time.window');
    const gaps = result.findings.filter((finding) => finding.rule === 'time.gap');
    expect(windows.map((finding) => finding.meterId)).toEqual(['A']);
    expect(gaps.map((finding) => finding.meterId)).toEqual(['B']);
    expect(gaps[0]).toMatchObject({ count: 1, start: '2024-06-01T01:30:00.000Z' });
    expect(result.meters[0]).toMatchObject({ meterId: 'A', expectedIntervals: 0, coveragePercent: null });
    expect(result.meters[1]).toMatchObject({
      meterId: 'B',
      expectedIntervals: 3,
      missingIntervals: 1,
      coveragePercent: 200 / 3,
    });
  });

  it('keeps leading and trailing gaps, and a fully later window when both bounds are set', () => {
    const csv = meterCsv(['M,2024-06-01T01:00:00Z,1', 'M,2024-06-01T01:30:00Z,1']);
    const leading = check(csv, { from: '2024-06-01T00:30:00Z' });
    expect(leading.findings.filter((finding) => finding.rule === 'time.window')).toEqual([]);
    expect(leading.findings.filter((finding) => finding.rule === 'time.gap')).toMatchObject([
      { count: 1, start: '2024-06-01T00:30:00.000Z' },
    ]);
    expect(leading.meters[0]).toMatchObject({ expectedIntervals: 3, missingIntervals: 1 });

    const trailing = check(csv, { to: '2024-06-01T02:00:00Z' });
    expect(trailing.findings.filter((finding) => finding.rule === 'time.window')).toEqual([]);
    expect(trailing.findings.filter((finding) => finding.rule === 'time.gap')).toMatchObject([
      { count: 1, start: '2024-06-01T02:00:00.000Z' },
    ]);

    const later = check(csv, { from: '2024-06-01T02:00:00Z', to: '2024-06-01T03:00:00Z' });
    expect(later.findings.filter((finding) => finding.rule === 'time.window')).toEqual([]);
    expect(later.findings.filter((finding) => finding.rule === 'time.gap')).toMatchObject([
      { count: 3, start: '2024-06-01T02:00:00.000Z', end: '2024-06-01T03:00:00.000Z' },
    ]);
    expect(later.meters[0]).toMatchObject({ expectedIntervals: 3, missingIntervals: 3, coveragePercent: 0 });
  });

  it('does not warn when --from equals the last reading, or when nothing parsed', () => {
    const exact = check(meterCsv(['M,2024-06-01T01:00:00Z,1']), { from: '2024-06-01T01:00:00Z' });
    expect(exact.findings).toEqual([]);
    expect(exact.meters[0]).toMatchObject({ expectedIntervals: 1, missingIntervals: 0, coveragePercent: 100 });

    const unparsed = check(meterCsv(['M,not-a-time,1']), { from: '2024-06-01T00:30:00Z' });
    expect(unparsed.findings.map((finding) => finding.rule)).toEqual(['structure.timestamp']);
    expect(unparsed.meters[0]).toMatchObject({ expectedIntervals: 0, coveragePercent: null });
  });

  it('leaves --to before the first reading unchanged, and still rejects reversed bounds', () => {
    const early = check(meterCsv(['M,2024-06-01T01:00:00Z,1']), { to: '2024-06-01T00:30:00Z' });
    expect(early.findings.filter((finding) => finding.rule === 'time.window')).toEqual([]);
    expect(early.findings.filter((finding) => finding.rule === 'time.gap')).toEqual([]);
    expect(early.meters[0]).toMatchObject({ expectedIntervals: 0, coveragePercent: null });

    expect(() =>
      check(meterCsv(series(1, 1)), { from: '2024-06-01T02:00:00Z', to: '2024-06-01T01:00:00Z' }),
    ).toThrow(/--from is after --to/);
  });
});

describe('value.negative', () => {
  it('triggers for a negative kWh unless --allow-negative is set', () => {
    const blocked = check(meterCsv(['M,2024-06-01T00:30:00Z,-1.5']));
    expect(blocked.findings).toEqual([
      expect.objectContaining({ rule: 'value.negative', severity: 'error', rows: [2] }),
    ]);
    const allowed = check(meterCsv(['M,2024-06-01T00:30:00Z,-1.5']), { allowNegative: true });
    expect(allowed.findings.filter((finding) => finding.rule === 'value.negative')).toEqual([]);
    expect(allowed.meters[0]?.totalKwh).toBe(-1.5);
  });

  it('does not trigger for zero or a positive reading', () => {
    const result = check(meterCsv(['M,2024-06-01T00:30:00Z,0', 'M,2024-06-01T01:00:00Z,-0', 'M,2024-06-01T01:30:00Z,2']));
    expect(result.findings.filter((finding) => finding.rule === 'value.negative')).toEqual([]);
  });
});

describe('value.spike', () => {
  it('triggers when a value is strictly above spike-factor times the median', () => {
    const rows = [...series(10, 1), `M,${stamp(10)},11`];
    const result = check(meterCsv(rows));
    const spikes = result.findings.filter((finding) => finding.rule === 'value.spike');
    expect(spikes).toHaveLength(1);
    expect(spikes[0]).toMatchObject({
      severity: 'warning',
      message: 'kWh 11 exceeds 10× median 1',
    });
  });

  it('does not trigger at exactly the threshold or with fewer than 10 positive readings', () => {
    const exact = check(meterCsv([...series(9, 1), `M,${stamp(9)},10`]));
    const tooFew = check(meterCsv([...series(8, 1), `M,${stamp(8)},1000`]));
    const raised = check(meterCsv([...series(10, 1), `M,${stamp(10)},11`]), { spikeFactor: 100 });
    expect(exact.findings.filter((finding) => finding.rule === 'value.spike')).toEqual([]);
    expect(tooFew.findings.filter((finding) => finding.rule === 'value.spike')).toEqual([]);
    expect(raised.findings.filter((finding) => finding.rule === 'value.spike')).toEqual([]);
  });
});

describe('value.zero-run', () => {
  it('triggers at the default of 48 consecutive zeros and treats equal parsed zeros as identical', () => {
    const result = check(meterCsv(series(48, 0)));
    const runs = result.findings.filter((finding) => finding.rule === 'value.zero-run');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ severity: 'warning', count: 48 });
    expect(result.counts.errors).toBe(0);

    const written = check(
      meterCsv(['M,2024-06-01T00:30:00Z,0', 'M,2024-06-01T01:00:00Z,0.0', 'M,2024-06-01T01:30:00Z,-0']),
      { zeroRun: 3 },
    );
    expect(written.findings.filter((finding) => finding.rule === 'value.zero-run')).toHaveLength(1);
  });

  it('does not trigger below the threshold or across a non-zero reading', () => {
    expect(ruleNames(meterCsv(series(47, 0)))).not.toContain('value.zero-run');
    const broken = check(
      meterCsv(['M,2024-06-01T00:30:00Z,0', 'M,2024-06-01T01:00:00Z,0', 'M,2024-06-01T01:30:00Z,1', 'M,2024-06-01T02:00:00Z,0', 'M,2024-06-01T02:30:00Z,0']),
      { zeroRun: 3 },
    );
    expect(broken.findings.filter((finding) => finding.rule === 'value.zero-run')).toEqual([]);
  });
});

describe('value.flatline', () => {
  it('triggers at the default of 8 identical non-zero readings, compared as parsed numbers', () => {
    const result = check(meterCsv(series(8, 1.5)));
    const runs = result.findings.filter((finding) => finding.rule === 'value.flatline');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ severity: 'warning', count: 8 });

    const equivalents = check(
      meterCsv(['M,2024-06-01T00:30:00Z,1', 'M,2024-06-01T01:00:00Z,1.0', 'M,2024-06-01T01:30:00Z,1.00']),
      { flatline: 3 },
    );
    expect(equivalents.findings.filter((finding) => finding.rule === 'value.flatline')).toHaveLength(1);
  });

  it('does not trigger below the threshold, for zeros, or as more than one finding per run', () => {
    expect(ruleNames(meterCsv(series(7, 1.5)))).not.toContain('value.flatline');
    expect(ruleNames(meterCsv(series(8, 0)), { flatline: 3 })).not.toContain('value.flatline');
    const long = check(meterCsv(series(5, 2)), { flatline: 3 });
    const runs = long.findings.filter((finding) => finding.rule === 'value.flatline');
    expect(runs).toHaveLength(1);
    expect(runs[0]?.count).toBe(5);
  });
});

describe('options', () => {
  it('rejects an interval outside the allowed set', () => {
    expect(() => check(meterCsv(series(1, 1)), { intervalMinutes: 45 })).toThrow(CheckOptionsError);
    expect(() => check(meterCsv(series(1, 1)), { spikeFactor: 0 })).toThrow(/spike-factor/);
    expect(() => check(meterCsv(series(1, 1)), { flatline: 1.5 })).toThrow(/flatline/);
  });
});
