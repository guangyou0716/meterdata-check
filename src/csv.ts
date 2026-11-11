export interface CsvRecord {
  /** 1-based line number where the record starts. */
  line: number;
  fields: string[];
}

type Term = 'comma' | 'newline' | 'eof';

/**
 * RFC 4180-ish CSV reader.
 * Quoted fields may contain commas, newlines, and escaped quotes (`""`).
 * CRLF, LF, and CR separate records. A leading UTF-8 BOM is ignored.
 * Whitespace-only records are skipped. Unquoted fields are trimmed; quoted
 * field text is preserved, aside from padding outside the quotes.
 */
export function parseCsv(text: string): CsvRecord[] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  const length = source.length;
  let index = 0;
  let line = 1;

  const peek = (offset = 0): string => source[index + offset] ?? '';

  const consumeSeparator = (): Term => {
    if (index >= length) return 'eof';
    const char = peek();
    if (char === ',') {
      index += 1;
      return 'comma';
    }
    if (char === '\r' || char === '\n') {
      index += 1;
      if (char === '\r' && peek() === '\n') index += 1;
      line += 1;
      return 'newline';
    }
    // Text jammed against a closing quote. Skip it and look again so the parse cannot stall.
    while (index < length && peek() !== ',' && peek() !== '\n' && peek() !== '\r') index += 1;
    return consumeSeparator();
  };

  const readField = (): { value: string; term: Term } => {
    while (index < length && (peek() === ' ' || peek() === '\t')) index += 1;
    if (index >= length) return { value: '', term: 'eof' };
    if (peek() === '"') {
      index += 1;
      let value = '';
      while (index < length) {
        const char = peek();
        if (char === '"') {
          if (peek(1) === '"') {
            value += '"';
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        if (char === '\r' || char === '\n') {
          index += 1;
          if (char === '\r' && peek() === '\n') index += 1;
          value += '\n';
          line += 1;
          continue;
        }
        value += char;
        index += 1;
      }
      while (index < length && (peek() === ' ' || peek() === '\t')) index += 1;
      return { value, term: consumeSeparator() };
    }
    let value = '';
    while (index < length) {
      const char = peek();
      if (char === ',' || char === '\n' || char === '\r') break;
      value += char;
      index += 1;
    }
    return { value: value.trimEnd(), term: consumeSeparator() };
  };

  while (index < length) {
    const startLine = line;
    const fields: string[] = [];
    let term: Term = 'comma';
    while (term === 'comma') {
      const field = readField();
      fields.push(field.value);
      term = field.term;
    }
    if (!fields.every((field) => field.trim() === '')) {
      records.push({ line: startLine, fields });
    }
    if (term === 'eof') break;
  }

  return records;
}

export interface RawMeterRow {
  line: number;
  meterId: string;
  rawTimestamp: string;
  rawKwh: string;
  quality: string | null;
}

export interface MeterTable {
  headerLine: number | null;
  /** Required column names that were absent. Empty when the header is usable. */
  missing: string[];
  rows: RawMeterRow[];
}

const REQUIRED = ['meter_id', 'timestamp', 'kwh'] as const;

/**
 * Read a meter CSV. Extra columns are ignored. A `quality` column is kept.
 * Column names are matched after trimming, and they are case-sensitive.
 */
export function extractMeterRows(text: string): MeterTable {
  const records = parseCsv(text);
  const header = records[0];
  if (header === undefined) {
    return { headerLine: null, missing: [...REQUIRED], rows: [] };
  }
  const names = header.fields.map((field) => field.trim());
  const index = new Map<string, number>();
  names.forEach((name, position) => {
    if (name !== '' && !index.has(name)) index.set(name, position);
  });
  const missing = REQUIRED.filter((name) => !index.has(name));
  if (missing.length > 0) {
    return { headerLine: header.line, missing: [...missing], rows: [] };
  }
  const meterIdx = index.get('meter_id');
  const timestampIdx = index.get('timestamp');
  const kwhIdx = index.get('kwh');
  const qualityIdx = index.get('quality');
  if (meterIdx === undefined || timestampIdx === undefined || kwhIdx === undefined) {
    return { headerLine: header.line, missing: [...REQUIRED], rows: [] };
  }
  const cell = (record: CsvRecord, position: number): string => (record.fields[position] ?? '').trim();
  const rows: RawMeterRow[] = [];
  for (const record of records.slice(1)) {
    const quality = qualityIdx === undefined ? '' : cell(record, qualityIdx);
    rows.push({
      line: record.line,
      meterId: cell(record, meterIdx),
      rawTimestamp: cell(record, timestampIdx),
      rawKwh: cell(record, kwhIdx),
      quality: quality === '' ? null : quality,
    });
  }
  return { headerLine: header.line, missing: [], rows };
}
