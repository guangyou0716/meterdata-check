import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function pad(value) {
  return String(value).padStart(2, '0');
}

/** Format a UTC instant as an ISO timestamp with a +08:00 offset. */
function formatPlus8(utcMs) {
  const local = new Date(utcMs + 8 * 60 * 60 * 1000);
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}+08:00`
  );
}

function formatKwh(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// 2024-01-01T00:30:00+08:00 through 2024-01-02T00:00:00+08:00 is 48 interval-end slots.
const startUtc = Date.UTC(2023, 11, 31, 16, 30, 0);
const valid = ['meter_id,timestamp,kwh'];
let m1Total = 0;
let m2Total = 0;
for (let index = 0; index < 48; index += 1) {
  const stamp = formatPlus8(startUtc + index * 30 * 60 * 1000);
  const m1 = 0.5 * ((index % 5) + 1);
  const m2 = (index % 4) + 2;
  m1Total += m1;
  m2Total += m2;
  valid.push(`M1,${stamp},${formatKwh(m1)}`);
}
for (let index = 0; index < 48; index += 1) {
  const stamp = formatPlus8(startUtc + index * 30 * 60 * 1000);
  const m2 = (index % 4) + 2;
  valid.push(`M2,${stamp},${formatKwh(m2)}`);
}
if (m1Total !== 70.5) throw new Error(`M1 total drifted to ${m1Total}`);
if (m2Total !== 168) throw new Error(`M2 total drifted to ${m2Total}`);
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/valid-30min.csv'), `${valid.join('\n')}\n`);

// Gap at 05:30, conflicting duplicate at 03:00, spike at 06:00, negative at 06:30,
// and a 06:45 timestamp that is off the 30-minute grid.
const invalid = [
  'meter_id,timestamp,kwh,quality',
  'BAD1,2024-03-15T00:30:00+08:00,1.0,OK',
  'BAD1,2024-03-15T01:00:00+08:00,1.2,OK',
  'BAD1,2024-03-15T01:30:00+08:00,1.1,OK',
  'BAD1,2024-03-15T02:00:00+08:00,1.3,OK',
  'BAD1,2024-03-15T02:30:00+08:00,1.0,OK',
  'BAD1,2024-03-15T03:00:00+08:00,1.2,OK',
  'BAD1,2024-03-15T03:00:00+08:00,5.0,DUP',
  'BAD1,2024-03-15T03:30:00+08:00,1.1,OK',
  'BAD1,2024-03-15T04:00:00+08:00,1.4,OK',
  'BAD1,2024-03-15T04:30:00+08:00,1.0,OK',
  'BAD1,2024-03-15T05:00:00+08:00,1.2,OK',
  'BAD1,2024-03-15T06:00:00+08:00,100,SPIKE',
  'BAD1,2024-03-15T06:30:00+08:00,-0.4,NEG',
  'BAD1,2024-03-15T06:45:00+08:00,0,BAD_TIME',
];
writeFileSync(join(root, 'fixtures/invalid-mixed.csv'), `${invalid.join('\n')}\n`);
