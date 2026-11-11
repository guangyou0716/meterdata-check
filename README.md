# meterdata-check

Offline quality checker for smart-meter interval data. It reads a CSV of interval-end kWh readings and reports gaps, duplicate timestamps, misalignment, negative values, spikes, stuck registers, and zero runs, plus a per-meter energy summary (coverage, total kWh, max demand, load factor).

The checker is a local library and command-line tool. It does not call the network, send telemetry, or use a paid service. `"private": true` in `package.json` keeps it off the public npm registry.

## Install from source

Requires Node.js 20 or newer.

```sh
npm ci
npm run build
```

Run the built CLI with `node`:

```sh
node dist/cli.js --help
node dist/cli.js fixtures/valid-30min.csv
node dist/cli.js --json fixtures/invalid-mixed.csv
```

`npm run check` runs lint, the type checker, and the tests.

## Usage

```sh
node dist/cli.js [options] <file>
```

`<file>` is a CSV path. Use `-` to read the CSV from stdin.

```sh
node dist/cli.js --interval 30 fixtures/valid-30min.csv
node dist/cli.js --from 2024-01-01T00:30:00+08:00 --to 2024-01-02T00:00:00+08:00 fixtures/valid-30min.csv
node dist/cli.js --allow-negative --spike-factor 8 readings.csv
cat readings.csv | node dist/cli.js --json -
```

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | No errors. Warnings are allowed. |
| 1 | One or more errors. |
| 2 | Usage error, invalid option, or unreadable input. |

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `--interval <minutes>` | `30` | Interval length. Allowed values: `1`, `5`, `10`, `15`, `30`, `60`. |
| `--spike-factor <n>` | `10` | Flag a reading strictly greater than this multiple of the meter's median positive kWh. Needs at least 10 positive readings. |
| `--flatline <n>` | `8` | Flag this many consecutive identical non-zero readings (stuck register). |
| `--zero-run <n>` | `48` | Flag this many consecutive zero readings. |
| `--allow-negative` | off | Allow negative kWh for export or bidirectional meters. |
| `--from <timestamp>` | first reading | Inclusive start of the expected period. ISO 8601 with an explicit offset, on an interval boundary. |
| `--to <timestamp>` | last reading | Inclusive end of the expected period. Same timestamp rules as `--from`. |
| `--json` | off | Print the JSON report instead of text. |
| `--help` | | Show help. |
| `--version` | | Print the package version. |

### Input

The header row must include `meter_id`, `timestamp`, and `kwh`. Names are case-sensitive. Extra columns are ignored. An optional `quality` column is copied onto any finding that comes only from rows sharing that value.

`timestamp` is the interval **end**, in ISO 8601 with an explicit offset (`Z`, `±HH:MM`, or `±HHMM`). Alignment is computed in UTC: the epoch minute of the instant must be divisible by the interval. A `+08:00` timestamp such as `2024-01-01T00:30:00+08:00` is the instant `2023-12-31T16:30:00Z`.

`kwh` is the energy in that interval. Identical values are compared with the parsed numbers, so `1`, `1.0`, and `1.00` are the same reading. Displayed kWh and kW are rounded to 3 decimal places.

Quoted CSV fields, escaped quotes (`""`), CRLF, a leading UTF-8 BOM, and blank lines are accepted.

## Rules

| Rule | Severity | What it flags |
| --- | --- | --- |
| `structure.header` | error | A required column is missing. |
| `structure.timestamp` | error | The timestamp cannot be parsed, or it has no offset. |
| `structure.value` | error | `kwh` is not a finite number. |
| `time.alignment` | error | The UTC instant is not on an interval boundary. |
| `time.duplicate` | warning if the kWh matches, error if it conflicts | The same meter and instant appear more than once. |
| `time.order` | warning | A row is earlier than the previous parsed row for that meter. |
| `time.gap` | error | One or more interval-end slots are missing. One finding per contiguous hole, with `start`, `end`, and `count`. |
| `value.negative` | error | kWh is negative. Suppressed by `--allow-negative`. |
| `value.spike` | warning | kWh is greater than `spike-factor` times the median of that meter's positive readings. Requires at least 10 positive readings. |
| `value.zero-run` | warning | At least `zero-run` consecutive zero readings. |
| `value.flatline` | warning | At least `flatline` consecutive identical non-zero readings. |

The expected slots run from the meter's first parsed timestamp through its last, inclusive. `--from` and `--to` replace those ends when you pass them, so missing intervals at the edges of a billing period are visible. A slot counts as present when any row has that exact instant, even if its kWh is invalid.

## Summary

Each meter includes:

| Field | Meaning |
| --- | --- |
| `rows` | Data rows, including invalid rows and duplicate timestamps. |
| `expectedIntervals` | Aligned slots in the window. |
| `missingIntervals` | Slots with no row. |
| `coveragePercent` | `100 * (expected - missing) / expected`. |
| `totalKwh` | Sum of kWh. The first finite row at each timestamp is used. |
| `maxDemandKw` | `max(kWh) * 60 / intervalMinutes`, with the timestamp of that reading. |
| `averageKw` | Mean demand of the rows included in the total. |
| `loadFactor` | `averageKw / maxDemandKw`. Null when max demand is 0. |

Missing intervals are reported in the coverage fields. They are not filled with zero, and they do not reduce the average or the load factor.

Worked example, 30-minute data, one hole:

| Interval end | kWh |
| --- | --- |
| 2024-06-01T00:30:00Z | 1 |
| 2024-06-01T01:00:00Z | 2 |
| 2024-06-01T01:30:00Z | missing |
| 2024-06-01T02:00:00Z | 2 |
| 2024-06-01T02:30:00Z | 4 |

Expected intervals 5, missing 1, coverage 80%. Total 9 kWh. Max demand `4 * 60 / 30 = 8 kW` at 02:30Z. Average kW `(9 / 4) * 2 = 4.5`. Load factor `4.5 / 8 = 0.5625` (displayed as `0.563`).

## JSON report

`--json` prints one object. Summary numbers are rounded to 3 decimal places. The library `check()` result keeps full precision.

```json
{
  "version": 1,
  "meters": [
    {
      "meterId": "H1",
      "rows": 4,
      "expectedIntervals": 5,
      "missingIntervals": 1,
      "coveragePercent": 80,
      "totalKwh": 9,
      "maxDemandKw": 8,
      "maxDemandTimestamp": "2024-06-01T02:30:00.000Z",
      "averageKw": 4.5,
      "loadFactor": 0.563
    }
  ],
  "findings": [
    {
      "rule": "time.gap",
      "severity": "error",
      "meterId": "H1",
      "rows": [],
      "timestamp": "2024-06-01T01:30:00.000Z",
      "message": "Missing 1 interval from 2024-06-01T01:30:00.000Z to 2024-06-01T01:30:00.000Z",
      "start": "2024-06-01T01:30:00.000Z",
      "end": "2024-06-01T01:30:00.000Z",
      "count": 1
    }
  ],
  "counts": { "errors": 1, "warnings": 0 }
}
```

`rows` is empty for a gap. A row finding lists 1-based file line numbers. `quality` is present only when the referenced rows share a `quality` value.

Library, after `npm run build`:

```js
import { check } from './dist/index.js';

const result = check(csvText, { intervalMinutes: 30 });
// result.meters, result.findings, result.counts
```

The package is private and is meant to be run from a checkout.

## Fixtures

`fixtures/valid-30min.csv` is two meters, `M1` and `M2`, for one day of 30-minute interval-end readings starting `2024-01-01T00:30:00+08:00`. It has no errors and no warnings.

`fixtures/invalid-mixed.csv` contains a gap, a duplicate timestamp with conflicting kWh, a negative value, a spike, and a timestamp off the 30-minute grid. The CLI exits 1.

Regenerate both files with `node scripts/gen-fixtures.mjs`.

## Limitations

Out of scope for v0.1:

- Estimation and gap filling
- Register-versus-interval reconciliation
- Local timestamps without an offset, including DST wall time
- MDFF, NEM12, and Excel

Also:

- One file per invocation.
- The first row for a meter and timestamp supplies the kWh used for totals, demand, spikes, flatlines, and zero runs. A later conflicting row is reported and does not replace that value.
- Flatline and zero-run checks walk those rows in time order. A missing interval between them does not break the run.
- `quality` is copied onto findings. It is not a separate column in the summary.
- There is no network access and no telemetry.

## License

Released under the MIT license. See [LICENSE](LICENSE).

The code was written by Grok CLI (xAI) under the owner's direction.
