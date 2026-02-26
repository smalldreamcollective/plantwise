# PlantWise 🌿

AI-powered houseplant care assistant. Identify plants, diagnose health issues, and track your collection — all from the command line.

## Requirements

- Node.js 20+
- An [Anthropic API key](https://console.anthropic.com)
- A [Plant.id API key](https://web.plant.id)

## Installation

```bash
# 1. Clone the repo
git clone <repo-url>
cd plantwise

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and fill in your API keys
```

**.env**
```
ANTHROPIC_API_KEY=your_anthropic_key_here
PLANTID_API_KEY=your_plantid_key_here
DB_PATH=./plantwise.db
```

## Commands

### `help` — Show commands, or detailed help for a specific command

```bash
# List all commands
npm run help

# Detailed help for a specific command
npm run help -- add
npm run help -- status
npm run help -- identify
npm run help -- diagnose
```

### `add` — Add a plant to your collection

```bash
npm run add -- "Monstera"
npm run add -- "Snake Plant" --species "Sansevieria trifasciata"
npm run add -- "Fiddle Leaf Fig" --species "Ficus lyrata" --notes "Near south window"
```

### `status` — View your collection

```bash
# List all plants
npm run status

# Show health history for a specific plant (requires API keys)
npm run status -- --plant 1
```

### `identify` — Identify a plant from a photo

```bash
npm run identify -- ./photo.jpg
```

Requires Anthropic + Plant.id API keys. The photo is resized to 1024px before submission.

### `diagnose` — Assess plant health from a photo

```bash
# Standalone diagnosis
npm run diagnose -- ./photo.jpg

# Associate with a plant in your collection
npm run diagnose -- ./photo.jpg --plant 1
```

Requires Anthropic + Plant.id API keys. Results are saved to the database automatically.

## Development

```bash
# Type-check only (slow due to LangGraph types — ~2min)
npm run typecheck

# Build to dist/
npm run build
```

## Data

Plant data is stored in a local SQLite database (`plantwise.db` by default). The location can be changed via `DB_PATH` in `.env`.

Two tables:
- **plants** — your collection (name, species, notes)
- **health_checks** — diagnosis history per plant, including raw Plant.id API responses
