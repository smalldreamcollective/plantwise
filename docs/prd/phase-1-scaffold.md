# PRD — Phase 1: Initial Scaffold

## Status
Complete

## Goal
Bootstrap the project with a working CLI skeleton, database layer, and core agent wiring so that all subsequent phases have a solid foundation to build on.

## Background
PlantWise is a CLI-first, AI-powered houseplant care assistant. Phase 1 establishes the repository structure, toolchain, and the minimum viable data model before any real features are added.

## Scope

### What's included
- TypeScript + Node.js project with `tsconfig.json`, `package.json`, and `tsup` build config
- Commander.js CLI entry point (`src/cli/index.ts`) with placeholder commands
- SQLite database layer via `better-sqlite3`:
  - `src/db/schema.ts` — lazy `getDb()`, schema initialisation
  - `src/db/queries.ts` — typed query functions
  - Tables: `plants`, `health_checks`, `watering_logs` (later migrated to `care_events`)
- LangGraph agent scaffold (`src/agent/graph.ts`, `src/agent/tools.ts`)
- Plant.id API client stub (`src/services/plantid.ts`)
- Image resize utility (`src/utils/image.ts`) using `sharp`
- `.env.example` documenting required environment variables

### What's excluded
- Real AI calls (needs API keys not available during scaffold)
- Full CLI commands (added in Phase 3+)
- Dev tooling (added in Phase 2)

## Data model
```sql
CREATE TABLE plants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  species TEXT,
  notes TEXT,
  watering_interval_days INTEGER DEFAULT 7,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE health_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plant_id INTEGER REFERENCES plants(id),
  photo_path TEXT NOT NULL,
  plantid_raw TEXT NOT NULL,
  diagnosis TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Success criteria
- `npm run dev` launches without errors
- `npm run build` produces a dist bundle
- Database schema initialises on first run
