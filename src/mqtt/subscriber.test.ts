import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as queries from '../db/queries';
import * as notifyModule from '../utils/notify';
import { handleMessage } from './subscriber';

vi.mock('../db/queries', () => ({
  getDevice: vi.fn(),
  getPlant: vi.fn(),
  logSensorReading: vi.fn(),
}));

vi.mock('../utils/notify', () => ({
  notify: vi.fn(),
}));

const mockPlant = {
  id: 1,
  name: 'Basil',
  species: null,
  notes: null,
  watering_interval_days: 7,
  moisture_threshold_pct: 30,
  moisture_upper_threshold_pct: 85,
  created_at: '2026-01-01 00:00:00',
};

const mockDevice = {
  device_id: 'monstera',
  plant_id: 1,
  name: null,
  created_at: '2026-01-01 00:00:00',
};

// New topic format: plantwise/sensors/<device_id>/<sensor_id>/moisture
const topic = 'plantwise/sensors/living-room/monstera/moisture';

function msg(payload: unknown): Buffer {
  return Buffer.from(JSON.stringify(payload));
}

describe('handleMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queries.getDevice).mockReturnValue(mockDevice);
    vi.mocked(queries.getPlant).mockReturnValue(mockPlant);
    vi.mocked(queries.logSensorReading).mockReturnValue({} as never);
    delete process.env['MQTT_NOTIFY'];
  });

  afterEach(() => {
    delete process.env['MQTT_NOTIFY'];
  });

  it('logs a valid reading above threshold', () => {
    handleMessage(
      topic,
      msg({ device_id: 'living-room', sensor_id: 'monstera', moisture_pct: 45 })
    );
    expect(queries.getDevice).toHaveBeenCalledWith('monstera');
    expect(queries.logSensorReading).toHaveBeenCalledWith(1, 45, 'hardware');
    expect(notifyModule.notify).not.toHaveBeenCalled();
  });

  it('logs a reading below threshold without notifying when MQTT_NOTIFY is false', () => {
    handleMessage(
      topic,
      msg({ device_id: 'living-room', sensor_id: 'monstera', moisture_pct: 20 })
    );
    expect(queries.logSensorReading).toHaveBeenCalledWith(1, 20, 'hardware');
    expect(notifyModule.notify).not.toHaveBeenCalled();
  });

  it('fires notification when below threshold and MQTT_NOTIFY=true', () => {
    process.env['MQTT_NOTIFY'] = 'true';
    handleMessage(
      topic,
      msg({ device_id: 'living-room', sensor_id: 'monstera', moisture_pct: 20 })
    );
    expect(queries.logSensorReading).toHaveBeenCalledWith(1, 20, 'hardware');
    expect(notifyModule.notify).toHaveBeenCalledWith('Basil needs water — soil moisture 20%');
  });

  it('does not notify when above threshold even if MQTT_NOTIFY=true', () => {
    process.env['MQTT_NOTIFY'] = 'true';
    handleMessage(
      topic,
      msg({ device_id: 'living-room', sensor_id: 'monstera', moisture_pct: 55 })
    );
    expect(queries.logSensorReading).toHaveBeenCalled();
    expect(notifyModule.notify).not.toHaveBeenCalled();
  });

  it('fires overwatering notification when above upper threshold and MQTT_NOTIFY=true', () => {
    process.env['MQTT_NOTIFY'] = 'true';
    handleMessage(
      topic,
      msg({ device_id: 'living-room', sensor_id: 'monstera', moisture_pct: 90 })
    );
    expect(queries.logSensorReading).toHaveBeenCalledWith(1, 90, 'hardware');
    expect(notifyModule.notify).toHaveBeenCalledWith('Basil is overwatered — soil moisture 90%');
  });

  it('does not fire overwatering notification when MQTT_NOTIFY is false', () => {
    handleMessage(
      topic,
      msg({ device_id: 'living-room', sensor_id: 'monstera', moisture_pct: 90 })
    );
    expect(queries.logSensorReading).toHaveBeenCalled();
    expect(notifyModule.notify).not.toHaveBeenCalled();
  });

  it('does not fire overwatering notification when moisture is at the upper threshold (not above)', () => {
    process.env['MQTT_NOTIFY'] = 'true';
    handleMessage(
      topic,
      msg({ device_id: 'living-room', sensor_id: 'monstera', moisture_pct: 85 })
    );
    expect(notifyModule.notify).not.toHaveBeenCalled();
  });

  it('skips invalid JSON', () => {
    handleMessage(topic, Buffer.from('not json'));
    expect(queries.logSensorReading).not.toHaveBeenCalled();
  });

  it('skips malformed topic missing sensor_id segment', () => {
    handleMessage(
      'plantwise/sensors/living-room/moisture',
      msg({ device_id: 'living-room', moisture_pct: 45 })
    );
    expect(queries.logSensorReading).not.toHaveBeenCalled();
  });

  it('skips missing moisture_pct', () => {
    handleMessage(topic, msg({ device_id: 'living-room', sensor_id: 'monstera' }));
    expect(queries.logSensorReading).not.toHaveBeenCalled();
  });

  it('skips moisture_pct above 100', () => {
    handleMessage(
      topic,
      msg({ device_id: 'living-room', sensor_id: 'monstera', moisture_pct: 150 })
    );
    expect(queries.logSensorReading).not.toHaveBeenCalled();
  });

  it('skips moisture_pct below 0', () => {
    handleMessage(
      topic,
      msg({ device_id: 'living-room', sensor_id: 'monstera', moisture_pct: -1 })
    );
    expect(queries.logSensorReading).not.toHaveBeenCalled();
  });

  it('skips non-integer moisture_pct', () => {
    handleMessage(
      topic,
      msg({ device_id: 'living-room', sensor_id: 'monstera', moisture_pct: 42.5 })
    );
    expect(queries.logSensorReading).not.toHaveBeenCalled();
  });

  it('skips unassigned sensor', () => {
    vi.mocked(queries.getDevice).mockReturnValue(undefined);
    handleMessage(
      topic,
      msg({ device_id: 'living-room', sensor_id: 'unknown-sensor', moisture_pct: 45 })
    );
    expect(queries.logSensorReading).not.toHaveBeenCalled();
  });

  it('accepts moisture_pct at boundary values 0 and 100', () => {
    handleMessage(topic, msg({ device_id: 'living-room', sensor_id: 'monstera', moisture_pct: 0 }));
    expect(queries.logSensorReading).toHaveBeenCalledWith(1, 0, 'hardware');

    vi.clearAllMocks();
    vi.mocked(queries.getDevice).mockReturnValue(mockDevice);
    vi.mocked(queries.getPlant).mockReturnValue(mockPlant);
    vi.mocked(queries.logSensorReading).mockReturnValue({} as never);

    handleMessage(
      topic,
      msg({ device_id: 'living-room', sensor_id: 'monstera', moisture_pct: 100 })
    );
    expect(queries.logSensorReading).toHaveBeenCalledWith(1, 100, 'hardware');
  });
});
