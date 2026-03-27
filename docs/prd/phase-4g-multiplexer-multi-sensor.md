# Phase 4G — PCA9548A Multiplexer / Multi-Sensor Support

## Problem
The Adafruit Seesaw soil sensor uses a fixed I2C address (0x36), so only one sensor can be connected to an I2C bus at a time. To support multiple plants per device, we need an I2C multiplexer.

## Solution
Use the PCA9548A 8-channel I2C multiplexer (compatible with TCA9548A) at address 0x70. Before reading each sensor, select its channel on the mux. Each sensor is identified by a human-readable name configured via environment variables.

## Hardware
- PCA9548A multiplexer (addr 0x70) wired to BBB I2C bus 2
- Up to 3 Adafruit Seesaw soil sensors, each on a separate mux channel
- Sensors wired to mux channels 0, 1, 2

## Configuration (`.plantwise.env`)
```
CH0_NAME=monstera
CH1_NAME=pothos
CH2_NAME=snake-plant
```

Channels with no name set are skipped. A device with a single sensor and no mux still works (see Backwards Compatibility).

## MQTT Topics
Each sensor publishes to its own topic:
```
plantwise/sensors/<device_id>/<sensor_id>/moisture
```

Payload:
```json
{"device_id": "living-room", "sensor_id": "monstera", "moisture_pct": 42}
```

## Subscriber Changes
- MQTT topic pattern updated from `plantwise/sensors/+/moisture` to `plantwise/sensors/+/+/moisture`
- `handleMessage` extracts `sensor_id` from topic segments
- `device_id` comes from payload (unchanged)
- `sensor_id` used for display/logging; plant lookup still via `device_id` → `plant_id` assignment

## Backwards Compatibility
- Single-sensor devices (no mux) are not supported going forward — all devices should use the mux
- The old topic format (`plantwise/sensors/<device_id>/moisture`) is deprecated

## BBB Code Changes (`main.py`)
1. On startup, detect if PCA9548A is present at 0x70
2. If mux detected: iterate over configured channels (CH0_NAME … CH7_NAME), select channel, read sensor
3. Publish each reading to `plantwise/sensors/<device_id>/<sensor_id>/moisture`
4. Buffer each reading individually with `sensor_id`

## Out of Scope
- Dynamic channel discovery (scan all 8 channels) — use explicit env var config only
- Web UI for channel/sensor mapping
- More than 8 sensors per device
