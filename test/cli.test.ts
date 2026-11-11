import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { run, type CliIo } from '../src/cli.js';

const PKG_VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

function fakeIo(files: Record<string, string> = {}, stdin = '') {
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    stdout(text) {
      stdout += text;
    },
    stderr(text) {
      stderr += text;
    },
    readFile(path) {
      if (!Object.hasOwn(files, path)) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      return files[path] ?? '';
    },
    readStdin() {
      return stdin;
    },
  };
  return {
    io,
    get out() {
      return stdout;
    },
    get err() {
      return stderr;
    },
  };
}

describe('run', () => {
  it('prints help and exits 0', () => {
    const io = fakeIo();
    expect(run(['--help'], io.io)).toBe(0);
    expect(io.out).toContain('Usage: meterdata-check [options] <file>');
    expect(io.out).toContain('--allow-negative');
    expect(io.out).toContain('--from');
    expect(io.err).toBe('');
  });

  it('prints the package version and exits 0', () => {
    const io = fakeIo();
    expect(run(['--version'], io.io)).toBe(0);
    expect(io.out).toBe(`${PKG_VERSION}\n`);
  });

  it('exits 2 when the file argument is missing, repeated, or unknown', () => {
    const missing = fakeIo();
    expect(run([], missing.io)).toBe(2);
    expect(missing.err).toContain('Missing file argument.');

    const extra = fakeIo();
    expect(run(['a.csv', 'b.csv'], extra.io)).toBe(2);
    expect(extra.err).toContain('Expected one file argument.');

    const unknown = fakeIo();
    expect(run(['--nope', 'a.csv'], unknown.io)).toBe(2);
    expect(unknown.err).toContain('--nope');
  });

  it('exits 2 when the file cannot be read or an option is invalid', () => {
    const unread = fakeIo();
    expect(run(['missing.csv'], unread.io)).toBe(2);
    expect(unread.err).toContain('Cannot read missing.csv');

    const interval = fakeIo({ 'a.csv': 'meter_id,timestamp,kwh\n' });
    expect(run(['--interval', '45', 'a.csv'], interval.io)).toBe(2);
    expect(interval.err).toContain('--interval must be one of');

    const factor = fakeIo();
    expect(run(['--spike-factor', 'nope', 'a.csv'], factor.io)).toBe(2);
    expect(factor.err).toContain('--spike-factor');
  });

  it('warns when --from is after the data and rejects reversed bounds', () => {
    const late = fakeIo({}, 'meter_id,timestamp,kwh\nM,2024-06-01T00:30:00Z,1\n');
    expect(run(['--from', '2024-06-01T01:00:00Z', '-'], late.io)).toBe(0);
    expect(late.out).toContain('time.window');
    expect(late.out).toContain('0 errors, 1 warning');

    const reversed = fakeIo({}, 'meter_id,timestamp,kwh\nM,2024-06-01T00:30:00Z,1\n');
    expect(run(['--from', '2024-06-01T02:00:00Z', '--to', '2024-06-01T01:00:00Z', '-'], reversed.io)).toBe(2);
    expect(reversed.err).toContain('--from is after --to');
  });

  it('exits 0 for warnings only and 1 when an error is present', () => {
    const warning = fakeIo(
      {},
      'meter_id,timestamp,kwh\nM,2024-06-01T00:30:00Z,1\nM,2024-06-01T00:30:00Z,1.0\n',
    );
    expect(run(['-'], warning.io)).toBe(0);
    expect(warning.out).toContain('0 errors, 1 warning');

    const error = fakeIo({}, 'meter_id,timestamp,kwh\nM,2024-06-01T00:30:00Z,-1\n');
    expect(run(['--json', '-'], error.io)).toBe(1);
    const body = JSON.parse(error.out) as { version: number; counts: { errors: number } };
    expect(body.version).toBe(1);
    expect(body.counts.errors).toBe(1);
  });
});

describe('cli process', () => {
  beforeAll(() => {
    execFileSync('node_modules/.bin/tsc', ['-p', 'tsconfig.build.json'], { stdio: 'inherit' });
  }, 60_000);

  function spawn(args: string[], input?: string) {
    return spawnSync(process.execPath, ['dist/cli.js', ...args], {
      encoding: 'utf8',
      input,
    });
  }

  it('exits 0 for the valid fixture', () => {
    const result = spawn(['fixtures/valid-30min.csv']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('0 errors, 0 warnings');
    expect(result.stdout).toContain('M1');
    expect(result.stdout).toContain('M2');
  });

  it('exits 1 for the invalid fixture', () => {
    const result = spawn(['--json', 'fixtures/invalid-mixed.csv']);
    expect(result.status).toBe(1);
    const body = JSON.parse(result.stdout) as {
      version: number;
      counts: { errors: number; warnings: number };
      findings: { rule: string }[];
    };
    expect(body.version).toBe(1);
    expect(body.counts).toEqual({ errors: 4, warnings: 1 });
    expect(body.findings.map((finding) => finding.rule)).toEqual([
      'value.negative',
      'time.alignment',
      'time.duplicate',
      'time.gap',
      'value.spike',
    ]);
  });

  it('exits 2 for usage and I/O errors', () => {
    expect(spawn([]).status).toBe(2);
    expect(spawn(['fixtures/does-not-exist.csv']).status).toBe(2);
    expect(spawn(['fixtures/does-not-exist.csv']).stderr).toContain('Cannot read');
    expect(spawn(['--interval', '7', 'fixtures/valid-30min.csv']).status).toBe(2);
    expect(spawn(['--help']).status).toBe(0);
    expect(spawn(['--version']).stdout).toBe(`${PKG_VERSION}\n`);
  });

  it('reads stdin when the path is -', () => {
    const clean = spawn(['-'], 'meter_id,timestamp,kwh\nM,2024-06-01T00:30:00Z,1\nM,2024-06-01T01:00:00Z,2\n');
    expect(clean.status).toBe(0);
    const warning = spawn(['-'], 'meter_id,timestamp,kwh\nM,2024-06-01T00:30:00Z,1\nM,2024-06-01T00:30:00Z,1\n');
    expect(warning.status).toBe(0);
    expect(warning.stdout).toContain('time.duplicate');
  });

  it('keeps the shebang on the built entry', () => {
    const source = readFileSync(new URL('../dist/cli.js', import.meta.url), 'utf8');
    expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true);
  });
});
