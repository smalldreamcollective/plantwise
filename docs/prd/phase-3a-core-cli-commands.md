# PRD — Phase 3A: Core CLI Commands

## Status
Complete

## Goal
Add the first real, usable CLI commands — `add`, `status`, `remove`, `remind`, and `help-guide` — that work without API keys and give users a functional plant collection manager.

## Background
Phase 1 scaffolded the CLI entry point and database layer. Phase 3A wires them together into commands a user can actually run. These "direct" commands require no AI/API keys and form the backbone of daily use.

## Commands

### `add <name>`
Add a plant to the collection.

**Options:** `--species <species>`, `--notes <notes>`

**Output:** `Added plant: Monstera (Monstera deliciosa) [ID: 1]`

**Implementation:** Calls `insertPlant()` directly; no agent involved.

---

### `status [--plant <id>]`
- Without `--plant`: list all plants with ID, name, species, notes
- With `--plant <id>`: show detailed view — watering interval, last watered, health check history

**Implementation:** Calls `listPlants()` or `getPlantWithWatering()` + `getHealthChecksForPlant()`.

---

### `remind`
List all plants overdue for watering, ordered by most overdue first. Plants never watered are always listed.

**Output format:**
```
Plants overdue for watering (2):

  [1] Monstera — Monstera deliciosa
       Last watered: 10 days ago  (every 7d)
  [2] Orchid
       Last watered: never  (every 7d)
```

**Implementation:** Calls `getPlantsOverdueForWatering()`.

---

### `remove <id>`
Remove a plant and all its associated data. Prompts for confirmation (`y/N`) before proceeding.

**Implementation:** Calls `getPlant()` then `removePlant()` inside a transaction that cascades to `care_events` and explicitly deletes `health_checks`.

---

### `help-guide [command]`
Show the main help menu, or detailed help for a named command. Exposed as `npm run help`.

---

## Data requirements
All commands use the `plants` table. `status --plant` and `remind` also join against `care_events` (via the `PLANT_WITH_WATERING_SQL` subquery).

## Success criteria
- All commands run without API keys
- `npm run add -- "Basil"` → plant stored, ID returned
- `npm run status` → lists collection
- `npm run remind` → lists overdue plants
- `npm run remove -- 1` → prompts, then deletes
