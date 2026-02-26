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

## Current phase
[Update this as you progress]

## Known issues / decisions pending
[Keep this updated]

