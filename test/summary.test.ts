import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { check } from '../src/index.js';
import { formatJson, formatText } from '../src/report.js';
import { meterCsv } from './helpers.js';

describe('summary math', () => {
  it('matches a hand-computed 30-minute series with one missing interval', () => {
    // Slots: 00:30, 01:00, 01:30 (missing), 02:00, 02:30.
    // rows = 4
    // expected intervals = 5, missing = 1, coverage = 4/5 = 80%
    // total kWh = 1 + 2 + 2 + 4 = 9
    // max kWh = 4 at 02:30Z, max demand = 4 * 60/30 = 8 kW
    // average kW = (9 / 4) * (60/30) = 4.5
    // load factor = 4.5 / 8 = 0.5625
    // The invalid middle slot is not treated as zero in the average.
    const result = check(
      meterCsv([
        'H1,2024-06-01T00:30:00Z,1',
        'H1,2024-06-01T01:00:00Z,2',
        'H1,2024-06-01T02:00:00Z,2',
        'H1,2024-06-01T02:30:00Z,4',
      ]),
    );
    expect(result.meters).toEqual([
      {
        meterId: 'H1',
        rows: 4,
        expectedIntervals: 5,
        missingIntervals: 1,
        coveragePercent: 80,
        totalKwh: 9,
        maxDemandKw: 8,
        maxDemandTimestamp: '2024-06-01T02:30:00.000Z',
        averageKw: 4.5,
        loadFactor: 0.5625,
      },
    ]);
    expect(result.counts).toEqual({ errors: 1, warnings: 0 });
  });

  it('counts a repeated timestamp once, keeping the first finite kWh', () => {
    // 00:30 appears twice with kWh 2. The 01:00 row is 4.
    // total kWh = 2 + 4 = 6, not 8
    // max demand = 4 * 60/30 = 8 kW
    // average kW = (6 / 2) * 2 = 6
    // load factor = 6 / 8 = 0.75
    // expected intervals = 2, missing = 0, coverage = 100
    const same = check(
      meterCsv(['M,2024-06-01T00:30:00Z,2', 'M,2024-06-01T00:30:00Z,2', 'M,2024-06-01T01:00:00Z,4']),
    );
    expect(same.meters[0]).toMatchObject({
      rows: 3,
      expectedIntervals: 2,
      missingIntervals: 0,
      coveragePercent: 100,
      totalKwh: 6,
      maxDemandKw: 8,
      averageKw: 6,
      loadFactor: 0.75,
    });

    // The conflicting 9 does not replace the first value of 2.
    const conflict = check(
      meterCsv(['M,2024-06-01T00:30:00Z,2', 'M,2024-06-01T00:30:00Z,9', 'M,2024-06-01T01:00:00Z,4']),
    );
    expect(conflict.meters[0]).toMatchObject({ totalKwh: 6, maxDemandKw: 8, averageKw: 6, loadFactor: 0.75 });
  });

  it('leaves load factor empty when every included reading is zero', () => {
    const result = check(meterCsv(['M,2024-06-01T00:30:00Z,0', 'M,2024-06-01T01:00:00Z,0']), { zeroRun: 8 });
    expect(result.meters[0]).toMatchObject({
      totalKwh: 0,
      maxDemandKw: 0,
      averageKw: 0,
      loadFactor: null,
      coveragePercent: 100,
    });
  });

  it('covers a slot whose kWh is invalid without adding it to the total', () => {
    const result = check(
      meterCsv(['M,2024-06-01T00:30:00Z,1', 'M,2024-06-01T01:00:00Z,nope', 'M,2024-06-01T01:30:00Z,1']),
    );
    expect(result.meters[0]).toMatchObject({
      rows: 3,
      expectedIntervals: 3,
      missingIntervals: 0,
      coveragePercent: 100,
      totalKwh: 2,
      maxDemandKw: 2,
      averageKw: 2,
      loadFactor: 1,
    });
  });
});

describe('valid fixture summary', () => {
  const csv = readFileSync(new URL('../fixtures/valid-30min.csv', import.meta.url), 'utf8');

  it('states the two clean daily totals', () => {
    // M1 kWh pattern 0.5, 1, 1.5, 2, 2.5 over 48 intervals: total 70.5
    // max kWh 2.5 at the first occurrence, 2024-01-01T02:30:00+08:00 = 2023-12-31T18:30:00Z
    // max demand = 2.5 * 60/30 = 5 kW
    // average kW = (70.5 / 48) * 2 = 2.9375
    // load factor = 2.9375 / 5 = 0.5875
    // M2 pattern 2, 3, 4, 5: total 168, max demand = 5 * 2 = 10 kW
    // average kW = (168 / 48) * 2 = 7, load factor = 7 / 10 = 0.7
    const result = check(csv);
    expect(result.counts).toEqual({ errors: 0, warnings: 0 });
    expect(result.meters).toEqual([
      {
        meterId: 'M1',
        rows: 48,
        expectedIntervals: 48,
        missingIntervals: 0,
        coveragePercent: 100,
        totalKwh: 70.5,
        maxDemandKw: 5,
        maxDemandTimestamp: '2023-12-31T18:30:00.000Z',
        averageKw: 2.9375,
        loadFactor: 0.5875,
      },
      {
        meterId: 'M2',
        rows: 48,
        expectedIntervals: 48,
        missingIntervals: 0,
        coveragePercent: 100,
        totalKwh: 168,
        maxDemandKw: 10,
        maxDemandTimestamp: '2023-12-31T18:00:00.000Z',
        averageKw: 7,
        loadFactor: 0.7,
      },
    ]);
  });
});

describe('report rounding', () => {
  const result = check(
    meterCsv([
      'H1,2024-06-01T00:30:00Z,1',
      'H1,2024-06-01T01:00:00Z,2',
      'H1,2024-06-01T02:00:00Z,2',
      'H1,2024-06-01T02:30:00Z,4',
    ]),
  );

  it('shows kWh and kW to 3 decimal places in the text report', () => {
    const text = formatText(result);
    expect(text).toContain('total kWh: 9.000');
    expect(text).toContain('max demand: 8.000 kW at 2024-06-01T02:30:00.000Z');
    expect(text).toContain('average: 4.500 kW');
    expect(text).toContain('load factor: 0.563');
    expect(text).toContain('coverage: 80.000%');
    expect(text).toContain('1 error, 0 warnings');
  });

  it('rounds the same summary fields in the JSON report', () => {
    const body = JSON.parse(formatJson(result)) as {
      version: number;
      meters: { loadFactor: number; totalKwh: number; averageKw: number; coveragePercent: number }[];
      counts: { errors: number; warnings: number };
    };
    expect(body.version).toBe(1);
    expect(body.counts).toEqual({ errors: 1, warnings: 0 });
    expect(body.meters[0]).toMatchObject({
      totalKwh: 9,
      averageKw: 4.5,
      loadFactor: 0.563,
      coveragePercent: 80,
    });
  });
});
