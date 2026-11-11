import { describe, expect, it } from 'vitest';
import { extractMeterRows, parseCsv } from '../src/csv.js';
import { check } from '../src/index.js';

describe('parseCsv', () => {
  it('keeps commas inside quoted fields', () => {
    const records = parseCsv('meter_id,timestamp,kwh\n"M,1","2024-01-01T00:30:00Z","1.5"\n');
    expect(records).toEqual([
      { line: 1, fields: ['meter_id', 'timestamp', 'kwh'] },
      { line: 2, fields: ['M,1', '2024-01-01T00:30:00Z', '1.5'] },
    ]);
  });

  it('unescapes doubled quotes', () => {
    const records = parseCsv('meter_id,note\n"M""1","say ""hi"""\n');
    expect(records[1]).toEqual({ line: 2, fields: ['M"1', 'say "hi"'] });
  });

  it('accepts CRLF records', () => {
    const records = parseCsv('a,b\r\n1,2\r\n');
    expect(records).toEqual([
      { line: 1, fields: ['a', 'b'] },
      { line: 2, fields: ['1', '2'] },
    ]);
  });

  it('strips a leading BOM', () => {
    const records = parseCsv('\uFEFFmeter_id,timestamp\nM1,2024-01-01T00:30:00Z\n');
    expect(records[0]?.fields[0]).toBe('meter_id');
  });

  it('skips blank lines and keeps the physical line number', () => {
    const records = parseCsv('a,b\n\n   \n1,2\n');
    expect(records).toEqual([
      { line: 1, fields: ['a', 'b'] },
      { line: 4, fields: ['1', '2'] },
    ]);
  });

  it('allows a quoted field to span lines', () => {
    const records = parseCsv('a,b\n"x\ny",z\n1,2\n');
    expect(records).toEqual([
      { line: 1, fields: ['a', 'b'] },
      { line: 2, fields: ['x\ny', 'z'] },
      { line: 4, fields: ['1', '2'] },
    ]);
  });

  it('trims padding around quoted and unquoted fields', () => {
    const records = parseCsv('a, b , "c" \n');
    expect(records).toEqual([{ line: 1, fields: ['a', 'b', 'c'] }]);
  });
});

describe('extractMeterRows', () => {
  it('ignores extra columns and passes quality through', () => {
    const table = extractMeterRows(
      'note,meter_id,timestamp,kwh,quality\nhello,M1,2024-01-01T00:30:00Z,-1,EST\n',
    );
    expect(table.missing).toEqual([]);
    expect(table.rows).toEqual([
      {
        line: 2,
        meterId: 'M1',
        rawTimestamp: '2024-01-01T00:30:00Z',
        rawKwh: '-1',
        quality: 'EST',
      },
    ]);
  });

  it('reports a missing required column and does not invent rows', () => {
    const table = extractMeterRows('meter_id,timestamp\nM1,2024-01-01T00:30:00Z\n');
    expect(table.missing).toEqual(['kwh']);
    expect(table.rows).toEqual([]);
  });

  it('reports every required column when the file is empty', () => {
    expect(extractMeterRows('').missing).toEqual(['meter_id', 'timestamp', 'kwh']);
    expect(extractMeterRows('\n\n').missing).toEqual(['meter_id', 'timestamp', 'kwh']);
  });
});

describe('csv integration', () => {
  it('checks a quoted row with a comma in the meter id', () => {
    const result = check(
      'meter_id,timestamp,kwh,quality\n"M,1",2024-06-01T00:30:00Z,-2,"OK, estimated"\n',
    );
    expect(result.meters[0]?.meterId).toBe('M,1');
    expect(result.findings.map((finding) => finding.rule)).toEqual(['value.negative']);
    expect(result.findings[0]?.quality).toBe('OK, estimated');
  });

  it('reports the physical line number after a blank line', () => {
    const result = check('meter_id,timestamp,kwh\n\nM,2024-06-01T00:30:00Z,-1\n');
    expect(result.findings[0]?.rows).toEqual([3]);
  });

  it('checks CRLF input with a blank line', () => {
    const result = check('meter_id,timestamp,kwh\r\n\r\nM,2024-06-01T00:30:00Z,1\r\nM,2024-06-01T01:00:00Z,2\r\n');
    expect(result.counts).toEqual({ errors: 0, warnings: 0 });
    expect(result.meters[0]?.rows).toBe(2);
    expect(result.findings).toEqual([]);
  });
});
