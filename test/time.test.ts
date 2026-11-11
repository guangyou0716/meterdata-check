import { describe, expect, it } from 'vitest';
import { check, CheckOptionsError } from '../src/index.js';
import { parseTimestamp } from '../src/time.js';
import { meterCsv } from './helpers.js';

describe('parseTimestamp end of day', () => {
  it('accepts 24:00:00 as the next midnight with the same offset', () => {
    const utc = parseTimestamp('2024-01-02T00:00:00Z');
    expect(utc).not.toBeNull();
    expect(parseTimestamp('2024-01-01T24:00:00Z')).toBe(utc);
    expect(parseTimestamp('2024-01-01T24:00:00.000Z')).toBe(utc);
    expect(parseTimestamp('2024-01-01T24:00:00.0Z')).toBe(utc);
    expect(parseTimestamp('2024-01-01t24:00z')).toBe(utc);
    expect(parseTimestamp('2024-01-01T24:00:00+0000')).toBe(utc);

    expect(parseTimestamp('2024-01-31T24:00:00Z')).toBe(parseTimestamp('2024-02-01T00:00:00Z'));
    expect(parseTimestamp('2024-02-29T24:00:00Z')).toBe(parseTimestamp('2024-03-01T00:00:00Z'));
    expect(parseTimestamp('2023-02-28T24:00:00Z')).toBe(parseTimestamp('2023-03-01T00:00:00Z'));
    expect(parseTimestamp('2024-12-31T24:00:00.000Z')).toBe(parseTimestamp('2025-01-01T00:00:00Z'));
    expect(parseTimestamp('2024-02-29T24:00:00+08:00')).toBe(parseTimestamp('2024-03-01T00:00:00+08:00'));
    expect(parseTimestamp('2024-12-31T24:00:00+08:00')).toBe(parseTimestamp('2025-01-01T00:00:00+08:00'));
    expect(parseTimestamp('2023-02-28T24:00:00-05:30')).toBe(parseTimestamp('2023-03-01T00:00:00-05:30'));
    expect(parseTimestamp('2024-01-31T24:00:00+0800')).toBe(parseTimestamp('2024-02-01T00:00:00+0800'));
  });

  it('rejects any other hour-24 or hour-25 form', () => {
    expect(
      [
        '2024-01-01T24:00:01Z',
        '2024-01-01T24:01:00Z',
        '2024-01-01T24:01Z',
        '2024-01-01T24:00:00.001Z',
        '2024-01-01T24:00:00.0001Z',
        '2024-01-01T25:00:00Z',
        '2024-01-01T24:00:60Z',
        '2024-04-31T24:00:00Z',
        '2023-02-29T24:00:00Z',
        '2024-01-01T24:00:00',
      ].map((raw) => parseTimestamp(raw)),
    ).toEqual([null, null, null, null, null, null, null, null, null, null]);
  });

  it('treats a 24:00:00 reading as the next midnight', () => {
    const via24 = check(meterCsv(['M,2024-06-01T23:30:00Z,1', 'M,2024-06-01T24:00:00Z,1']));
    expect(via24.findings).toEqual([]);
    expect(via24.meters[0]).toMatchObject({ expectedIntervals: 2, missingIntervals: 0, coveragePercent: 100 });

    const duplicate = check(meterCsv(['M,2024-06-01T24:00:00Z,1', 'M,2024-06-02T00:00:00Z,1.0']));
    expect(duplicate.findings.map((finding) => finding.rule)).toEqual(['time.duplicate']);
    expect(duplicate.counts).toEqual({ errors: 0, warnings: 1 });

    const rejected = check(meterCsv(['M,2024-01-01T24:30:00Z,1', 'M,2024-01-01T24:00:01Z,1']));
    expect(rejected.findings.map((finding) => finding.rule)).toEqual([
      'structure.timestamp',
      'structure.timestamp',
    ]);
  });

  it('accepts 24:00:00 as a bound and rejects the other hour-24 forms', () => {
    const result = check(meterCsv(['M,2024-06-02T00:00:00Z,1']), {
      from: '2024-06-01T24:00:00Z',
      to: '2024-06-02T00:30:00Z',
    });
    expect(result.findings.filter((finding) => finding.rule === 'time.gap')).toMatchObject([
      { count: 1, start: '2024-06-02T00:30:00.000Z' },
    ]);
    expect(result.meters[0]).toMatchObject({ expectedIntervals: 2, missingIntervals: 1 });

    const csv = meterCsv(['M,2024-06-01T00:30:00Z,1']);
    expect(() => check(csv, { from: '2024-06-01T24:00:01Z' })).toThrow(CheckOptionsError);
    expect(() => check(csv, { from: '2024-06-01T24:01:00Z' })).toThrow(CheckOptionsError);
    expect(() => check(csv, { to: '2024-06-01T25:00:00Z' })).toThrow(CheckOptionsError);
    expect(() => check(csv, { from: '2024-06-01T24:00:00.001Z' })).toThrow(CheckOptionsError);
  });
});
