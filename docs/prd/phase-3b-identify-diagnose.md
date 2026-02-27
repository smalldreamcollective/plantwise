# PRD — Phase 3B: AI Commands (identify + diagnose)

## Status
Complete (wired; not end-to-end tested — requires API keys)

## Goal
Add the two AI-powered commands — `identify` and `diagnose` — that use the LangGraph agent, Plant.id API, and Claude for photo-based plant identification and health diagnosis.

## Background
These commands require both an Anthropic API key and a Plant.id API key. They are intentionally separated from the "direct" commands so users without API keys can still use the core collection management features.

## Commands

### `identify <photo>`
Identify a plant from a photo.

**Flow:**
1. User provides a path to a photo
2. Photo is resized to max 1024px (`src/utils/image.ts`)
3. Agent calls the `identify_plant` tool (`src/agent/tools.ts`) → Plant.id identify API
4. Claude summarises the top species matches
5. Result printed to stdout

**Output:** Human-readable summary of top plant matches with confidence scores.

---

### `diagnose <photo> [--plant <id>]`
Assess plant health from a photo.

**Options:** `--plant <id>` — associate the diagnosis with an existing plant in the collection.

**Flow:**
1. User provides a path to a photo (and optionally a plant ID)
2. Photo is resized to max 1024px
3. Agent calls `assess_plant_health` tool → Plant.id health assessment API
4. Agent calls `save_health_check` tool → stores result in `health_checks` table
5. Claude provides a plain-language diagnosis with care recommendations
6. Result printed to stdout

**Output:** Diagnosis summary + care recommendations. Record saved to DB.

---

## Agent architecture
- `src/agent/graph.ts` — LangGraph state machine with a single reasoning node and tool execution node
- `src/agent/tools.ts` — two LangChain tools: `identify_plant`, `assess_plant_health`, `save_health_check`
- `src/services/plantid.ts` — axios-based Plant.id v3 API client

## Data requirements
- `health_checks` table stores: `plant_id`, `photo_path`, raw Plant.id JSON (`plantid_raw`), Claude's `diagnosis` text
- Plant.id raw response is stored as-is; Claude generates the final user-facing text

## Key decisions
- Claude is used for final response generation, not raw Plant.id output — ensures consistent, actionable advice
- Image resize happens before any API call to control costs and latency
- `plantid_raw` stored as JSON string for future re-processing without re-calling the API

## Success criteria
- `npm run identify -- ./photo.jpg` → species summary (with valid API keys)
- `npm run diagnose -- ./photo.jpg --plant 1` → diagnosis saved, summary printed
- Health check appears in `npm run status -- --plant 1` output
