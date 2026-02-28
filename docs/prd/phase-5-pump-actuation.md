# PRD — Phase 5: Pump Actuation

## Status
Planned

## Goal
Add automated and manual plant watering via a relay-switched DC pump, controlled over MQTT. Moisture readings from Phase 4C trigger watering automatically when below threshold; manual override is available via CLI and future web UI.

## Hardware

### Pump
**Adafruit Submersible 3V DC Water Pump — Horizontal Type [ID:4546]**
- Operating voltage: 2.5–6V DC (nominal 3V)
- Current draw: ~100–200mA (too high for direct MCU GPIO — must use a transistor or MOSFET)
- Flow rate: ~80 L/hr at 3V

### Control circuit (per MCU)
The pump must not be driven directly from a GPIO pin. Use one of:

**Option A — NPN transistor (e.g. 2N2222 / BC547):**
```
MCU GPIO ──[1kΩ]──► Base
                    Collector ──► Pump (–)
                    Emitter  ──► GND
Pump (+) ──► 3V supply
[flyback diode across pump terminals, cathode to +]
```

**Option B — N-channel MOSFET (e.g. 2N7000 / IRLB8721):**
Same topology, gate instead of base, no base resistor needed for logic-level FETs.

Both options work on BeagleBone Black, Pi Zero W, and IEIK ESP32 (all 3.3V GPIO).

---

## Architecture

```
Moisture reading below threshold
         │
         ▼
PlantWise subscriber (src/mqtt/subscriber.ts)
         │  publishes
         ▼
plantwise/commands/{device_id}/water  { "duration_ms": 5000 }
         │
         ▼
MCU — energises pump GPIO for duration_ms, then publishes result
         │
         ▼
plantwise/status/{device_id}/pump  { "action": "water", "duration_ms": 5000, "ok": true }
         │
         ▼
PlantWise subscriber — logs care_event (type: "water", source: "auto")
```

---

## MQTT topic additions

| Topic | Direction | Payload |
|-------|-----------|---------|
| `plantwise/commands/{device_id}/water` | Server → MCU | `{ "duration_ms": 5000 }` |
| `plantwise/status/{device_id}/pump` | MCU → Server | `{ "action": "water", "duration_ms": 5000, "ok": true }` |

`duration_ms` is how long to run the pump. The server decides the duration based on plant size / pot volume (configurable per plant, stored in DB).

---

## Trigger modes

### Automatic (moisture threshold)
- When a moisture reading arrives below a plant's `water_threshold_pct` (stored in `plants` table, default: 30)
- Subscriber publishes water command to the plant's assigned device
- Waits for pump status confirmation before logging the care event
- Minimum interval between auto-waterings: 1 hour (prevents re-triggering on slow sensor response)

### Manual (CLI)
New command: `plantwise water <plant-id> [--duration <ms>]`
- Publishes water command directly, default duration 5000ms
- Waits up to 10s for pump status confirmation, logs result

---

## Safety limits
- **Max single-run duration:** 30 seconds (hard cap enforced on MCU, not just server)
- **Min interval between waterings:** 1 hour per plant (enforced in subscriber before publishing command)
- **No water confirmation:** if moisture doesn't increase after watering (checked on next sensor read), log a warning — may indicate pump dry-run, empty reservoir, or blocked tubing
- **Pump GPIO watchdog:** MCU cuts power after `duration_ms + 500ms` even if MQTT connection drops mid-command

---

## DB changes
- Add `water_threshold_pct INTEGER DEFAULT 30` to `plants` table
- Add `pump_duration_ms INTEGER DEFAULT 5000` to `plants` table
- `care_events` source column gains new value: `"auto"` (vs existing `"manual"`)

---

## New files
- `src/mqtt/pump-controller.ts` — publishes water commands, listens for pump status, enforces safety limits, logs care events

---

## MCU pump handler examples (documented, not in this repo)

### BeagleBone Black / Pi Zero W — Python
```python
import paho.mqtt.client as mqtt, json, os, time
import RPi.GPIO as GPIO  # or Adafruit_BBIO.GPIO for BeagleBone

PUMP_PIN  = 18
DEVICE_ID = "living-room"

GPIO.setmode(GPIO.BCM)
GPIO.setup(PUMP_PIN, GPIO.OUT, initial=GPIO.LOW)

def on_message(client, userdata, msg):
    if msg.topic == f"plantwise/commands/{DEVICE_ID}/water":
        payload = json.loads(msg.payload)
        duration_s = min(payload.get("duration_ms", 5000), 30000) / 1000  # cap at 30s
        GPIO.output(PUMP_PIN, GPIO.HIGH)
        time.sleep(duration_s)
        GPIO.output(PUMP_PIN, GPIO.LOW)
        client.publish(
            f"plantwise/status/{DEVICE_ID}/pump",
            json.dumps({"action": "water", "duration_ms": int(duration_s * 1000), "ok": True})
        )

client = mqtt.Client()
client.on_message = on_message
client.username_pw_set("plantwise", os.environ["MQTT_PASSWORD"])
client.connect("homeserver.local", 1883)
client.subscribe(f"plantwise/commands/{DEVICE_ID}/water")
client.loop_forever()
```

### IEIK ESP32 — MicroPython
```python
from umqtt.simple import MQTTClient
from machine import Pin
import ujson, os, time

PUMP_PIN  = Pin(18, Pin.OUT, value=0)
DEVICE_ID = b"greenhouse"
MAX_MS    = 30000

def on_message(topic, payload):
    data     = ujson.loads(payload)
    duration = min(data.get("duration_ms", 5000), MAX_MS)
    PUMP_PIN.on()
    time.sleep_ms(duration)
    PUMP_PIN.off()
    client.publish(
        b"plantwise/status/" + DEVICE_ID + b"/pump",
        ujson.dumps({"action": "water", "duration_ms": duration, "ok": True})
    )

client = MQTTClient(DEVICE_ID, "homeserver.local",
                    user=b"plantwise", password=os.getenv("MQTT_PASSWORD"))
client.set_callback(on_message)
client.connect()
client.subscribe(b"plantwise/commands/" + DEVICE_ID + b"/water")
while True:
    client.wait_msg()
```

---

## Environment variables (additions to `.env.example`)
```
PUMP_DEFAULT_DURATION_MS=5000
PUMP_MAX_DURATION_MS=30000
PUMP_MIN_INTERVAL_MINUTES=60
```

## Out of scope for this phase
- Multi-zone / multi-pump per device
- Reservoir level sensing
- Fertiliser dosing
- Scheduled watering (time-based, not moisture-based)

## Success criteria
- `plantwise water 1` publishes command and logs care event on confirmation
- Auto-watering triggers when moisture reading falls below `water_threshold_pct`
- Pump command is never re-sent within the 1-hour minimum interval
- MCU cuts pump power at hard cap regardless of server state
- Invalid/missing pump status response is logged as a warning, not a crash
- All existing tests still pass
- New tests: manual water command, auto-threshold trigger, safety limit enforcement, min-interval guard
