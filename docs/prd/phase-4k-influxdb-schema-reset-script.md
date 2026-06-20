# Phase 4K — InfluxDB Schema Reset Script

## Status
Complete — issue #96

## Problem

InfluxDB locks a field's type (`integer` vs `float`) on first write. If the BBB publisher or Telegraf ever writes the wrong type, every subsequent write of the correct type is silently dropped with a 422 `field type conflict` error. This had already happened twice (#93, #95) before the field type was fixed in code — the fix in code doesn't help until the stale schema in InfluxDB is cleared.

The only documented remedy was a hand-typed `docker compose exec influxdb influx delete ...` command, and the `[mqtt] device alert ... influxdb_flush_failed` log line gave no indication of how to resolve it.

## Goals

- One command to clear a conflicting measurement's schema, instead of a hand-typed `influx delete` invocation
- The alert that surfaces the conflict tells the operator exactly which command to run
- Confirmation step before deleting, since this is destructive to historical data

## Approach

### `scripts/reset-influx-measurement.sh`

Wraps the documented `influx delete` command:

- Takes the measurement name as `$1`
- Sources `.env` for `INFLUXDB_ORG` / `INFLUXDB_BUCKET` / `INFLUXDB_TOKEN`, falling back to the local dev defaults (`plantwise` / `sensors` / `plantwise-dev-token`)
- Prompts the operator to retype the measurement name to confirm before deleting
- Runs `docker compose exec influxdb influx delete` scoped to that measurement, from epoch to now
- Restarts Telegraf so it reconnects cleanly

Wired up as `npm run influx:reset-measurement -- <measurement>`.

### Alert fix hint (`src/mqtt/subscriber.ts`)

`buildFlushFailedFixHint(code, message)` checks whether an alert is an `influxdb_flush_failed` whose message contains `field type conflict`, extracts the measurement name out of InfluxDB's error text (`on measurement "<name>"`), and returns a hint line:

```
[mqtt] device alert [living-room] influxdb_flush_failed: failure writing points to database: ...
  Fix: npm run influx:reset-measurement -- moisture
```

Printed via `console.error` immediately after the existing alert line, and included in the `notify()` push payload when `MQTT_NOTIFY=true`. Falls back to a `<measurement>` placeholder if the measurement name can't be parsed out of the message. Returns `null` (no hint printed) for `influxdb_flush_failed` alerts that aren't field type conflicts (e.g. connection refused, timeout) and for all other error codes.

## Out of scope

- Automatically running the reset (this stays a manual, confirmed action — it deletes historical data)
- Detecting the conflict before InfluxDB rejects the write
- Per-field type validation in the BBB publisher or Telegraf config

## Acceptance criteria

- [x] `npm run influx:reset-measurement -- <measurement>` deletes the measurement and restarts Telegraf
- [x] Script prompts for confirmation before deleting
- [x] Script reads InfluxDB connection details from `.env`
- [x] `influxdb_flush_failed` alerts with `field type conflict` print the exact fix command, including the parsed measurement name
- [x] Other `influxdb_flush_failed` alerts (e.g. connection refused) print no fix hint
- [x] README troubleshooting section references the script instead of the raw `influx delete` command
- [x] Tests cover the hint-building logic and its wiring into `handleStatusMessage`
