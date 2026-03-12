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
- **Every feature starts with a GitHub issue.** Create one with `npm run issue:new` before writing any code.
- **Use `npm run start-work -- <issue-number>` to begin work.** This pulls latest main, creates a branch named `<prefix>/<issue-number>-<slug>` (prefix inferred from labels: bug→fix, documentation→docs, else feat), pushes it, and opens a draft PR linked to the issue.
- Branch naming follows `feat/42-short-description` — the issue number is part of the branch name.
- A `commit-msg` hook automatically appends `Closes #<n>` to every commit based on the branch name, so issues close when the PR merges.
- Use Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`
- **Never commit directly to main.** All changes must go through a branch and PR so CI/CD checks and tests can run. No exceptions.
- Pre-commit hook runs lint-staged automatically — do not skip with `--no-verify`
- Run `npm test` before opening a PR
- **Always update README.md and the `help-guide` command in `src/cli/index.ts`** whenever commands are added, changed, or removed
- **Every feature must have a PRD in `docs/prd/`** — create or update the relevant file before writing code. Naming: `phase-Nx-short-description.md`
- **Every new feature or query function must include tests.** Add or update the relevant `*.test.ts` file alongside the code change. Coverage targets: 80% lines/functions/statements, 70% branches (enforced by `npm run test:coverage`). Exceptions: `src/agent/` (LangGraph — requires live API) and `src/cli/` (Commander.js wiring — business logic is covered by query tests).

### Quick reference
```bash
npm run issue              # list open issues
npm run issue:new          # create a new issue
npm run issue:view -- 42   # view issue #42
npm run start-work -- 42   # branch + draft PR for issue #42
```

## Current phase
Phase 4C complete — MQTT subscriber + BeagleBone Black publisher + Docker Compose broker. See `docs/prd/` for all phase PRDs.

## Known issues / decisions pending
- Multi-user / hosted is a future goal. When that phase begins: add `user_id` to all tables, switch to UUID primary keys, introduce an API layer, evaluate Supabase or MongoDB Atlas as the backend.
- Each feature should have a PRD in `docs/prd/`. When adding or changing features, create or update the relevant PRD file.
- **Phase 4C uses MQTT (Mosquitto broker), not HTTP.** MQTT was chosen over Express/HTTP because the long-term vision involves multiple MCU types (BeagleBone Black, Pi Zero W, IEIK ESP32 — Sonos-style multi-room). MQTT's pub/sub model lets new devices join with zero server config changes and supports remote command dispatch. HTTP API is deferred to Phase 4D alongside the web UI.
- **Phase 5 adds pump actuation.** Hardware: Adafruit 3V DC submersible pump [ID:4546] switched via transistor/MOSFET from MCU GPIO. Supports auto-watering (moisture threshold) and manual CLI command. Safety limits: 30s max run, 1hr min interval per plant.

