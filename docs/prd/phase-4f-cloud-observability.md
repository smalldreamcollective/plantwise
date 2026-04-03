# Phase 4F — Cloud Observability: InfluxDB + Grafana + Telegraf

## Status
Active

## Problem

The current sensor data pipeline has a fundamental reliability gap:

```
BBB (cron) → MQTT publish (QoS 0) → Mosquitto broker → host subscriber → SQLite
```

Every hop is fire-and-forget. If the host is offline, the broker restarts, or the network blips, readings are silently dropped. The BBB's local log and the host's SQLite DB can diverge with no way to reconcile them. There is also no visibility into device health without SSH access.

As more hardware devices are added (Pi Zero, ESP32) this problem compounds — each device has its own local log, and the only aggregated view is what happened to reach the host.

## Goals

- Sensor readings are durable regardless of transient network or process failures
- All hardware devices share a single source of truth for time-series sensor data
- Device health (last seen, publish rate, errors) is visible in a dashboard
- Moisture threshold alerts are observable, not dependent on `MQTT_NOTIFY` on the host
- SQLite and the CLI continue to work for local queries
- Foundation is in place for Phase 5 pump actuation and future multi-device support
- Local dev environment mirrors production — no cloud account required to develop

## Non-goals

- Replacing the MQTT pub/sub pipeline (it stays for device communication)
- Full web UI (deferred to Phase 4D)
- Multi-user / hosted mode (future)
- Cloud hosting (Phase 4F-cloud, a future migration once the local stack is validated)

---

## Approach: Local-first, cloud-ready

All services run locally via Docker Compose using open-source images that are API-compatible with their cloud counterparts. When ready to move to cloud:

| Local (Phase 4F) | Cloud (future Phase 4F-cloud) | Change required |
|---|---|---|
| Mosquitto (Docker) | EMQX Cloud | Update `MQTT_HOST` in `.env` |
| InfluxDB OSS 2.x (Docker) | InfluxDB Cloud | Update `INFLUXDB_URL` + token in `.env` |
| Grafana OSS (Docker) | Grafana Cloud | Export/import dashboards, update datasource URL |
| Telegraf (Docker) | Telegraf (same config) | No change |

Everything is driven by `.env` — no code changes needed to migrate to cloud.

---

## Architecture

### Data flow

```
BBB sensor read
  → write to BBB-local SQLite buffer (store-and-forward, durable across restarts)
  → flush buffer to InfluxDB (http://<host-ip>:8086, with retry + replay on reconnect)
  → publish to MQTT (QoS 1) → Mosquitto
      → Telegraf (mqtt_consumer plugin) → InfluxDB [redundant path]
      → npm run serve → SQLite on host [local CLI cache]

Grafana → queries InfluxDB → dashboards + alerts
```

**InfluxDB is the source of truth. SQLite on the host is a derived local cache.**

### Docker Compose services (added to existing stack)

```
mosquitto     (existing)
influxdb      influxdb:2.7  — time-series store, port 8086
grafana       grafana/grafana — dashboards, port 3000
telegraf      telegraf — MQTT subscriber → InfluxDB writer
```

### BBB changes

- `moisture_publisher.py` gains a local SQLite store-and-forward buffer
- Reads from buffer flush to InfluxDB on each run; on reconnect, replay queued readings
- Publish a `plantwise/devices/<device-id>/status` MQTT message on startup (`online`) and shutdown (`offline`)
- NTP must be configured on the BBB (critical for accurate time-series timestamps)

### Host-side changes

- `docker-compose.yml` expanded with InfluxDB, Grafana, Telegraf services
- Telegraf config subscribes to `plantwise/sensors/+/moisture` and writes to InfluxDB
- `npm run serve` continues writing to SQLite for CLI commands (unchanged)
- Grafana provisioned with InfluxDB datasource and an initial PlantWise dashboard

---

## Failure Analysis

| Component | Failure | Impact | Mitigation |
|---|---|---|---|
| BBB → InfluxDB | Network unreachable | Write fails | Store-and-forward buffer; replays on reconnect |
| BBB process restart | Crash during publish | In-flight reading lost | Buffer written before network calls |
| Mosquitto | Docker/host restart | MQTT path down | Telegraf reconnects automatically; InfluxDB direct path unaffected |
| InfluxDB | Docker restart | Writes fail temporarily | Persistent Docker volume; buffer replays on recovery |
| Grafana | Docker restart | Dashboards unavailable | Persistent Docker volume; data safe in InfluxDB |
| BBB clock drift | NTP not configured | Timestamps wrong | Configure NTP on BBB (part of this phase) |
| Two write paths | One succeeds, one fails | Minor duplication | InfluxDB deduplicates on timestamp + tags |

---

## Implementation Plan

### 1. Docker Compose — expand local stack

Add to `docker-compose.yml`:
- `influxdb` — InfluxDB 2.7, auto-initialized with org/bucket/token via env vars
- `grafana` — Grafana OSS, provisioned with InfluxDB datasource
- `telegraf` — configured via `telegraf/telegraf.conf`

### 2. Telegraf config

`telegraf/telegraf.conf`:
- Input: `mqtt_consumer` subscribing to `plantwise/sensors/+/moisture`
- Parser: JSON, extracting `plant_id` and `moisture_pct` fields
- Output: `influxdb_v2` writing to local InfluxDB

### 3. moisture_publisher.py — add store-and-forward + InfluxDB write

- Add `influxdb-client` Python dependency
- Add local SQLite buffer (`/home/debian/.plantwise_buffer.db`) — table: `pending_readings(plant_id, moisture_pct, sensor_id, recorded_at, published)`
- On each sensor read: write to buffer first, then attempt InfluxDB flush
- Flush: iterate unpublished buffer rows, write to InfluxDB in batch, mark as published
- On startup: publish `{"status": "online", "device": "<hostname>"}` to `plantwise/devices/<id>/status`
- On clean shutdown (SIGTERM): publish `{"status": "offline"}` before exit

### 4. Grafana provisioning

`grafana/provisioning/datasources/influxdb.yaml` — auto-configure InfluxDB datasource on startup
`grafana/provisioning/dashboards/` — provision PlantWise dashboard:
- Moisture history per plant (time-series panel)
- Latest moisture per plant (gauge panel)
- Device last-seen (stat panel)

### 5. Environment config

New `.env` variables:
```
INFLUXDB_URL=http://localhost:8086
INFLUXDB_TOKEN=plantwise-dev-token
INFLUXDB_ORG=plantwise
INFLUXDB_BUCKET=sensors
```

On the BBB:
```
INFLUXDB_URL=http://<mac-lan-ip>:8086
INFLUXDB_TOKEN=plantwise-dev-token
```

### 6. Issues #23 and #24 (folded in)

- **#23 (log management):** migrate BBB from cron to systemd service as part of this phase — enables clean startup/shutdown hooks and journald logging
- **#24 (deployment):** clone repo on BBB and use `git pull` for updates — needed to deploy the updated publisher and install new Python dependencies

---

## Acceptance Criteria

- [ ] `docker compose up` starts Mosquitto, InfluxDB, Grafana, and Telegraf
- [ ] Moisture readings from the BBB appear in InfluxDB within 60 seconds of publish
- [ ] Readings are not lost when the host-side subscriber (`npm run serve`) is stopped
- [ ] Readings buffered on the BBB during an InfluxDB outage are replayed on reconnect
- [ ] Grafana dashboard shows moisture history per plant and per device
- [ ] Grafana alert fires when moisture drops below a plant's threshold
- [ ] Device status (online/offline) is visible in Grafana
- [ ] BBB runs as a systemd service (issues #23 + #24 resolved as part of this phase)
- [ ] NTP is configured on the BBB
- [ ] Local CLI commands (`sensor status`, `sensor history`, `sensor avg`) continue to work
- [ ] All new config documented in `.env.example` and `README.md`
- [ ] Migration path to cloud services documented (env var changes only)

---

## Dependencies

- Issue #23: BBB log management (systemd) — folded into this phase
- Issue #24: BBB deployment (git pull) — folded into this phase
- Issue #25: This issue tracks the full Phase 4F implementation

## Cloud migration (future Phase 4F-cloud)

When ready to move off local Docker:
1. Sign up for EMQX Cloud (free tier) → update `MQTT_HOST`
2. Sign up for InfluxDB Cloud (free tier) → update `INFLUXDB_URL` + `INFLUXDB_TOKEN`
3. Sign up for Grafana Cloud (free tier) → export dashboards, update datasource
4. Update BBB `INFLUXDB_URL` to cloud endpoint
5. Remove InfluxDB + Grafana + Telegraf from `docker-compose.yml` (or keep for local dev)
