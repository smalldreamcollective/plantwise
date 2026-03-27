import mqtt from 'mqtt';
import { getDevice, getPlant, logSensorReading } from '../db/queries';
import { notify } from '../utils/notify';

const MQTT_HOST = process.env['MQTT_HOST'] ?? 'localhost';
const MQTT_PORT = parseInt(process.env['MQTT_PORT'] ?? '1883', 10);
const MQTT_USERNAME = process.env['MQTT_USERNAME'] ?? '';
const MQTT_PASSWORD = process.env['MQTT_PASSWORD'] ?? '';

const TOPIC = 'plantwise/sensors/+/+/moisture';

interface MoisturePayload {
  device_id: unknown;
  sensor_id: unknown;
  moisture_pct: unknown;
}

function parsePayload(raw: string): MoisturePayload | null {
  try {
    return JSON.parse(raw) as MoisturePayload;
  } catch {
    return null;
  }
}

export function handleMessage(topic: string, message: Buffer): void {
  const raw = message.toString();
  const payload = parsePayload(raw);

  if (!payload) {
    console.error(`[mqtt] invalid JSON on ${topic}: ${raw}`);
    return;
  }

  // Topic format: plantwise/sensors/<device_id>/<sensor_id>/moisture (5 segments)
  const segments = topic.split('/');
  const sensorId = segments.length === 5 ? segments[3] : undefined;

  if (!sensorId) {
    console.error(
      `[mqtt] malformed topic (expected plantwise/sensors/<device_id>/<sensor_id>/moisture): ${topic}`
    );
    return;
  }

  const moisturePct = payload.moisture_pct;

  if (
    typeof moisturePct !== 'number' ||
    !Number.isInteger(moisturePct) ||
    moisturePct < 0 ||
    moisturePct > 100
  ) {
    console.error(`[mqtt] invalid moisture_pct on ${topic}: ${JSON.stringify(moisturePct)}`);
    return;
  }

  // Plant assignment is keyed by sensor_id (e.g. "monstera", "pothos")
  const device = getDevice(sensorId);
  if (!device) {
    console.error(
      `[mqtt] no plant assigned to sensor "${sensorId}" — run: plantwise device assign ${sensorId} <plant-id>`
    );
    return;
  }

  const plant = getPlant(device.plant_id);
  if (!plant) {
    console.error(`[mqtt] plant ${device.plant_id} assigned to "${sensorId}" no longer exists`);
    return;
  }

  logSensorReading(device.plant_id, moisturePct, 'hardware');

  const tooWet = moisturePct > plant.moisture_upper_threshold_pct;
  const tooDry = moisturePct < plant.moisture_threshold_pct;
  const status = tooWet ? 'too wet' : tooDry ? 'needs water' : 'OK';
  console.log(
    `[mqtt] ${plant.name} [${sensorId}] — ${moisturePct}% (low: ${plant.moisture_threshold_pct}% / high: ${plant.moisture_upper_threshold_pct}%) — ${status}`
  );

  if (process.env['MQTT_NOTIFY'] === 'true') {
    if (tooDry) {
      notify(`${plant.name} needs water — soil moisture ${moisturePct}%`);
    } else if (tooWet) {
      notify(`${plant.name} is overwatered — soil moisture ${moisturePct}%`);
    }
  }
}

export function startSubscriber(): void {
  const url = `mqtt://${MQTT_HOST}:${MQTT_PORT}`;
  const options: mqtt.IClientOptions = {};
  if (MQTT_USERNAME) {
    options.username = MQTT_USERNAME;
    options.password = MQTT_PASSWORD;
  }

  const client = mqtt.connect(url, options);

  client.on('connect', () => {
    console.log(`[mqtt] connected to ${url}`);
    client.subscribe(TOPIC, (err) => {
      if (err) {
        console.error('[mqtt] subscribe error:', err.message);
      } else {
        console.log(`[mqtt] subscribed to ${TOPIC}`);
        console.log('[mqtt] waiting for sensor readings...');
      }
    });
  });

  client.on('message', handleMessage);

  client.on('error', (err) => {
    console.error('[mqtt] error:', err.message);
  });

  client.on('reconnect', () => {
    console.log('[mqtt] reconnecting...');
  });

  client.on('offline', () => {
    console.log('[mqtt] offline');
  });
}
