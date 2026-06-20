import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as queries from '../db/queries';
import * as notifyModule from '../utils/notify';
import {
  handleMessage,
  handleStatusMessage,
  versionNotifyLastSent,
  buildFlushFailedFixHint,
} from './subscriber';

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

describe('version checking', () => {
  const versionTopic = 'plantwise/sensors/living-room/monstera/moisture';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queries.getDevice).mockReturnValue(mockDevice);
    vi.mocked(queries.getPlant).mockReturnValue(mockPlant);
    vi.mocked(queries.logSensorReading).mockReturnValue({} as never);
    versionNotifyLastSent.clear();
    delete process.env['TARGET_VERSION'];
    delete process.env['MQTT_NOTIFY'];
  });

  afterEach(() => {
    delete process.env['TARGET_VERSION'];
    delete process.env['MQTT_NOTIFY'];
  });

  it('does nothing when TARGET_VERSION is not set', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    handleMessage(
      versionTopic,
      msg({ device_id: 'living-room', sensor_id: 'monstera', moisture_pct: 50, version: '0.1.0' })
    );
    expect(spy).not.toHaveBeenCalled();
    expect(notifyModule.notify).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does nothing when version matches TARGET_VERSION', () => {
    process.env['TARGET_VERSION'] = '0.1.0';
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    handleMessage(
      versionTopic,
      msg({ device_id: 'living-room', sensor_id: 'monstera', moisture_pct: 50, version: '0.1.0' })
    );
    expect(spy).not.toHaveBeenCalled();
    expect(notifyModule.notify).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('warns when version does not match TARGET_VERSION', () => {
    process.env['TARGET_VERSION'] = '0.2.0';
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    handleMessage(
      versionTopic,
      msg({ device_id: 'living-room', sensor_id: 'monstera', moisture_pct: 50, version: '0.1.0' })
    );
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('0.1.0'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('0.2.0'));
    spy.mockRestore();
  });

  it('notifies when version mismatches and MQTT_NOTIFY=true', () => {
    process.env['TARGET_VERSION'] = '0.2.0';
    process.env['MQTT_NOTIFY'] = 'true';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    handleMessage(
      versionTopic,
      msg({ device_id: 'living-room', sensor_id: 'monstera', moisture_pct: 50, version: '0.1.0' })
    );
    expect(notifyModule.notify).toHaveBeenCalledWith(expect.stringContaining('living-room'));
    expect(notifyModule.notify).toHaveBeenCalledWith(expect.stringContaining('plantwise-update'));
    vi.restoreAllMocks();
  });

  it('does not notify on mismatch when MQTT_NOTIFY is not set', () => {
    process.env['TARGET_VERSION'] = '0.2.0';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    handleMessage(
      versionTopic,
      msg({ device_id: 'living-room', sensor_id: 'monstera', moisture_pct: 50, version: '0.1.0' })
    );
    expect(notifyModule.notify).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('does nothing when version field is absent from payload', () => {
    process.env['TARGET_VERSION'] = '0.2.0';
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    handleMessage(
      versionTopic,
      msg({ device_id: 'living-room', sensor_id: 'monstera', moisture_pct: 50 })
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not warn again within the throttle window', () => {
    process.env['TARGET_VERSION'] = '0.2.0';
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const payload = msg({
      device_id: 'living-room',
      sensor_id: 'monstera',
      moisture_pct: 50,
      version: '0.1.0',
    });
    handleMessage(versionTopic, payload);
    handleMessage(versionTopic, payload);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('handleStatusMessage', () => {
  const statusTopic = 'plantwise/devices/living-room/status';

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['MQTT_NOTIFY'];
  });

  afterEach(() => {
    delete process.env['MQTT_NOTIFY'];
  });

  it('logs online status to console without notifying', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    handleStatusMessage(statusTopic, msg({ status: 'online', device: 'living-room' }));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('living-room'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('online'));
    expect(notifyModule.notify).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('logs offline status to console without notifying', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    handleStatusMessage(statusTopic, msg({ status: 'offline', device: 'living-room' }));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('offline'));
    expect(notifyModule.notify).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('logs error event to console regardless of MQTT_NOTIFY', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    handleStatusMessage(
      statusTopic,
      msg({ event: 'error', code: 'influxdb_flush_failed', message: 'connection refused' })
    );
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('influxdb_flush_failed'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('connection refused'));
    spy.mockRestore();
  });

  it('fires notify on error event when MQTT_NOTIFY=true', () => {
    process.env['MQTT_NOTIFY'] = 'true';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    handleStatusMessage(
      statusTopic,
      msg({ event: 'error', code: 'sensor_read_error', message: 'OSError: I2C failure' })
    );
    expect(notifyModule.notify).toHaveBeenCalledWith(expect.stringContaining('living-room'));
    expect(notifyModule.notify).toHaveBeenCalledWith(expect.stringContaining('sensor_read_error'));
    vi.restoreAllMocks();
  });

  it('does not fire notify on error event when MQTT_NOTIFY is not set', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    handleStatusMessage(
      statusTopic,
      msg({ event: 'error', code: 'influxdb_flush_failed', message: 'timeout' })
    );
    expect(notifyModule.notify).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('prints the reset-measurement fix command on a field type conflict', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    handleStatusMessage(
      statusTopic,
      msg({
        event: 'error',
        code: 'influxdb_flush_failed',
        message:
          'failure writing points to database: partial write: field type conflict: input field "moisture_pct" on measurement "moisture" is type float, already exists as type integer dropped=1401',
      })
    );
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('npm run influx:reset-measurement -- moisture')
    );
    spy.mockRestore();
  });

  it('does not print a fix hint for non-conflict influxdb_flush_failed alerts', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    handleStatusMessage(
      statusTopic,
      msg({ event: 'error', code: 'influxdb_flush_failed', message: 'connection refused' })
    );
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('influx:reset-measurement'));
    spy.mockRestore();
  });

  it('extracts device_id correctly from topic', () => {
    process.env['MQTT_NOTIFY'] = 'true';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    handleStatusMessage(
      'plantwise/devices/bedroom-sensor/status',
      msg({ event: 'error', code: 'sensor_read_error', message: 'fail' })
    );
    expect(notifyModule.notify).toHaveBeenCalledWith(expect.stringContaining('bedroom-sensor'));
    vi.restoreAllMocks();
  });

  it('skips invalid JSON', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    handleStatusMessage(statusTopic, Buffer.from('not json'));
    expect(notifyModule.notify).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('handles unknown payload shape without throwing or notifying', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    handleStatusMessage(statusTopic, msg({ foo: 'bar' }));
    expect(notifyModule.notify).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('buildFlushFailedFixHint', () => {
  it('extracts the measurement name from a field type conflict message', () => {
    const hint = buildFlushFailedFixHint(
      'influxdb_flush_failed',
      'field type conflict: input field "moisture_pct" on measurement "moisture" is type float, already exists as type integer dropped=1401'
    );
    expect(hint).toBe('  Fix: npm run influx:reset-measurement -- moisture');
  });

  it('falls back to a placeholder when the measurement cannot be parsed', () => {
    const hint = buildFlushFailedFixHint('influxdb_flush_failed', 'field type conflict: weird');
    expect(hint).toBe('  Fix: npm run influx:reset-measurement -- <measurement>');
  });

  it('returns null for non-conflict influxdb_flush_failed messages', () => {
    expect(buildFlushFailedFixHint('influxdb_flush_failed', 'connection refused')).toBeNull();
  });

  it('returns null for other error codes', () => {
    expect(
      buildFlushFailedFixHint('sensor_read_error', 'field type conflict: unrelated')
    ).toBeNull();
  });
});
