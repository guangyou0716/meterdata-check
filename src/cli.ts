#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { check, CheckOptionsError } from './index.js';
import { formatJson, formatText } from './report.js';
import type { CheckOptions } from './types.js';

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  readFile(path: string): string;
  readStdin(): string;
}

const USAGE = 'Usage: meterdata-check [options] <file>';

const HELP = `${USAGE}

Offline quality checker for interval meter data in CSV form.
The header must include meter_id, timestamp, and kwh. Extra columns are ignored.
An optional quality column is copied onto findings that come from those rows.

Arguments:
  <file>                  CSV path, or - to read stdin

Options:
  --interval <minutes>    Interval length: 1, 5, 10, 15, 30, or 60 (default 30)
  --spike-factor <n>      Spike threshold as a multiple of the median (default 10)
  --flatline <n>          Consecutive identical non-zero readings (default 8)
  --zero-run <n>          Consecutive zero readings (default 48)
  --allow-negative        Allow negative kWh (export or bidirectional meters)
  --from <timestamp>      Expected period start, ISO 8601 with an explicit offset
  --to <timestamp>        Expected period end, ISO 8601 with an explicit offset
  --json                  Print the JSON report
  --help                  Show this help
  --version               Print the package version

Exit codes:
  0  no errors (warnings are allowed)
  1  one or more errors
  2  usage error or unreadable input
`;

function packageVersion(): string {
  const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'version' in parsed &&
    typeof (parsed as { version: unknown }).version === 'string'
  ) {
    return (parsed as { version: string }).version;
  }
  throw new Error('package.json is missing a version string');
}

function parseDecimal(flag: string, raw: string): number {
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) {
    throw new CheckOptionsError(`${flag} must be a finite number greater than 0`);
  }
  return Number(raw);
}

function parseInteger(flag: string, raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new CheckOptionsError(`${flag} must be an integer greater than or equal to 1`);
  }
  return Number(raw);
}

export function run(argv: string[], io: CliIo): number {
  let values: {
    interval?: string;
    'spike-factor'?: string;
    flatline?: string;
    'zero-run'?: string;
    'allow-negative'?: boolean;
    from?: string;
    to?: string;
    json?: boolean;
    help?: boolean;
    version?: boolean;
  };
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: argv,
      options: {
        interval: { type: 'string' },
        'spike-factor': { type: 'string' },
        flatline: { type: 'string' },
        'zero-run': { type: 'string' },
        'allow-negative': { type: 'boolean', default: false },
        from: { type: 'string' },
        to: { type: 'string' },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
        version: { type: 'boolean', default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    io.stderr(`${detail}\n${HELP}`);
    return 2;
  }

  if (values.help === true) {
    io.stdout(HELP);
    return 0;
  }
  if (values.version === true) {
    io.stdout(`${packageVersion()}\n`);
    return 0;
  }
  if (positionals.length !== 1) {
    io.stderr(`${positionals.length === 0 ? 'Missing file argument.' : 'Expected one file argument.'}\n${HELP}`);
    return 2;
  }

  let options: CheckOptions;
  try {
    options = {
      allowNegative: values['allow-negative'] === true,
      ...(values.interval === undefined ? {} : { intervalMinutes: parseInteger('--interval', values.interval) }),
      ...(values['spike-factor'] === undefined
        ? {}
        : { spikeFactor: parseDecimal('--spike-factor', values['spike-factor']) }),
      ...(values.flatline === undefined ? {} : { flatline: parseInteger('--flatline', values.flatline) }),
      ...(values['zero-run'] === undefined ? {} : { zeroRun: parseInteger('--zero-run', values['zero-run']) }),
      ...(values.from === undefined ? {} : { from: values.from }),
      ...(values.to === undefined ? {} : { to: values.to }),
    };
  } catch (cause) {
    if (cause instanceof CheckOptionsError) {
      io.stderr(`${cause.message}\n`);
      return 2;
    }
    throw cause;
  }

  const file = positionals[0] ?? '';
  let csvText: string;
  try {
    csvText = file === '-' ? io.readStdin() : io.readFile(file);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    io.stderr(`Cannot read ${file}: ${detail}\n`);
    return 2;
  }

  let result;
  try {
    result = check(csvText, options);
  } catch (cause) {
    if (cause instanceof CheckOptionsError) {
      io.stderr(`${cause.message}\n`);
      return 2;
    }
    throw cause;
  }

  if (values.json === true) io.stdout(formatJson(result));
  else {
    io.stdout(
      formatText(result, {
        intervalMinutes: options.intervalMinutes ?? 30,
        spikeFactor: options.spikeFactor ?? 10,
        flatline: options.flatline ?? 8,
        zeroRun: options.zeroRun ?? 48,
        allowNegative: options.allowNegative ?? false,
        from: options.from ?? null,
        to: options.to ?? null,
      }),
    );
  }
  return result.counts.errors > 0 ? 1 : 0;
}

function isEntryPoint(): boolean {
  const script = process.argv[1];
  if (script === undefined) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const code = run(process.argv.slice(2), {
    stdout(text) {
      process.stdout.write(text);
    },
    stderr(text) {
      process.stderr.write(text);
    },
    readFile(path) {
      return readFileSync(path, 'utf8');
    },
    readStdin() {
      return readFileSync(0, 'utf8');
    },
  });
  process.exitCode = code;
}
