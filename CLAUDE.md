# PlantWise — Claude Code Context

## What this project is
AI-powered houseplant care assistant. CLI-first, TypeScript/Node.js.

## Tech stack
- TypeScript + Node.js
- LangGraph.js for agent orchestration
- Anthropic claude-sonnet for reasoning + vision
- Plant.id API for plant identification and health diagnosis
- SQLite (better-sqlite3) for persistence
- Commander.js for CLI

## Key files
- src/agent/graph.ts — LangGraph state graph
- src/agent/tools.ts — Tool definitions
- src/services/plantid.ts — Plant.id API client
- src/db/queries.ts — All database operations

## Security
Never read .env files.

## Conventions
- All async DB operations use better-sqlite3 (sync API)
- Images are resized to max 1024px before API submission
- Plant.id results stored as raw JSON in health_checks table
- Claude is used for final response generation, not raw Plant.id output

## Workflow
- **Always create a new branch before making changes** — never commit directly to `main`
- Branch from `main` using `feat/`, `fix/`, or `chore/` prefixes (e.g. `feat/add-watering-reminders`)
- Use Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`
- Pre-commit hook runs lint-staged automatically — do not skip with `--no-verify`
- Run `npm test` before opening a PR
- **Always update README.md and the `help-guide` command in `src/cli/index.ts`** whenever commands are added, changed, or removed
- **Every feature must have a PRD in `docs/prd/`** — create or update the relevant file before writing code. Naming: `phase-Nx-short-description.md`

## Current phase
Phase 3C complete — care_events table + log subcommand group (water/feed/repot). See `docs/prd/` for all phase PRDs.

## Known issues / decisions pending
- Multi-user / hosted is a future goal. When that phase begins: add `user_id` to all tables, switch to UUID primary keys, introduce an API layer, evaluate Supabase or MongoDB Atlas as the backend.
- Each feature should have a PRD in `docs/prd/`. When adding or changing features, create or update the relevant PRD file.
- **Phase 4C uses MQTT (Mosquitto broker), not HTTP.** MQTT was chosen over Express/HTTP because the long-term vision involves multiple Pi controllers (Sonos-style multi-room). MQTT's pub/sub model lets new devices join with zero server config changes and supports remote command dispatch. HTTP API is deferred to Phase 4D alongside the web UI.

