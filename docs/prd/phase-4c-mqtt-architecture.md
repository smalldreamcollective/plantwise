# PRD — Phase 4C: MQTT Architecture

## Status
Planned

## Goal
Replace the single-Pi HTTP POST model with a Mosquitto MQTT broker + subscriber architecture that supports multiple Pi devices, remote control commands, and real-time updates — designed for a Sonos-style multi-room/multi-sensor deployment.

## Background
Multiple Pi controllers are planned. MQTT's pub/sub model means adding a new device requires zero server config changes — it just publishes to the right topic. Remote control (trigger a reading, future: actuate a pump) is handled by the server publishing to command topics. The broker is the only central coordination point.

```
Pi 1 (living room)  ──┐
Pi 2 (bedroom)      ──┤──► Mosquitto broker ◄──► PlantWise subscriber ──► SQLite
Pi 3 (greenhouse)   ──┘         │
                                 └──► Web UI (MQTT over WebSocket, Phase 4D)
                                 └──► Remote admin / commands
```

## New dependency
- `mqtt` (Node.js MQTT client — ships with its own types, no `@types` package needed)

## Broker setup (macOS)
```bash
brew install mosquitto
brew services start mosquitto
```
Default config at `/opt/homebrew/etc/mosquitto/mosquitto.conf`. For local dev, no auth required. For production, configure username/password or TLS (documented below).

## Topic design

| Topic | Direction | Payload |
|-------|-----------|---------|
| `plantwise/sensors/{device_id}/moisture` | Pi → Broker | `{ "plant_id": 1, "moisture_pct": 42 }` |
| `plantwise/commands/{device_id}/read` | Server → Pi | `{}` (request immediate reading) |
| `plantwise/status/{device_id}` | Pi → Broker | `"online"` / `"offline"` (LWT) |

`device_id` is a slug configured on each Pi (e.g. `living-room`, `bedroom`).

## PlantWise subscriber (`src/mqtt/subscriber.ts`)
- Connects to broker (host/port from env: `MQTT_HOST=localhost`, `MQTT_PORT=1883`)
- Subscribes to `plantwise/sensors/+/moisture` (wildcard — all devices)
- On message: validates payload, calls `logSensorReading(plantId, moisturePct, 'hardware')`
- On moisture below threshold: calls `notify()` if `MQTT_NOTIFY=true` env var is set
- Reconnects automatically on disconnect (mqtt package handles this)

## New CLI command: `plantwise serve`
- Starts the MQTT subscriber
- Logs connection status and incoming readings to stdout
- `npm run serve` script

## Pi publisher script (documented, not in this repo)
```python
# runs on the Pi every 15 min via cron
import paho.mqtt.client as mqtt, json, os, board, adafruit_seesaw.seesaw

sensor = adafruit_seesaw.seesaw.Seesaw(board.I2C())
client = mqtt.Client()
client.username_pw_set("plantwise", os.environ["MQTT_PASSWORD"])
client.connect("homeserver.local", 1883)
client.publish(
  "plantwise/sensors/living-room/moisture",
  json.dumps({"plant_id": 1, "moisture_pct": sensor.moisture_read()})
)
```

## Auth
- **Local dev:** no auth (Mosquitto default)
- **Production:** username + password in `mosquitto.conf`; credentials in `.env` (`MQTT_USERNAME`, `MQTT_PASSWORD`)
- **TLS:** optional, documented for users exposing broker outside LAN (not implemented in this phase)

## Environment variables to add to `.env.example`
```
MQTT_HOST=localhost
MQTT_PORT=1883
MQTT_USERNAME=
MQTT_PASSWORD=
MQTT_NOTIFY=false
```

## Out of scope for this phase
- HTTP API (moved to Phase 4D alongside web UI)
- MQTT over WebSocket (Phase 4D)
- Pump/actuator control (future)
- TLS setup (documented but not implemented)

## Success criteria
- `npm run serve` connects to local Mosquitto and logs "Connected"
- Publishing a test message to `plantwise/sensors/test-pi/moisture` → reading stored in DB
- `npm run sensor -- status` reflects the new reading
- Invalid payloads (missing `plant_id`, out-of-range moisture) logged and skipped, never crash
- All existing 53 tests still pass
- New tests for subscriber message handler (broker mocked)
