"""
PlantWise — BeagleBone Black moisture publisher (systemd service)

Runs as a long-running daemon. On each interval:
  1. Reads the Seesaw I2C soil moisture sensor
  2. Writes to a local SQLite store-and-forward buffer (durable across restarts)
  3. Flushes all pending buffer rows to InfluxDB (with retry on reconnect)
  4. Publishes to MQTT broker (QoS 1)

Publishes device status (online/offline) to `plantwise/devices/<id>/status`.
Clean shutdown on SIGTERM publishes offline status before exit.

Install:
  pip install "git+https://github.com/smalldreamcollective/plantwise.git#subdirectory=hardware/beaglebone"

Update:
  pip install --upgrade "git+https://..."
  sudo systemctl restart plantwise-sensor

systemd service: hardware/beaglebone/plantwise-sensor.service
"""

import json
import logging
import os
import signal
import sqlite3
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
import smbus2
# influxdb-client installed on BBB: pip install influxdb-client
from influxdb_client import InfluxDBClient, Point, WritePrecision  # type: ignore[import]
from influxdb_client.client.write_api import SYNCHRONOUS  # type: ignore[import]

# ── Configuration ──────────────────────────────────────────────────────────────

DEVICE_ID   = os.environ.get("DEVICE_ID", "living-room")
INTERVAL_S  = int(os.environ.get("SENSOR_INTERVAL_S", "900"))  # 15 min default

BROKER_HOST    = os.environ.get("MQTT_HOST", "192.168.1.x")
BROKER_PORT    = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_USERNAME  = os.environ.get("MQTT_USERNAME", "")
MQTT_PASSWORD  = os.environ.get("MQTT_PASSWORD", "")

INFLUXDB_URL    = os.environ.get("INFLUXDB_URL", "http://192.168.1.x:8086")
INFLUXDB_TOKEN  = os.environ.get("INFLUXDB_TOKEN", "plantwise-dev-token")
INFLUXDB_ORG    = os.environ.get("INFLUXDB_ORG", "plantwise")
INFLUXDB_BUCKET = os.environ.get("INFLUXDB_BUCKET", "sensors")

BUFFER_DB = os.environ.get("BUFFER_DB_PATH", "/home/debian/.plantwise_buffer.db")

# I2C bus and Seesaw address
I2C_BUS  = 2
I2C_ADDR = 0x36

# Seesaw raw moisture calibration (tune for your sensor).
# Typical values: ~200 (bone dry) → ~1800 (fully saturated).
MOISTURE_DRY = 200
MOISTURE_WET = 1800

# ── Logging ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("plantwise")

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

# ── Store-and-forward buffer ────────────────────────────────────────────────────

def init_buffer(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS pending_readings (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id    TEXT NOT NULL,
            moisture_pct INTEGER NOT NULL,
            recorded_at  TEXT NOT NULL,
            published    INTEGER NOT NULL DEFAULT 0
        )
    """)
    # Migrate old schema (plant_id column) to new (device_id column)
    try:
        conn.execute("ALTER TABLE pending_readings ADD COLUMN device_id TEXT NOT NULL DEFAULT ''")
        conn.execute(f"UPDATE pending_readings SET device_id = '{DEVICE_ID}' WHERE device_id = ''")
        conn.commit()
    except Exception:
        pass  # Column already exists
    conn.commit()
    return conn


def buffer_reading(conn: sqlite3.Connection, moisture_pct: int,
                   device_id: str, recorded_at: str) -> int:
    cur = conn.execute(
        "INSERT INTO pending_readings (device_id, moisture_pct, recorded_at) "
        "VALUES (?, ?, ?)",
        (device_id, moisture_pct, recorded_at),
    )
    conn.commit()
    return cur.lastrowid


def flush_buffer_to_influx(conn: sqlite3.Connection) -> int:
    """Write all pending rows to InfluxDB. Returns number of rows flushed."""
    rows = conn.execute(
        "SELECT id, device_id, moisture_pct, recorded_at "
        "FROM pending_readings WHERE published = 0 ORDER BY id ASC"
    ).fetchall()

    if not rows:
        return 0

    try:
        influx = InfluxDBClient(url=INFLUXDB_URL, token=INFLUXDB_TOKEN, org=INFLUXDB_ORG)
        write_api = influx.write_api(write_options=SYNCHRONOUS)
        points = []
        for _, device_id, moisture_pct, recorded_at in rows:
            point = (
                Point("moisture")
                .tag("device_id", device_id)
                .field("moisture_pct", moisture_pct)
                .time(recorded_at, WritePrecision.SECONDS)
            )
            points.append(point)

        write_api.write(bucket=INFLUXDB_BUCKET, org=INFLUXDB_ORG, record=points)
        influx.close()

        ids = [str(r[0]) for r in rows]
        conn.execute(f"UPDATE pending_readings SET published = 1 WHERE id IN ({','.join(ids)})")
        conn.commit()
        return len(rows)

    except Exception as e:
        log.warning("InfluxDB flush failed (will retry): %s", e)
        return 0

# ── MQTT helpers ───────────────────────────────────────────────────────────────

_mqtt_client: mqtt.Client | None = None


def get_mqtt_client() -> mqtt.Client:
    global _mqtt_client
    if _mqtt_client is None:
        _mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        if MQTT_USERNAME:
            _mqtt_client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
    return _mqtt_client


def publish_status(status: str) -> None:
    topic = f"plantwise/devices/{DEVICE_ID}/status"
    payload = json.dumps({"status": status, "device": DEVICE_ID})
    try:
        client = get_mqtt_client()
        client.connect(BROKER_HOST, BROKER_PORT, keepalive=10)
        client.publish(topic, payload, qos=1, retain=True)
        client.disconnect()
        log.info("status → %s (%s)", topic, status)
    except Exception as e:
        log.warning("MQTT status publish failed: %s", e)


def publish_reading(moisture_pct: int) -> None:
    topic = f"plantwise/sensors/{DEVICE_ID}/moisture"
    payload = json.dumps({"device_id": DEVICE_ID, "moisture_pct": moisture_pct})
    try:
        client = get_mqtt_client()
        client.connect(BROKER_HOST, BROKER_PORT, keepalive=10)
        client.publish(topic, payload, qos=1)
        client.disconnect()
        log.info("published → %s moisture=%d%%", topic, moisture_pct)
    except Exception as e:
        log.warning("MQTT publish failed (reading still buffered): %s", e)

# ── Main loop ──────────────────────────────────────────────────────────────────

_running = True


def _handle_sigterm(*_):
    global _running
    log.info("SIGTERM received — shutting down")
    _running = False


def main() -> None:
    signal.signal(signal.SIGTERM, _handle_sigterm)
    signal.signal(signal.SIGINT, _handle_sigterm)

    log.info("PlantWise sensor publisher starting (device=%s interval=%ds)",
             DEVICE_ID, INTERVAL_S)

    conn = init_buffer(BUFFER_DB)
    publish_status("online")

    while _running:
        try:
            bus = smbus2.SMBus(I2C_BUS)
            try:
                moisture_pct = read_moisture(bus)
                temp_f = read_temp_f(bus)
            finally:
                bus.close()

            recorded_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            buffer_reading(conn, moisture_pct, DEVICE_ID, recorded_at)
            log.info("buffered device=%s moisture=%d%% temp=%.1fF",
                     DEVICE_ID, moisture_pct, temp_f)

            flushed = flush_buffer_to_influx(conn)
            if flushed:
                log.info("flushed %d reading(s) to InfluxDB", flushed)

            publish_reading(moisture_pct)

        except Exception as e:
            log.error("sensor read error: %s", e)

        # Sleep in short increments so SIGTERM is handled promptly
        for _ in range(INTERVAL_S):
            if not _running:
                break
            time.sleep(1)

    publish_status("offline")
    conn.close()
    log.info("shutdown complete")


if __name__ == "__main__":
    main()
