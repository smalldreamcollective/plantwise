import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as queries from '../db/queries';
import * as notifyModule from '../utils/notify';
import { handleMessage } from './subscriber';

vi.mock('../db/queries', () => ({
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
  created_at: '2026-01-01 00:00:00',
};

const topic = 'plantwise/sensors/living-room/moisture';

function msg(payload: unknown): Buffer {
  return Buffer.from(JSON.stringify(payload));
}

describe('handleMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queries.getPlant).mockReturnValue(mockPlant);
    vi.mocked(queries.logSensorReading).mockReturnValue({} as never);
    delete process.env['MQTT_NOTIFY'];
  });

  afterEach(() => {
    delete process.env['MQTT_NOTIFY'];
  });

  it('logs a valid reading above threshold', () => {
    handleMessage(topic, msg({ plant_id: 1, moisture_pct: 45 }));
    expect(queries.logSensorReading).toHaveBeenCalledWith(1, 45, 'hardware');
    expect(notifyModule.notify).not.toHaveBeenCalled();
  });

  it('logs a reading below threshold without notifying when MQTT_NOTIFY is false', () => {
    handleMessage(topic, msg({ plant_id: 1, moisture_pct: 20 }));
    expect(queries.logSensorReading).toHaveBeenCalledWith(1, 20, 'hardware');
    expect(notifyModule.notify).not.toHaveBeenCalled();
  });

  it('fires notification when below threshold and MQTT_NOTIFY=true', () => {
    process.env['MQTT_NOTIFY'] = 'true';
    handleMessage(topic, msg({ plant_id: 1, moisture_pct: 20 }));
    expect(queries.logSensorReading).toHaveBeenCalledWith(1, 20, 'hardware');
    expect(notifyModule.notify).toHaveBeenCalledWith('Basil needs water — soil moisture 20%');
  });

  it('does not notify when above threshold even if MQTT_NOTIFY=true', () => {
    process.env['MQTT_NOTIFY'] = 'true';
    handleMessage(topic, msg({ plant_id: 1, moisture_pct: 55 }));
    expect(queries.logSensorReading).toHaveBeenCalled();
    expect(notifyModule.notify).not.toHaveBeenCalled();
  });

  it('skips invalid JSON', () => {
    handleMessage(topic, Buffer.from('not json'));
    expect(queries.logSensorReading).not.toHaveBeenCalled();
  });

  it('skips missing plant_id', () => {
    handleMessage(topic, msg({ moisture_pct: 45 }));
    expect(queries.logSensorReading).not.toHaveBeenCalled();
  });

  it('skips non-integer plant_id', () => {
    handleMessage(topic, msg({ plant_id: 'one', moisture_pct: 45 }));
    expect(queries.logSensorReading).not.toHaveBeenCalled();
  });

  it('skips zero plant_id', () => {
    handleMessage(topic, msg({ plant_id: 0, moisture_pct: 45 }));
    expect(queries.logSensorReading).not.toHaveBeenCalled();
  });

  it('skips missing moisture_pct', () => {
    handleMessage(topic, msg({ plant_id: 1 }));
    expect(queries.logSensorReading).not.toHaveBeenCalled();
  });

  it('skips moisture_pct above 100', () => {
    handleMessage(topic, msg({ plant_id: 1, moisture_pct: 150 }));
    expect(queries.logSensorReading).not.toHaveBeenCalled();
  });

  it('skips moisture_pct below 0', () => {
    handleMessage(topic, msg({ plant_id: 1, moisture_pct: -1 }));
    expect(queries.logSensorReading).not.toHaveBeenCalled();
  });

  it('skips non-integer moisture_pct', () => {
    handleMessage(topic, msg({ plant_id: 1, moisture_pct: 42.5 }));
    expect(queries.logSensorReading).not.toHaveBeenCalled();
  });

  it('skips unknown plant_id', () => {
    vi.mocked(queries.getPlant).mockReturnValue(undefined);
    handleMessage(topic, msg({ plant_id: 999, moisture_pct: 45 }));
    expect(queries.logSensorReading).not.toHaveBeenCalled();
  });

  it('accepts moisture_pct at boundary values 0 and 100', () => {
    handleMessage(topic, msg({ plant_id: 1, moisture_pct: 0 }));
    expect(queries.logSensorReading).toHaveBeenCalledWith(1, 0, 'hardware');

    vi.clearAllMocks();
    vi.mocked(queries.getPlant).mockReturnValue(mockPlant);
    vi.mocked(queries.logSensorReading).mockReturnValue({} as never);

    handleMessage(topic, msg({ plant_id: 1, moisture_pct: 100 }));
    expect(queries.logSensorReading).toHaveBeenCalledWith(1, 100, 'hardware');
  });
});
