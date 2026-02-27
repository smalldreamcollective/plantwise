# PRD — Phase 4A: Sensor Ingestion + Moisture-Driven Reminders

## Status
Planned

## Goal
Add a `sensor` subcommand group and `sensor_readings` table that accepts soil moisture data — emulated in software now, real hardware later. Wire moisture levels into the watering reminder system so reminders are driven by actual soil state, not just elapsed time.

## Background
A Raspberry Pi + soil moisture sensor is on order. Rather than wait for hardware, we build the full ingestion and logic layer now using a software emulator. When the Pi arrives, it calls the same interface — no product code changes needed.

## Data model

### New table: `sensor_readings`
```sql
CREATE TABLE IF NOT EXISTS sensor_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  moisture_pct INTEGER NOT NULL CHECK (moisture_pct BETWEEN 0 AND 100),
  source TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'emulated' | 'hardware'
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Migration: add `moisture_threshold_pct` to `plants`
```sql
ALTER TABLE plants ADD COLUMN moisture_threshold_pct INTEGER DEFAULT 30;
```
Plants are flagged for watering when the latest reading drops below this threshold. Default 30% matches a typical "water me" signal for most houseplants.

---

## CLI: `sensor` subcommand group

### `sensor read <id> <moisture>`
Log a single moisture reading for a plant. The primary interface for both manual entry and hardware ingestion.

```bash
npm run sensor -- read 1 45       # Plant 1 is at 45% moisture
npm run sensor -- read 2 18       # Plant 2 is critically dry
```

Output:
```
Moisture recorded for Basil [ID: 1]: 45% (threshold: 30%) — OK
Moisture recorded for Orchid [ID: 2]: 18% (threshold: 30%) — needs water
```

---

### `sensor simulate <id> [--days <n>]`
Generate a realistic dryout curve for a plant, inserting backdated readings. Uses the plant's `watering_interval_days` to calibrate the decay rate. Adds ±5% noise for realism.

```bash
npm run sensor -- simulate 1           # Simulate last 7 days
npm run sensor -- simulate 1 --days 14 # Simulate last 14 days
```

**Dryout model:**
- Start at 90% moisture at the time of the last `water` care event (or 14 days ago if none)
- Exponential decay toward 10% over `watering_interval_days`
- One reading per simulated hour, with ±5% Gaussian noise
- Source column set to `'emulated'`

Output:
```
Simulated 168 readings for Basil [ID: 1] over 7 days
Current simulated moisture: 24% (threshold: 30%) — needs water
```

---

### `sensor status [<id>]`
Show the latest moisture reading for one plant or all plants.

```bash
npm run sensor -- status        # All plants with recent readings
npm run sensor -- status 1      # Single plant
```

Output:
```
Soil moisture status:

  [1] Basil              45%  ████████░░  OK          (2 min ago)
  [2] Orchid             18%  ███░░░░░░░  Needs water (1 hr ago)
  [3] Monstera           —    no readings yet
```

---

## Updated `remind` command

When a plant has sensor readings, use moisture to determine overdue status instead of (or alongside) time:

| Condition | Overdue? |
|-----------|----------|
| Latest reading < `moisture_threshold_pct` | Yes |
| No readings + time > `watering_interval_days` | Yes (existing logic) |
| Latest reading ≥ threshold | No (even if time-overdue) |
| Reading older than 24h | Fall back to time-based logic |

This makes sensor data the source of truth when fresh, and degrades gracefully to time-based reminders when hardware is offline.

---

## New queries (`src/db/queries.ts`)

```ts
interface SensorReading {
  id: number;
  plant_id: number;
  moisture_pct: number;
  source: string;
  recorded_at: string;
}

logSensorReading(plantId, moisturePct, source?): SensorReading
getLatestSensorReading(plantId): SensorReading | undefined
getSensorReadings(plantId, limit?): SensorReading[]
```

---

## Hardware bridge (when Pi arrives)

The Pi runs a cron job every 15 minutes:
```bash
# On the Pi — calls the same CLI command over SSH or locally
plantwise sensor read <plant_id> <moisture_value>
```

Or, if a local HTTP server is added later (Phase 4B), the Pi posts:
```
POST /sensor { plant_id: 1, moisture_pct: 42 }
```

No product code changes required — the `hardware` source value in `sensor_readings` is the only difference.

---

## npm scripts

```json
"sensor": "tsx src/cli/index.ts sensor"
```

Usage:
```bash
npm run sensor -- read 1 45
npm run sensor -- simulate 1 --days 7
npm run sensor -- status
```

---

## Out of scope for this phase
- HTTP server for Pi to POST to (Phase 4B)
- Push notifications when moisture drops (Phase 4C)
- Historical moisture charts (Phase 4D)
- Calibration per sensor unit (hardware-specific, post-delivery)

---

## Success criteria
- `npm run sensor -- read 1 45` → reading stored, threshold check printed
- `npm run sensor -- simulate 1` → realistic dryout curve in DB
- `npm run sensor -- status` → moisture levels for all plants
- `npm run remind` → uses sensor data when fresh, falls back to time-based when stale
- All tests passing, lint clean, build succeeds
- Interface is identical to what the real Pi will call — no rework needed when hardware arrives
