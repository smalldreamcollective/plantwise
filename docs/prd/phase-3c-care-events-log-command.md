# PRD — Phase 3C: care_events Refactor + log Subcommand

## Status
Complete

## Goal
Replace the purpose-built `watering_logs` table and `water` command with a generic `care_events` table and `log` subcommand group (`log water`, `log feed`, `log repot`). This supports any care type without per-type schema migrations.

## Background
The `water` command was a one-off. Long-term, users need to track multiple care activities (watering, feeding, repotting). A generic `care_events` table with a `type` column handles all of these in a single structure, and the `log` subcommand group provides a clean CLI surface for logging any event type.

## Changes

### Database: `watering_logs` → `care_events`

**Old schema:**
```sql
CREATE TABLE watering_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  watered_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**New schema:**
```sql
CREATE TABLE care_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  type TEXT NOT NULL,       -- 'water' | 'feed' | 'repot' | ...
  notes TEXT,               -- optional free-text note
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Migration** (in `schema.ts`): On first run against an existing DB, rows from `watering_logs` are copied to `care_events` with `type = 'water'`, then `watering_logs` is dropped. Fresh installs skip silently.

---

### Queries: new functions

| Old | New |
|-----|-----|
| `WateringLog` interface | `CareEvent` interface |
| `logWatering(plantId)` | `logCareEvent(plantId, type, notes?)` |
| `getLastWatering(plantId)` | `getLastCareEvent(plantId, type)` |

`PLANT_WITH_WATERING_SQL` updated to join against `care_events WHERE type = 'water'` using `occurred_at` instead of `watered_at`. `getPlantWithWatering` and `getPlantsOverdueForWatering` retain their names — only SQL internals change.

---

### CLI: `water` → `log` subcommand group

**Old:**
```
plantwise water <id>
```

**New:**
```
plantwise log water <id> [--notes <notes>]
plantwise log feed <id> [--notes <notes>]
plantwise log repot <id> [--notes <notes>]
```

**Output format:**
```
Watered Basil [ID: 1] on 2026-02-26
Fed Basil [ID: 1] on 2026-02-26 — Osmocote
Repotted Basil [ID: 1] on 2026-02-26
```

The `makeLogAction(type, pastTense)` factory reduces repetition across the three subcommands.

---

### npm scripts

| Old | New |
|-----|-----|
| `npm run water -- 1` | `npm run log -- water 1` |

Usage: `npm run log -- feed 1 --notes "Osmocote"`

---

## Design decisions
- **No `water` alias preserved** — clean break; old command removed entirely
- **`notes` column is nullable** — free-form, optional per event
- **`type` is a plain string** — no enum constraint in SQLite; validated by CLI subcommands
- **Multi-user is future work** — no `user_id` column yet; see CLAUDE.md

## Success criteria
- All 25 DB tests pass
- `npm run lint` and `npm run format:check` clean
- `npm run build` succeeds
- `npm run log -- water 1` → `Watered <name> [ID: 1] on <date>`
- `npm run log -- feed 1 --notes "Osmocote"` → `Fed <name> [ID: 1] on <date> — Osmocote`
- `npm run remind` and `status --plant` correctly reflect watering events
