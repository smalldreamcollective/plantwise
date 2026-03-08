"""
PlantWise — BeagleBone Black moisture publisher
Reads the Seesaw I2C soil moisture sensor and publishes to the MQTT broker.

Requirements (pip install):
  smbus2 paho-mqtt

Cron (every 15 min):
  */15 * * * * python3 /path/to/moisture_publisher.py >> /tmp/plantwise-sensor.log 2>&1
"""

import json
import os
import sys
import time

import paho.mqtt.client as mqtt
import smbus2

# ── Configuration ──────────────────────────────────────────────────────────────

DEVICE_ID = "living-room"   # unique slug for this device (used in MQTT topic)
PLANT_ID  = 1               # plantwise DB plant ID this sensor monitors

BROKER_HOST = os.environ.get("MQTT_HOST", "192.168.1.x")  # Mac's LAN IP
BROKER_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_USERNAME = os.environ.get("MQTT_USERNAME", "")
MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD", "")

# I2C bus and Seesaw address
I2C_BUS  = 2
I2C_ADDR = 0x36

# Seesaw raw moisture calibration.
# Measure your sensor in dry air and fully saturated soil to tune these.
# Typical Seesaw values: ~200 (bone dry) → ~1800 (fully saturated)
MOISTURE_DRY = 200
MOISTURE_WET = 1800

# ── Sensor reading ─────────────────────────────────────────────────────────────

def scale_moisture(raw: int) -> int:
    """Convert raw Seesaw moisture to 0–100%."""
    pct = (raw - MOISTURE_DRY) / (MOISTURE_WET - MOISTURE_DRY) * 100
    return max(0, min(100, round(pct)))

def read_moisture(bus: smbus2.SMBus) -> int:
    bus.write_byte_data(I2C_ADDR, 0x0F, 0x10)
    time.sleep(0.1)
    data = bus.read_i2c_block_data(I2C_ADDR, 0x00, 2)
    raw = (data[0] << 8) | data[1]
    return scale_moisture(raw)

def read_temp_f(bus: smbus2.SMBus) -> float:
    bus.write_byte_data(I2C_ADDR, 0x00, 0x04)
    time.sleep(0.1)
    data = bus.read_i2c_block_data(I2C_ADDR, 0x00, 4)
    raw = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]
    celsius = raw * (1.0 / (1 << 16))
    return (celsius * 9 / 5) + 32

# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    bus = smbus2.SMBus(I2C_BUS)
    try:
        moisture_pct = read_moisture(bus)
        temp_f = read_temp_f(bus)
    except Exception as e:
        print(f"[sensor] read error: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        bus.close()

    payload = json.dumps({"plant_id": PLANT_ID, "moisture_pct": moisture_pct})
    topic = f"plantwise/sensors/{DEVICE_ID}/moisture"

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    if MQTT_USERNAME:
        client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)

    try:
        client.connect(BROKER_HOST, BROKER_PORT, keepalive=10)
        client.publish(topic, payload)
        client.disconnect()
    except Exception as e:
        print(f"[mqtt] publish error: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"[ok] plant_id={PLANT_ID} moisture={moisture_pct}% temp={temp_f:.1f}F → {topic}")

if __name__ == "__main__":
    main()
