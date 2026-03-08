# PRD: Phase 4E — Overwatering Upper Threshold

## Overview

Add a per-plant upper moisture threshold (`moisture_upper_threshold_pct`) so the system can detect and alert when soil is **too wet**, complementing the existing lower threshold that detects when a plant needs water.

## Motivation

Overwatering is a leading cause of houseplant death. Root rot sets in when soil stays saturated for extended periods. The sensor hardware is already publishing moisture readings — surfacing overwatering alerts requires only a new threshold column and alert path.

## Scope

- New `moisture_upper_threshold_pct` column on the `plants` table (default: 85%)
- MQTT subscriber logs "too wet" and fires an optional notification when moisture exceeds the upper threshold
- `sensor status` command shows "Too wet" status
- `remind` is not changed — overdue-for-watering logic is not affected
- `add` and `update` accept `--upper-threshold` to configure per-plant

## Default value

85% — chosen to avoid false positives immediately after watering while still flagging genuinely saturated soil.

## Schema change

```sql
ALTER TABLE plants ADD COLUMN moisture_upper_threshold_pct INTEGER DEFAULT 85;
```

Migration applied automatically on first `getDb()` call for existing databases.

## Affected files

- `src/db/schema.ts` — add column + migration
- `src/db/queries.ts` — Plant interface, insertPlant, PlantUpdates, getPlantsOverwatered()
- `src/mqtt/subscriber.ts` — check upper threshold, log + notify
- `src/cli/index.ts` — --upper-threshold on add/update, status display
- `README.md` — updated docs
- `src/db/queries.test.ts` — new tests
- `src/mqtt/subscriber.test.ts` — new tests

## Out of scope

- `remind` command (focused on underwatering/time-based logic)
- HTTP API (Phase 4D)
