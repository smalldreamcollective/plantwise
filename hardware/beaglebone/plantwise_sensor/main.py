"""
PlantWise — BeagleBone Black moisture publisher (systemd service)

Runs as a long-running daemon. On each interval:
  1. Reads each configured Seesaw I2C soil moisture sensor via PCA9548A mux
  2. Writes to a local SQLite store-and-forward buffer (durable across restarts)
  3. Flushes all pending buffer rows to InfluxDB (with retry on reconnect)
  4. Publishes each reading to MQTT broker (QoS 1)

Channel → sensor name mappings are managed from the Mac via:
  plantwise channel map <device-id> <channel> <sensor-name>

The Mac publishes config to plantwise/devices/<device-id>/config (retained).
The BBB subscribes on startup, stores mappings in ~/.plantwise_channels.json,
and hot-reloads the sensor list immediately when a new config arrives.

Fallback: if no MQTT config received, CH0_NAME…CH7_NAME env vars are used.

Topic format: plantwise/sensors/<device_id>/<sensor_id>/moisture
Payload:      {"device_id": "living-room", "sensor_id": "monstera", "moisture_pct": 42}

Publishes device status (online/offline) to `plantwise/devices/<id>/status`.
Clean shutdown on SIGTERM publishes offline status before exit.

systemd service: hardware/beaglebone/plantwise-sensor.service
"""

import json
import logging
import os
import signal
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import paho.mqtt.client as mqtt
import smbus2
from influxdb_client import InfluxDBClient, Point, WritePrecision  # type: ignore[import]
from influxdb_client.client.write_api import SYNCHRONOUS  # type: ignore[import]

# ── Configuration ──────────────────────────────────────────────────────────────

DEVICE_ID   = os.environ.get("DEVICE_ID", "living-room")
INTERVAL_S  = int(os.environ.get("SENSOR_INTERVAL_S", "900"))

BROKER_HOST    = os.environ.get("MQTT_HOST", "192.168.1.x")
BROKER_PORT    = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_USERNAME  = os.environ.get("MQTT_USERNAME", "")
MQTT_PASSWORD  = os.environ.get("MQTT_PASSWORD", "")

INFLUXDB_URL    = os.environ.get("INFLUXDB_URL", "http://192.168.1.x:8086")
INFLUXDB_TOKEN  = os.environ.get("INFLUXDB_TOKEN", "plantwise-dev-token")
INFLUXDB_ORG    = os.environ.get("INFLUXDB_ORG", "plantwise")
INFLUXDB_BUCKET = os.environ.get("INFLUXDB_BUCKET", "sensors")

BUFFER_DB      = os.environ.get("BUFFER_DB_PATH", "/home/debian/.plantwise_buffer.db")
CHANNELS_FILE  = Path(os.environ.get("CHANNELS_FILE", "/home/debian/.plantwise_channels.json"))

CONFIG_TOPIC = f"plantwise/devices/{DEVICE_ID}/config"
STATUS_TOPIC = f"plantwise/devices/{DEVICE_ID}/status"

# I2C bus and addresses
I2C_BUS  = 2
I2C_ADDR = 0x36   # Seesaw soil sensor
MUX_ADDR = 0x70   # PCA9548A multiplexer

MOISTURE_DRY = 200
MOISTURE_WET = 1800

# ── Logging ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("plantwise")

# ── Sensor list (hot-reloadable) ───────────────────────────────────────────────

_sensors_lock = threading.Lock()
_sensors: list[tuple[int, str]] = []  # (channel, sensor_id)


def _build_sensors_from_env() -> list[tuple[int, str]]:
    return [
        (ch, name)
        for ch in range(8)
        if (name := os.environ.get(f"CH{ch}_NAME", "").strip())
    ]


def _build_sensors_from_config(config: dict) -> list[tuple[int, str]]:
    channels = config.get("channels", {})
    return sorted(
        [(int(ch), name) for ch, name in channels.items() if name],
        key=lambda x: x[0],
    )


def load_sensors() -> None:
    """Load sensor list from local config file, falling back to env vars."""
    global _sensors
    if CHANNELS_FILE.exists():
        try:
            config = json.loads(CHANNELS_FILE.read_text())
            sensors = _build_sensors_from_config(config)
            if sensors:
                with _sensors_lock:
                    _sensors = sensors
                log.info("Loaded channel config from %s: %s", CHANNELS_FILE, [s for _, s in sensors])
                return
        except Exception as e:
            log.warning("Failed to read %s: %s — falling back to env vars", CHANNELS_FILE, e)
    sensors = _build_sensors_from_env()
    with _sensors_lock:
        _sensors = sensors
    log.info("Using env var channel config: %s", [s for _, s in sensors])


def get_sensors() -> list[tuple[int, str]]:
    with _sensors_lock:
        return list(_sensors)


def apply_channel_config(config: dict) -> None:
    """Save and apply a new channel config received via MQTT."""
    global _sensors
    try:
        CHANNELS_FILE.write_text(json.dumps(config))
        sensors = _build_sensors_from_config(config)
        with _sensors_lock:
            _sensors = sensors
        log.info("Channel config updated: %s", [s for _, s in sensors])
    except Exception as e:
        log.warning("Failed to apply channel config: %s", e)

# ── Sensor reading ─────────────────────────────────────────────────────────────

def select_mux_channel(bus: smbus2.SMBus, channel: int) -> None:
    bus.write_byte(MUX_ADDR, 1 << channel)
    time.sleep(0.01)


def scale_moisture(raw: int) -> int:
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
            sensor_id    TEXT NOT NULL DEFAULT '',
            moisture_pct INTEGER NOT NULL,
            recorded_at  TEXT NOT NULL,
            published    INTEGER NOT NULL DEFAULT 0
        )
    """)
    cols = [row[1] for row in conn.execute("PRAGMA table_info(pending_readings)").fetchall()]

    if "plant_id" in cols:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS pending_readings_new (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id    TEXT NOT NULL,
                sensor_id    TEXT NOT NULL DEFAULT '',
                moisture_pct INTEGER NOT NULL,
                recorded_at  TEXT NOT NULL,
                published    INTEGER NOT NULL DEFAULT 0
            )
        """)
        device_id_col = "device_id" if "device_id" in cols else f"'{DEVICE_ID}'"
        conn.execute(f"""
            INSERT INTO pending_readings_new (id, device_id, moisture_pct, recorded_at, published)
            SELECT id, {device_id_col}, moisture_pct, recorded_at, published
            FROM pending_readings
        """)
        conn.execute("DROP TABLE pending_readings")
        conn.execute("ALTER TABLE pending_readings_new RENAME TO pending_readings")
        conn.commit()
        cols = [row[1] for row in conn.execute("PRAGMA table_info(pending_readings)").fetchall()]

    if "sensor_id" not in cols:
        conn.execute(f"ALTER TABLE pending_readings ADD COLUMN sensor_id TEXT NOT NULL DEFAULT '{DEVICE_ID}'")
        conn.commit()

    return conn


def buffer_reading(conn: sqlite3.Connection, moisture_pct: int,
                   device_id: str, sensor_id: str, recorded_at: str) -> int:
    cur = conn.execute(
        "INSERT INTO pending_readings (device_id, sensor_id, moisture_pct, recorded_at) "
        "VALUES (?, ?, ?, ?)",
        (device_id, sensor_id, moisture_pct, recorded_at),
    )
    conn.commit()
    return cur.lastrowid


def flush_buffer_to_influx(conn: sqlite3.Connection) -> int:
    rows = conn.execute(
        "SELECT id, device_id, sensor_id, moisture_pct, recorded_at "
        "FROM pending_readings WHERE published = 0 ORDER BY id ASC"
    ).fetchall()

    if not rows:
        return 0

    try:
        influx = InfluxDBClient(url=INFLUXDB_URL, token=INFLUXDB_TOKEN, org=INFLUXDB_ORG)
        write_api = influx.write_api(write_options=SYNCHRONOUS)
        points = []
        for _, device_id, sensor_id, moisture_pct, recorded_at in rows:
            point = (
                Point("moisture")
                .tag("device_id", device_id)
                .tag("sensor_id", sensor_id)
                .field("moisture_pct", moisture_pct)
                .time(recorded_at, WritePrecision.S)
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

# ── MQTT (persistent connection) ───────────────────────────────────────────────

_mqtt_client: mqtt.Client | None = None
_mqtt_connected = threading.Event()


def _on_connect(client: mqtt.Client, _userdata, _flags, _rc, _props=None) -> None:
    _mqtt_connected.set()
    client.subscribe(CONFIG_TOPIC, qos=1)
    log.info("MQTT connected — subscribed to %s", CONFIG_TOPIC)


def _on_disconnect(_client, _userdata, _rc, _props=None) -> None:
    _mqtt_connected.clear()
    log.warning("MQTT disconnected")


def _on_message(_client, _userdata, msg: mqtt.MQTTMessage) -> None:
    if msg.topic == CONFIG_TOPIC:
        try:
            config = json.loads(msg.payload.decode())
            apply_channel_config(config)
        except Exception as e:
            log.warning("Invalid config payload on %s: %s", CONFIG_TOPIC, e)


def get_mqtt_client() -> mqtt.Client:
    global _mqtt_client
    if _mqtt_client is None:
        _mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        if MQTT_USERNAME:
            _mqtt_client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
        _mqtt_client.on_connect = _on_connect
        _mqtt_client.on_disconnect = _on_disconnect
        _mqtt_client.on_message = _on_message
        _mqtt_client.reconnect_delay_set(min_delay=5, max_delay=60)
        _mqtt_client.connect_async(BROKER_HOST, BROKER_PORT, keepalive=60)
        _mqtt_client.loop_start()
    return _mqtt_client


def publish_status(status: str) -> None:
    client = get_mqtt_client()
    payload = json.dumps({"status": status, "device": DEVICE_ID})
    client.publish(STATUS_TOPIC, payload, qos=1, retain=True)
    log.info("status → %s (%s)", STATUS_TOPIC, status)


def publish_reading(moisture_pct: int, sensor_id: str) -> None:
    topic = f"plantwise/sensors/{DEVICE_ID}/{sensor_id}/moisture"
    payload = json.dumps({"device_id": DEVICE_ID, "sensor_id": sensor_id, "moisture_pct": moisture_pct})
    client = get_mqtt_client()
    client.publish(topic, payload, qos=1)
    log.info("published → %s moisture=%d%%", topic, moisture_pct)

# ── Main loop ──────────────────────────────────────────────────────────────────

_running = True


def _handle_sigterm(*_):
    global _running
    log.info("SIGTERM received — shutting down")
    _running = False


def main() -> None:
    signal.signal(signal.SIGTERM, _handle_sigterm)
    signal.signal(signal.SIGINT, _handle_sigterm)

    load_sensors()

    sensors = get_sensors()
    if not sensors:
        log.error("No sensors configured — set CH0_NAME etc. in .plantwise.env or run: plantwise channel map %s <channel> <name>", DEVICE_ID)
        return

    log.info("PlantWise sensor publisher starting (device=%s sensors=%s interval=%ds)",
             DEVICE_ID, [s for _, s in sensors], INTERVAL_S)

    conn = init_buffer(BUFFER_DB)

    # Start persistent MQTT connection; wait up to 10s for initial connect
    get_mqtt_client()
    _mqtt_connected.wait(timeout=10)
    publish_status("online")

    while _running:
        sensors = get_sensors()
        try:
            bus = smbus2.SMBus(I2C_BUS)
            try:
                for channel, sensor_id in sensors:
                    select_mux_channel(bus, channel)
                    moisture_pct = read_moisture(bus)
                    temp_f = read_temp_f(bus)

                    recorded_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                    buffer_reading(conn, moisture_pct, DEVICE_ID, sensor_id, recorded_at)
                    log.info("buffered device=%s sensor=%s moisture=%d%% temp=%.1fF",
                             DEVICE_ID, sensor_id, moisture_pct, temp_f)

                    publish_reading(moisture_pct, sensor_id)
            finally:
                bus.close()

            flushed = flush_buffer_to_influx(conn)
            if flushed:
                log.info("flushed %d reading(s) to InfluxDB", flushed)

        except Exception as e:
            log.error("sensor read error: %s", e)

        for _ in range(INTERVAL_S):
            if not _running:
                break
            time.sleep(1)

    publish_status("offline")
    time.sleep(1)  # allow offline status to be sent before disconnect
    if _mqtt_client:
        _mqtt_client.loop_stop()
        _mqtt_client.disconnect()
    conn.close()
    log.info("shutdown complete")


if __name__ == "__main__":
    main()
