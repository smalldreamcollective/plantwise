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

MEASUREMENT="${1:?Usage: npm run influx:reset-measurement -- <measurement>}"

# Load InfluxDB connection details from .env, falling back to the documented dev defaults
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
INFLUXDB_ORG="${INFLUXDB_ORG:-plantwise}"
INFLUXDB_BUCKET="${INFLUXDB_BUCKET:-sensors}"
INFLUXDB_TOKEN="${INFLUXDB_TOKEN:-plantwise-dev-token}"

echo ""
warn "This permanently deletes ALL historical data for measurement \"${MEASUREMENT}\" in bucket \"${INFLUXDB_BUCKET}\"."
note "This is the fix for an InfluxDB \"field type conflict\" error — it lets InfluxDB"
note "re-establish the field's type from scratch on the next write."
echo ""
read -r -p "Type the measurement name to confirm: " CONFIRM
if [[ "$CONFIRM" != "$MEASUREMENT" ]]; then
  warn "Confirmation did not match \"${MEASUREMENT}\" — aborting."
  exit 1
fi

log "Deleting measurement \"${MEASUREMENT}\" from bucket \"${INFLUXDB_BUCKET}\"..."
docker compose exec influxdb influx delete \
  --bucket "$INFLUXDB_BUCKET" \
  --org "$INFLUXDB_ORG" \
  --start 1970-01-01T00:00:00Z \
  --stop "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --predicate "_measurement=\"${MEASUREMENT}\"" \
  --token "$INFLUXDB_TOKEN"

log "Restarting Telegraf..."
docker compose restart telegraf

echo ""
log "Done. The \"${MEASUREMENT}\" schema will be re-created on the next write."
