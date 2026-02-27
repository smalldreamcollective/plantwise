# PRD — Phase 4C: MQTT Architecture

## Status
Planned

## Goal
Replace the single-device HTTP POST model with a Mosquitto MQTT broker + subscriber architecture that supports multiple heterogeneous microcontrollers, remote control commands, and real-time updates — designed for a Sonos-style multi-room/multi-sensor deployment.

## Background
Multiple MCU types are in use: BeagleBone Black, Raspberry Pi Zero W, and IEIK (ESP32-based). MQTT's pub/sub model means adding a new device — regardless of type — requires zero server config changes. Each device just publishes to its topic with a consistent payload. Remote control (trigger a reading, future: actuate a pump) is handled by the server publishing to command topics. The broker is the only central coordination point.

```
BeagleBone Black (living room)  ──┐
Pi Zero W (bedroom)             ──┤──► Mosquitto broker ◄──► PlantWise subscriber ──► SQLite
IEIK ESP32 (greenhouse)         ──┘         │
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
| `plantwise/sensors/{device_id}/moisture` | MCU → Broker | `{ "plant_id": 1, "moisture_pct": 42 }` |
| `plantwise/commands/{device_id}/read` | Server → MCU | `{}` (request immediate reading) |
| `plantwise/status/{device_id}` | MCU → Broker | `"online"` / `"offline"` (LWT) |

`device_id` is a slug configured on each device (e.g. `living-room`, `bedroom`, `greenhouse`).

## PlantWise subscriber (`src/mqtt/subscriber.ts`)
- Connects to broker (host/port from env: `MQTT_HOST=localhost`, `MQTT_PORT=1883`)
- Subscribes to `plantwise/sensors/+/moisture` (wildcard — all devices)
- On message: validates payload, calls `logSensorReading(plantId, moisturePct, 'hardware')`
- On moisture below threshold: calls `notify()` if `MQTT_NOTIFY=true` env var is set
- Reconnects automatically on disconnect (mqtt package handles this)
- Device type is irrelevant to the subscriber — payload schema is the same regardless of MCU

## New CLI command: `plantwise serve`
- Starts the MQTT subscriber
- Logs connection status and incoming readings to stdout
- `npm run serve` script

## MCU publisher scripts (documented, not in this repo)

All three MCU types in use publish the same JSON payload to the same topic structure. Only the language/library differs.

### BeagleBone Black / Raspberry Pi Zero W — Python + paho-mqtt
Both run Linux; the same script works on either.

```python
# runs every 15 min via cron
# pip install paho-mqtt adafruit-circuitpython-seesaw
import paho.mqtt.client as mqtt, json, os, board, adafruit_seesaw.seesaw

DEVICE_ID = "living-room"  # unique slug per device
PLANT_ID = 1

sensor = adafruit_seesaw.seesaw.Seesaw(board.I2C())
moisture = sensor.moisture_read()

client = mqtt.Client()
client.username_pw_set("plantwise", os.environ["MQTT_PASSWORD"])
client.connect("homeserver.local", 1883)
client.publish(
    f"plantwise/sensors/{DEVICE_ID}/moisture",
    json.dumps({"plant_id": PLANT_ID, "moisture_pct": moisture})
)
client.disconnect()
```

### IEIK ESP32 — MicroPython + umqtt
```python
# main.py — runs on boot; reads sensor and publishes, then deep-sleeps 15 min
import ujson, os
from umqtt.simple import MQTTClient
from machine import Pin, I2C, deepsleep
# sensor library depends on hardware attached (e.g. capacitive moisture sensor on ADC pin)
from moisture_sensor import read_moisture  # project-specific helper

DEVICE_ID = b"greenhouse"
PLANT_ID = 1
BROKER = "homeserver.local"

client = MQTTClient(DEVICE_ID, BROKER, user=b"plantwise", password=os.getenv("MQTT_PASSWORD"))
client.connect()
client.publish(
    b"plantwise/sensors/" + DEVICE_ID + b"/moisture",
    ujson.dumps({"plant_id": PLANT_ID, "moisture_pct": read_moisture()})
)
client.disconnect()
deepsleep(15 * 60 * 1000)  # deep sleep 15 min to save power
```

### IEIK ESP32 — Arduino (C++) + PubSubClient
```cpp
// requires: PubSubClient, ArduinoJson libraries (install via Arduino Library Manager)
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

const char* DEVICE_ID   = "greenhouse";
const int   PLANT_ID    = 1;
const char* BROKER_HOST = "homeserver.local";
const int   BROKER_PORT = 1883;

WiFiClient   wifiClient;
PubSubClient mqtt(wifiClient);

void setup() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(500);

  mqtt.setServer(BROKER_HOST, BROKER_PORT);
  mqtt.connect(DEVICE_ID, "plantwise", MQTT_PASSWORD);

  int moisture = analogRead(MOISTURE_PIN) / 40;  // scale 0-4095 → 0-100

  StaticJsonDocument<64> doc;
  doc["plant_id"]    = PLANT_ID;
  doc["moisture_pct"] = moisture;

  char payload[64];
  serializeJson(doc, payload);

  char topic[64];
  snprintf(topic, sizeof(topic), "plantwise/sensors/%s/moisture", DEVICE_ID);
  mqtt.publish(topic, payload);
  mqtt.disconnect();

  esp_deep_sleep(15 * 60 * 1000000ULL);  // deep sleep 15 min
}

void loop() {}
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
