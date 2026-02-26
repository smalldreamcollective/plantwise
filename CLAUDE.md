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

## Current phase
Phase 2 complete — dev tooling (ESLint, Prettier, Husky, Vitest, CI) set up.

## Known issues / decisions pending
[Keep this updated]

