# PlantWise 🌿

AI-powered houseplant care assistant. Identify plants, diagnose health issues, and track your collection — all from the command line.

## Requirements

- Node.js 20+
- An [Anthropic API key](https://console.anthropic.com) *(required for `identify` and `diagnose` only)*
- A [Plant.id API key](https://web.plant.id) *(required for `identify` and `diagnose` only)*

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

# MQTT (required for `npm run serve`)
MQTT_HOST=localhost
MQTT_PORT=1883
MQTT_USERNAME=
MQTT_PASSWORD=
MQTT_NOTIFY=false
```

## Commands

### `help` — Show commands, or detailed help for a specific command

```bash
# List all commands
npm run help

# Detailed help for a specific command
npm run help -- add
npm run help -- log
npm run help -- remind
npm run help -- remove
npm run help -- status
npm run help -- identify
npm run help -- diagnose
```

---

Commands marked **direct** work without API keys. Commands marked **AI** require Anthropic + Plant.id keys.

### `add` — Add a plant to your collection *(direct)*

```bash
npm run add -- "Monstera"
npm run add -- "Snake Plant" --species "Sansevieria trifasciata"
npm run add -- "Fiddle Leaf Fig" --species "Ficus lyrata" --notes "Near south window"
npm run add -- "Cactus" --interval 21 --threshold 15 --upper-threshold 80
```

Defaults: watering interval 7 days, low moisture threshold 30%, overwatering threshold 85%. Override with `--interval`, `--threshold`, and `--upper-threshold` at creation, or change later with `update`.

### `update` — Update a plant's details *(direct)*

```bash
npm run update -- 1 --name "Monstera Deliciosa"
npm run update -- 1 --species "Monstera deliciosa"
npm run update -- 1 --interval 10 --threshold 25
npm run update -- 1 --upper-threshold 80
npm run update -- 1 --notes "Moved to south window"
```

All flags are optional — only the fields you provide are changed.

### `log` — Log a care event for a plant *(direct)*

```bash
# Log a watering
npm run log -- water 1

# Log a feeding with notes
npm run log -- feed 1 --notes "Osmocote"

# Log a repot
npm run log -- repot 1
```

### `remind` — List plants overdue for watering *(direct)*

```bash
# List overdue plants
npm run remind

# List overdue plants + fire a desktop notification for each
npm run remind -- --notify
```

Shows every plant whose last watering exceeds its interval (default: 7 days), ordered by most overdue first. Plants that have never been watered are always listed. When soil moisture sensor data is available, moisture levels take priority over time-based logic.

**Notifications (macOS):** `--notify` fires a native notification per overdue plant via `osascript`. If notifications don't appear, enable them in **System Settings → Notifications → iTerm2** (or whichever terminal you use) and set to Banners or Alerts.

**Cron setup** — run every 30 minutes automatically:
```bash
*/30 * * * * cd /path/to/plantwise && npm run remind -- --notify >> /tmp/plantwise.log 2>&1
```

### `remove` — Remove a plant from your collection *(direct)*

```bash
npm run remove -- 1
```

Prompts for confirmation before deleting the plant and all its associated care events and health checks.

### `status` — View your collection *(direct)*

```bash
# List all plants
npm run status

# Show detailed status and health history for a specific plant
npm run status -- --plant 1
```

### `identify` — Identify a plant from a photo *(AI)*

```bash
npm run identify -- ./photo.jpg
```

Requires API keys. The photo is resized to 1024px before submission.

### `diagnose` — Assess plant health from a photo *(AI)*

```bash
# Standalone diagnosis
npm run diagnose -- ./photo.jpg

# Associate the result with a plant in your collection
npm run diagnose -- ./photo.jpg --plant 1
```

Requires API keys. Results are saved to the database automatically.

### `sensor` — Manage soil moisture readings *(direct)*

```bash
# Log a manual reading (0–100)
npm run sensor -- read 1 45

# Generate an emulated dryout curve (7 days by default)
npm run sensor -- simulate 1
npm run sensor -- simulate 1 --days 14

# Show latest moisture for all plants
npm run sensor -- status

# Show latest moisture for a specific plant
npm run sensor -- status 1

# Show full reading history for a plant (20 most recent by default)
npm run sensor -- history 1
npm run sensor -- history 1 --limit 50
```

### `serve` — Start the MQTT subscriber *(direct)*

```bash
npm run serve
```

Connects to the Mosquitto broker and listens for soil moisture readings published by hardware sensors. Readings are stored in `sensor_readings` automatically. Set `MQTT_NOTIFY=true` in `.env` to fire a desktop notification when moisture drops below a plant's threshold.

**Broker setup:**
```bash
docker compose up -d
```

This starts a Mosquitto broker on port 1883 using the config in [`mosquitto/mosquitto.conf`](mosquitto/mosquitto.conf). To stop it: `docker compose down`.

**Hardware setup:** See [`hardware/beaglebone/moisture_publisher.py`](hardware/beaglebone/moisture_publisher.py) for the BeagleBone Black publisher script. Set `BROKER_HOST` to your Mac's LAN IP and run it via cron every 15 minutes:
```bash
*/15 * * * * python3 /path/to/moisture_publisher.py >> /tmp/plantwise-sensor.log 2>&1
```

## Development

```bash
# Run tests
npm run test

# Watch mode
npm run test:watch

# Lint
npm run lint

# Format
npm run format

# Type-check (slow due to LangGraph types — ~2min)
npm run typecheck

# Build to dist/
npm run build
```

## Data

Plant data is stored in a local SQLite database (`plantwise.db` by default). The location can be changed via `DB_PATH` in `.env`.

Four tables:
- **plants** — your collection (name, species, notes, watering interval, moisture threshold)
- **health_checks** — diagnosis history per plant, including raw Plant.id API responses
- **care_events** — timestamped care events per plant (type: `water`, `feed`, `repot`, etc.)
- **sensor_readings** — soil moisture readings per plant (source: `manual`, `emulated`, or `hardware`)
