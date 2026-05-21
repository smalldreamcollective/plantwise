#!/usr/bin/env bash
set -euo pipefail

# PlantWise tmux dashboard
#
# Layout:
#   ┌──────────────────────────────┬─────────────────┐
#   │  MQTT subscriber             │  sensor status  │
#   │  (npm run serve)             │  auto-refresh   │
#   │                              │                 │
#   ├──────────────────────────────├─────────────────┤
#   │  docker compose logs         │  shell          │
#   │  telegraf + mosquitto        │                 │
#   └──────────────────────────────┴─────────────────┘
#
# Usage:
#   bash scripts/dashboard.sh           # start or attach
#   bash scripts/dashboard.sh --reset   # kill existing session and restart
#
# iTerm2 native panes (optional):
#   tmux -CC attach -t plantwise        # run this in a fresh iTerm2 tab

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

SESSION="plantwise"

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
DIM='\033[2m'
RESET='\033[0m'

log()  { echo -e "${BOLD}${GREEN}▸${RESET} $*"; }
note() { echo -e "${DIM}  $*${RESET}"; }
warn() { echo -e "${YELLOW}⚠  $*${RESET}"; }

echo ""
echo -e "${BOLD}PlantWise — dashboard${RESET}"
echo ""

# ── preflight ────────────────────────────────────────────────────────────────
if ! command -v tmux &>/dev/null; then
  warn "tmux not found. Install with: brew install tmux"
  exit 1
fi

if ! command -v docker &>/dev/null || ! docker info &>/dev/null 2>&1; then
  warn "Docker isn't running. Start Docker Desktop and try again."
  exit 1
fi

if [[ ! -f "$ROOT/.env" ]]; then
  warn ".env not found. Copy .env.example to .env and fill in your API keys."
  exit 1
fi

# ── reset flag ───────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--reset" ]]; then
  tmux kill-session -t "$SESSION" 2>/dev/null && log "Killed existing session." || true
fi

# ── attach if already running ─────────────────────────────────────────────────
if tmux has-session -t "$SESSION" 2>/dev/null; then
  log "Session already running — attaching."
  echo ""
  exec tmux attach-session -t "$SESSION"
fi

# ── docker services ───────────────────────────────────────────────────────────
log "Starting Docker services..."
docker compose up -d --quiet-pull
echo ""

log "Waiting for InfluxDB..."
ATTEMPTS=0
until curl -sf http://localhost:8086/health 2>/dev/null | grep -q '"status":"pass"'; do
  ATTEMPTS=$((ATTEMPTS + 1))
  [[ $ATTEMPTS -ge 30 ]] && { warn "InfluxDB didn't respond in 30s — continuing."; break; }
  sleep 1
done

# ── open browser UIs (macOS) ──────────────────────────────────────────────────
if command -v open &>/dev/null; then
  note "Grafana  → http://localhost:3001  (admin / admin)"
  note "Node-RED → http://localhost:1880"
  open "http://localhost:3001"
  sleep 0.3
  open "http://localhost:1880"
  echo ""
fi

# ── build tmux session ────────────────────────────────────────────────────────
log "Building dashboard..."

COLS=$(tput cols)
LINES=$(tput lines)

tmux new-session -d -s "$SESSION" -n main -x "$COLS" -y "$LINES"

# Split: right column 32% wide  → pane 0 (left), pane 1 (right)
tmux split-window -h -t "$SESSION:main.0" -p 32

# Split left column: docker logs takes bottom 28%  → pane 0 (top-left), pane 2 (bottom-left)
tmux split-window -v -t "$SESSION:main.0" -p 28

# Split right column: shell takes bottom 50%  → pane 1 (top-right), pane 3 (bottom-right)
tmux split-window -v -t "$SESSION:main.1" -p 50

# ── pane 0: MQTT subscriber ───────────────────────────────────────────────────
tmux send-keys -t "$SESSION:main.0" "cd $ROOT && npm run serve" Enter

# ── pane 1: sensor status (auto-refresh every 10s) ───────────────────────────
tmux send-keys -t "$SESSION:main.1" \
  "cd $ROOT && while true; do clear; printf '\033[1mSensor Status\033[0m\n\n'; npm run sensor -- status 2>/dev/null; sleep 10; done" \
  Enter

# ── pane 2: docker compose logs ───────────────────────────────────────────────
tmux send-keys -t "$SESSION:main.2" \
  "cd $ROOT && docker compose logs -f telegraf mosquitto" \
  Enter

# ── pane 3: shell (ready for CLI commands) ────────────────────────────────────
tmux send-keys -t "$SESSION:main.3" "cd $ROOT" Enter

# Focus MQTT pane
tmux select-pane -t "$SESSION:main.0"

# ── attach ────────────────────────────────────────────────────────────────────
if [[ "${TERM_PROGRAM:-}" == "iTerm.app" ]]; then
  note "Tip: open a new iTerm2 tab and run  tmux -CC attach -t $SESSION  for native panes."
  echo ""
fi

exec tmux attach-session -t "$SESSION"
