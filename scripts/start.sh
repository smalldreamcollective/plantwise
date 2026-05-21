#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# ── colours ──────────────────────────────────────────────────────────────────
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
DIM='\033[2m'
RESET='\033[0m'

log()  { echo -e "${BOLD}${GREEN}▸${RESET} $*"; }
note() { echo -e "${DIM}  $*${RESET}"; }
warn() { echo -e "${YELLOW}⚠  $*${RESET}"; }

echo ""
echo -e "${BOLD}PlantWise — local stack${RESET}"
echo ""

# ── preflight ────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  warn "Docker not found. Install Docker Desktop and try again."
  exit 1
fi

if ! docker info &>/dev/null; then
  warn "Docker daemon isn't running. Start Docker Desktop and try again."
  exit 1
fi

if [[ ! -f "$ROOT/.env" ]]; then
  warn ".env not found. Copy .env.example to .env and fill in your API keys."
  exit 1
fi

# ── docker services ──────────────────────────────────────────────────────────
log "Starting Docker services..."
docker compose up -d --quiet-pull
echo ""

# Wait until InfluxDB is accepting connections (up to 30 s)
log "Waiting for InfluxDB to be ready..."
ATTEMPTS=0
until curl -sf http://localhost:8086/health | grep -q '"status":"pass"' 2>/dev/null; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [[ $ATTEMPTS -ge 30 ]]; then
    warn "InfluxDB didn't become healthy in 30 s — continuing anyway."
    break
  fi
  sleep 1
done

# ── open browser UIs (macOS) ─────────────────────────────────────────────────
if command -v open &>/dev/null; then
  log "Opening dashboards..."
  note "Grafana  → http://localhost:3001  (admin / admin)"
  note "Node-RED → http://localhost:1880"
  note "InfluxDB → http://localhost:8086"
  echo ""
  open "http://localhost:3001"
  sleep 0.4
  open "http://localhost:1880"
fi

# ── mqtt subscriber ───────────────────────────────────────────────────────────
log "Starting MQTT subscriber — press Ctrl-C to stop."
echo ""
npm run serve
