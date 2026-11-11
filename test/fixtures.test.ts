import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { check } from '../src/index.js';

const validCsv = readFileSync(new URL('../fixtures/valid-30min.csv', import.meta.url), 'utf8');
const invalidCsv = readFileSync(new URL('../fixtures/invalid-mixed.csv', import.meta.url), 'utf8');

describe('fixtures/valid-30min.csv', () => {
  it('is a clean day for two meters', () => {
    const result = check(validCsv);
    expect(result.findings).toEqual([]);
    expect(result.counts).toEqual({ errors: 0, warnings: 0 });
    expect(result.meters.map((meter) => meter.meterId)).toEqual(['M1', 'M2']);
  });
});

describe('fixtures/invalid-mixed.csv', () => {
  it('triggers a gap, a conflicting duplicate, a negative, a spike, and a misalignment', () => {
    const result = check(invalidCsv);
    expect(result.findings.map((finding) => finding.rule)).toEqual([
      'value.negative',
      'time.alignment',
      'time.duplicate',
      'time.gap',
      'value.spike',
    ]);
    expect(result.counts).toEqual({ errors: 4, warnings: 1 });

    const [negative, alignment, duplicate, gap, spike] = result.findings;
    expect(negative).toMatchObject({ severity: 'error', rows: [14], quality: 'NEG' });
    expect(alignment).toMatchObject({ severity: 'error', rows: [15], quality: 'BAD_TIME' });
    expect(duplicate).toMatchObject({ severity: 'error', rows: [7, 8] });
    expect(duplicate?.quality).toBeUndefined();
    expect(gap).toMatchObject({
      severity: 'error',
      count: 1,
      start: '2024-03-14T21:30:00.000Z',
      end: '2024-03-14T21:30:00.000Z',
    });
    expect(spike).toMatchObject({ severity: 'warning', rows: [13], quality: 'SPIKE' });
    expect(result.meters[0]).toMatchObject({
      meterId: 'BAD1',
      rows: 14,
      expectedIntervals: 13,
      missingIntervals: 1,
      maxDemandKw: 200,
      maxDemandTimestamp: '2024-03-14T22:00:00.000Z',
    });
  });
});
