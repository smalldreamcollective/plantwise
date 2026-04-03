// Must be set before any call to getDb() — DB_PATH is read lazily inside getDb()
process.env['DB_PATH'] = ':memory:';

import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from './schema';
import {
  assignDevice,
  getAllPlantsWithLatestReading,
  getAllPlantsWithMoistureStats,
  getAllSensorReadings,
  getChannelMappingsForDevice,
  getDevice,
  getHealthChecksForPlant,
  getLastCareEvent,
  getLatestSensorReading,
  getPlant,
  getPlantWithWatering,
  getPlantsOverdueForWatering,
  getPlantsOverwatered,
  getSensorReadings,
  insertHealthCheck,
  insertPlant,
  listChannelMappings,
  listDevices,
  listPlants,
  logCareEvent,
  logSensorReading,
  mapChannel,
  removePlant,
  unassignDevice,
  unmapChannel,
  updatePlant,
} from './queries';

describe('DB queries', () => {
  beforeEach(() => {
    const db = getDb();
    db.exec(
      'DELETE FROM devices; DELETE FROM sensor_readings; DELETE FROM care_events; DELETE FROM health_checks; DELETE FROM plants;'
    );
  });

  describe('insertPlant', () => {
    it('inserts and returns a plant with all fields', () => {
      const plant = insertPlant('Fern', 'Nephrolepis exaltata', 'Keep moist');
      expect(plant.id).toBeTypeOf('number');
      expect(plant.name).toBe('Fern');
      expect(plant.species).toBe('Nephrolepis exaltata');
      expect(plant.notes).toBe('Keep moist');
      expect(plant.watering_interval_days).toBe(7);
      expect(plant.created_at).toBeTypeOf('string');
    });

    it('inserts a plant with no species or notes', () => {
      const plant = insertPlant('Cactus');
      expect(plant.name).toBe('Cactus');
      expect(plant.species).toBeNull();
      expect(plant.notes).toBeNull();
    });

    it('assigns incrementing IDs', () => {
      const a = insertPlant('Rose');
      const b = insertPlant('Tulip');
      expect(b.id).toBeGreaterThan(a.id);
    });
  });

  describe('listPlants', () => {
    it('returns an empty array when no plants exist', () => {
      expect(listPlants()).toEqual([]);
    });

    it('returns all inserted plants', () => {
      insertPlant('Rose');
      insertPlant('Tulip');
      insertPlant('Daisy');
      const plants = listPlants();
      expect(plants).toHaveLength(3);
      expect(plants.map((p) => p.name)).toContain('Rose');
    });

    it('returns plants in an array (ORDER BY created_at DESC)', () => {
      insertPlant('First');
      insertPlant('Second');
      const plants = listPlants();
      expect(plants).toHaveLength(2);
      const names = plants.map((p) => p.name);
      expect(names).toContain('First');
      expect(names).toContain('Second');
    });
  });

  describe('insertHealthCheck', () => {
    it('inserts a health check linked to a plant', () => {
      const plant = insertPlant('Basil');
      const raw = { status: 'healthy', probability: 0.95 };
      const check = insertHealthCheck(plant.id, '/photos/basil.jpg', raw, 'Looks great!');

      expect(check.plant_id).toBe(plant.id);
      expect(check.photo_path).toBe('/photos/basil.jpg');
      expect(check.plantid_raw).toBe(JSON.stringify(raw));
      expect(check.diagnosis).toBe('Looks great!');
    });

    it('inserts a health check with no plant linked (null plant_id)', () => {
      const raw = { unknown: true };
      const check = insertHealthCheck(null, '/photos/unknown.jpg', raw, 'Unknown plant');
      expect(check.plant_id).toBeNull();
    });

    it('stores plantid_raw as JSON string', () => {
      const plant = insertPlant('Mint');
      const raw = { diseases: ['root rot'], confidence: 0.8 };
      const check = insertHealthCheck(plant.id, '/photos/mint.jpg', raw, 'Needs attention');
      expect(JSON.parse(check.plantid_raw)).toEqual(raw);
    });
  });

  describe('logCareEvent', () => {
    it('inserts a care event and returns it', () => {
      const plant = insertPlant('Fern');
      const event = logCareEvent(plant.id, 'water');
      expect(event.plant_id).toBe(plant.id);
      expect(event.type).toBe('water');
      expect(event.notes).toBeNull();
      expect(event.occurred_at).toBeTypeOf('string');
      expect(event.id).toBeTypeOf('number');
    });

    it('stores optional notes', () => {
      const plant = insertPlant('Basil');
      const event = logCareEvent(plant.id, 'feed', 'Osmocote');
      expect(event.notes).toBe('Osmocote');
    });

    it('throws if the plant does not exist (FK constraint)', () => {
      expect(() => logCareEvent(99999, 'water')).toThrow();
    });
  });

  describe('getLastCareEvent', () => {
    it('returns undefined when no events of that type exist', () => {
      const plant = insertPlant('Cactus');
      expect(getLastCareEvent(plant.id, 'water')).toBeUndefined();
    });

    it('returns the most recent event when multiple exist', () => {
      const plant = insertPlant('Basil');
      const firstEvent = logCareEvent(plant.id, 'water');
      getDb()
        .prepare(
          "INSERT INTO care_events (plant_id, type, occurred_at) VALUES (?, 'water', datetime('now', '+1 day'))"
        )
        .run(plant.id);
      const last = getLastCareEvent(plant.id, 'water');
      expect(last).toBeDefined();
      // The returned record should be the later of the two events
      expect(last?.occurred_at > firstEvent.occurred_at).toBe(true);
    });

    it('returns only events of the requested type', () => {
      const plant = insertPlant('Mint');
      logCareEvent(plant.id, 'feed');
      expect(getLastCareEvent(plant.id, 'water')).toBeUndefined();
    });
  });

  describe('getPlantsOverdueForWatering', () => {
    it('includes a plant that has never been watered', () => {
      insertPlant('Orchid');
      const overdue = getPlantsOverdueForWatering();
      expect(overdue.some((p) => p.name === 'Orchid')).toBe(true);
    });

    it('excludes a plant watered today with a 7-day interval', () => {
      const plant = insertPlant('Succulent');
      logCareEvent(plant.id, 'water');
      const overdue = getPlantsOverdueForWatering();
      expect(overdue.some((p) => p.id === plant.id)).toBe(false);
    });

    it('includes a plant whose last watering exceeds the interval', () => {
      const plant = insertPlant('Fern');
      getDb()
        .prepare(
          "INSERT INTO care_events (plant_id, type, occurred_at) VALUES (?, 'water', datetime('now', '-10 days'))"
        )
        .run(plant.id);
      const overdue = getPlantsOverdueForWatering();
      expect(overdue.some((p) => p.id === plant.id)).toBe(true);
    });
  });

  describe('getPlantWithWatering', () => {
    it('returns undefined for a non-existent plant', () => {
      expect(getPlantWithWatering(99999)).toBeUndefined();
    });

    it('returns null last_watered_at for a never-watered plant', () => {
      const plant = insertPlant('Aloe');
      const result = getPlantWithWatering(plant.id);
      expect(result).toBeDefined();
      expect(result?.last_watered_at).toBeNull();
      expect(result?.days_since_watered).toBeNull();
    });

    it('returns days_since_watered = 0 after watering today', () => {
      const plant = insertPlant('Mint');
      logCareEvent(plant.id, 'water');
      const result = getPlantWithWatering(plant.id);
      expect(result?.last_watered_at).toBeTypeOf('string');
      expect(result?.days_since_watered).toBe(0);
    });
  });

  describe('removePlant', () => {
    it('returns false when the plant does not exist', () => {
      expect(removePlant(99999)).toBe(false);
    });

    it('deletes the plant and returns true', () => {
      const plant = insertPlant('Daisy');
      expect(removePlant(plant.id)).toBe(true);
      expect(getPlantWithWatering(plant.id)).toBeUndefined();
    });

    it('deletes associated care_events', () => {
      const plant = insertPlant('Rose');
      logCareEvent(plant.id, 'water');
      removePlant(plant.id);
      const rows = getDb()
        .prepare("SELECT * FROM care_events WHERE plant_id = ? AND type = 'water'")
        .all(plant.id);
      expect(rows).toHaveLength(0);
    });

    it('deletes associated health_checks', () => {
      const plant = insertPlant('Basil');
      insertHealthCheck(plant.id, '/p.jpg', {}, 'ok');
      removePlant(plant.id);
      expect(getHealthChecksForPlant(plant.id)).toHaveLength(0);
    });

    it('deletes associated sensor_readings', () => {
      const plant = insertPlant('Cactus');
      logSensorReading(plant.id, 55);
      removePlant(plant.id);
      const rows = getDb()
        .prepare('SELECT * FROM sensor_readings WHERE plant_id = ?')
        .all(plant.id);
      expect(rows).toHaveLength(0);
    });
  });

  describe('logSensorReading', () => {
    it('inserts a reading and returns it', () => {
      const plant = insertPlant('Fern');
      const reading = logSensorReading(plant.id, 45);
      expect(reading.plant_id).toBe(plant.id);
      expect(reading.moisture_pct).toBe(45);
      expect(reading.source).toBe('manual');
      expect(reading.recorded_at).toBeTypeOf('string');
    });

    it('stores the provided source', () => {
      const plant = insertPlant('Basil');
      const reading = logSensorReading(plant.id, 72, 'hardware');
      expect(reading.source).toBe('hardware');
    });

    it('throws if the plant does not exist (FK constraint)', () => {
      expect(() => logSensorReading(99999, 50)).toThrow();
    });

    it('rejects moisture_pct outside 0–100', () => {
      const plant = insertPlant('Orchid');
      expect(() => logSensorReading(plant.id, 101)).toThrow();
      expect(() => logSensorReading(plant.id, -1)).toThrow();
    });
  });

  describe('getLatestSensorReading', () => {
    it('returns undefined when no readings exist', () => {
      const plant = insertPlant('Cactus');
      expect(getLatestSensorReading(plant.id)).toBeUndefined();
    });

    it('returns the most recent reading', () => {
      const plant = insertPlant('Mint');
      logSensorReading(plant.id, 60);
      getDb()
        .prepare(
          "INSERT INTO sensor_readings (plant_id, moisture_pct, source, recorded_at) VALUES (?, 30, 'manual', datetime('now', '+1 hour'))"
        )
        .run(plant.id);
      const latest = getLatestSensorReading(plant.id);
      expect(latest?.moisture_pct).toBe(30);
    });
  });

  describe('getAllPlantsWithLatestReading', () => {
    it('returns all plants, with null moisture for plants with no readings', () => {
      insertPlant('Aloe');
      insertPlant('Basil');
      const results = getAllPlantsWithLatestReading();
      expect(results).toHaveLength(2);
      expect(results.every((p) => p.moisture_pct === null)).toBe(true);
    });

    it('returns the latest moisture reading per plant', () => {
      const plant = insertPlant('Fern');
      logSensorReading(plant.id, 80);
      logSensorReading(plant.id, 40);
      const results = getAllPlantsWithLatestReading();
      const fern = results.find((p) => p.id === plant.id);
      expect(fern?.moisture_pct).toBe(40);
    });
  });

  describe('getPlantsOverdueForWatering (sensor-aware)', () => {
    it('excludes a plant with a fresh reading above threshold', () => {
      const plant = insertPlant('Succulent');
      logSensorReading(plant.id, 80); // well above default 30% threshold
      const overdue = getPlantsOverdueForWatering();
      expect(overdue.some((p) => p.id === plant.id)).toBe(false);
    });

    it('includes a plant with a fresh reading below threshold', () => {
      const plant = insertPlant('Fern');
      logSensorReading(plant.id, 10); // below default 30% threshold
      const overdue = getPlantsOverdueForWatering();
      expect(overdue.some((p) => p.id === plant.id)).toBe(true);
    });

    it('falls back to time-based logic when no sensor readings exist', () => {
      insertPlant('Orchid'); // never watered, no readings
      const overdue = getPlantsOverdueForWatering();
      expect(overdue.some((p) => p.name === 'Orchid')).toBe(true);
    });
  });

  describe('getPlant', () => {
    it('returns the plant by id', () => {
      const plant = insertPlant('Aloe');
      const found = getPlant(plant.id);
      expect(found).toBeDefined();
      expect(found?.name).toBe('Aloe');
    });

    it('returns undefined for a non-existent id', () => {
      expect(getPlant(99999)).toBeUndefined();
    });
  });

  describe('insertPlant with custom interval and threshold', () => {
    it('stores custom watering_interval_days', () => {
      const plant = insertPlant('Cactus', undefined, undefined, 21);
      expect(plant.watering_interval_days).toBe(21);
    });

    it('stores custom moisture_threshold_pct', () => {
      const plant = insertPlant('Cactus', undefined, undefined, undefined, 15);
      expect(plant.moisture_threshold_pct).toBe(15);
    });

    it('stores both custom interval and threshold together', () => {
      const plant = insertPlant('Succulent', undefined, undefined, 14, 20);
      expect(plant.watering_interval_days).toBe(14);
      expect(plant.moisture_threshold_pct).toBe(20);
    });

    it('defaults to 7 days and 30% when not provided', () => {
      const plant = insertPlant('Fern');
      expect(plant.watering_interval_days).toBe(7);
      expect(plant.moisture_threshold_pct).toBe(30);
    });

    it('stores custom moisture_upper_threshold_pct', () => {
      const plant = insertPlant('Fern', undefined, undefined, undefined, undefined, 75);
      expect(plant.moisture_upper_threshold_pct).toBe(75);
    });

    it('defaults moisture_upper_threshold_pct to 85', () => {
      const plant = insertPlant('Cactus');
      expect(plant.moisture_upper_threshold_pct).toBe(85);
    });
  });

  describe('updatePlant', () => {
    it('updates the name', () => {
      const plant = insertPlant('Old Name');
      const updated = updatePlant(plant.id, { name: 'New Name' });
      expect(updated?.name).toBe('New Name');
    });

    it('updates species', () => {
      const plant = insertPlant('Fern');
      const updated = updatePlant(plant.id, { species: 'Nephrolepis exaltata' });
      expect(updated?.species).toBe('Nephrolepis exaltata');
    });

    it('updates notes', () => {
      const plant = insertPlant('Basil');
      const updated = updatePlant(plant.id, { notes: 'South window' });
      expect(updated?.notes).toBe('South window');
    });

    it('updates watering_interval_days', () => {
      const plant = insertPlant('Cactus');
      const updated = updatePlant(plant.id, { watering_interval_days: 21 });
      expect(updated?.watering_interval_days).toBe(21);
    });

    it('updates moisture_threshold_pct', () => {
      const plant = insertPlant('Succulent');
      const updated = updatePlant(plant.id, { moisture_threshold_pct: 15 });
      expect(updated?.moisture_threshold_pct).toBe(15);
    });

    it('updates moisture_upper_threshold_pct', () => {
      const plant = insertPlant('Succulent');
      const updated = updatePlant(plant.id, { moisture_upper_threshold_pct: 75 });
      expect(updated?.moisture_upper_threshold_pct).toBe(75);
    });

    it('updates multiple fields at once', () => {
      const plant = insertPlant('Orchid');
      const updated = updatePlant(plant.id, {
        name: 'Phalaenopsis',
        watering_interval_days: 10,
        moisture_threshold_pct: 40,
      });
      expect(updated?.name).toBe('Phalaenopsis');
      expect(updated?.watering_interval_days).toBe(10);
      expect(updated?.moisture_threshold_pct).toBe(40);
    });

    it('returns the existing plant when no fields are provided', () => {
      const plant = insertPlant('Rose');
      const result = updatePlant(plant.id, {});
      expect(result?.name).toBe('Rose');
    });

    it('returns undefined for a non-existent plant', () => {
      const result = updatePlant(99999, { name: 'Ghost' });
      expect(result).toBeUndefined();
    });

    it('does not modify unrelated fields', () => {
      const plant = insertPlant('Mint', 'Mentha', 'Kitchen shelf');
      updatePlant(plant.id, { name: 'Peppermint' });
      const refetched = getPlant(plant.id);
      expect(refetched?.species).toBe('Mentha');
      expect(refetched?.notes).toBe('Kitchen shelf');
    });
  });

  describe('getSensorReadings', () => {
    it('returns an empty array when no readings exist', () => {
      const plant = insertPlant('Cactus');
      expect(getSensorReadings(plant.id)).toEqual([]);
    });

    it('returns readings in descending order', () => {
      const plant = insertPlant('Fern');
      logSensorReading(plant.id, 80);
      getDb()
        .prepare(
          "INSERT INTO sensor_readings (plant_id, moisture_pct, source, recorded_at) VALUES (?, 40, 'manual', datetime('now', '+1 hour'))"
        )
        .run(plant.id);
      const readings = getSensorReadings(plant.id);
      expect(readings[0]?.moisture_pct).toBe(40);
      expect(readings[1]?.moisture_pct).toBe(80);
    });

    it('respects the limit parameter', () => {
      const plant = insertPlant('Basil');
      for (let i = 0; i < 5; i++) logSensorReading(plant.id, 50);
      expect(getSensorReadings(plant.id, 3)).toHaveLength(3);
    });
  });

  describe('getAllSensorReadings', () => {
    it('returns an empty array when no readings exist', () => {
      insertPlant('Cactus');
      expect(getAllSensorReadings()).toEqual([]);
    });

    it('returns readings for all plants with plant name and thresholds', () => {
      const plantA = insertPlant('Monstera');
      const plantB = insertPlant('Aloe');
      logSensorReading(plantA.id, 60);
      logSensorReading(plantB.id, 20);
      const results = getAllSensorReadings();
      expect(results).toHaveLength(2);
      const a = results.find((r) => r.plant_id === plantA.id);
      const b = results.find((r) => r.plant_id === plantB.id);
      expect(a?.plant_name).toBe('Monstera');
      expect(a?.moisture_pct).toBe(60);
      expect(b?.plant_name).toBe('Aloe');
      expect(b?.moisture_pct).toBe(20);
    });

    it('respects the limitPerPlant parameter', () => {
      const plantA = insertPlant('Fern');
      const plantB = insertPlant('Basil');
      for (let i = 0; i < 5; i++) logSensorReading(plantA.id, 50);
      for (let i = 0; i < 5; i++) logSensorReading(plantB.id, 50);
      const results = getAllSensorReadings(3);
      expect(results.filter((r) => r.plant_id === plantA.id)).toHaveLength(3);
      expect(results.filter((r) => r.plant_id === plantB.id)).toHaveLength(3);
    });

    it('orders readings newest-first within each plant', () => {
      const plant = insertPlant('Mint');
      logSensorReading(plant.id, 30);
      getDb()
        .prepare(
          "INSERT INTO sensor_readings (plant_id, moisture_pct, source, recorded_at) VALUES (?, 70, 'manual', datetime('now', '+1 hour'))"
        )
        .run(plant.id);
      const results = getAllSensorReadings();
      const readings = results.filter((r) => r.plant_id === plant.id);
      expect(readings[0]?.moisture_pct).toBe(70);
      expect(readings[1]?.moisture_pct).toBe(30);
    });

    it('includes moisture threshold fields from the plant', () => {
      const plant = insertPlant('Succulent', undefined, undefined, undefined, 15, 40);
      logSensorReading(plant.id, 25);
      const results = getAllSensorReadings();
      expect(results[0]?.moisture_threshold_pct).toBe(15);
      expect(results[0]?.moisture_upper_threshold_pct).toBe(40);
    });
  });

  describe('getAllPlantsWithMoistureStats', () => {
    it('returns all plants with null stats when no readings exist', () => {
      insertPlant('Cactus');
      const stats = getAllPlantsWithMoistureStats();
      expect(stats).toHaveLength(1);
      expect(stats[0]?.reading_count).toBe(0);
      expect(stats[0]?.avg_moisture).toBeNull();
      expect(stats[0]?.min_moisture).toBeNull();
      expect(stats[0]?.max_moisture).toBeNull();
    });

    it('returns correct avg, min, max for a plant with readings', () => {
      const plant = insertPlant('Basil');
      logSensorReading(plant.id, 20);
      logSensorReading(plant.id, 40);
      logSensorReading(plant.id, 60);
      const stats = getAllPlantsWithMoistureStats();
      const row = stats.find((s) => s.id === plant.id);
      expect(row).toBeDefined();
      if (!row) return;
      expect(row.reading_count).toBe(3);
      expect(row.avg_moisture).toBe(40);
      expect(row.min_moisture).toBe(20);
      expect(row.max_moisture).toBe(60);
    });

    it('includes all plants regardless of whether they have readings', () => {
      insertPlant('No Readings');
      const plantB = insertPlant('Has Readings');
      logSensorReading(plantB.id, 50);
      const stats = getAllPlantsWithMoistureStats();
      expect(stats).toHaveLength(2);
    });
  });

  describe('getPlantsOverwatered', () => {
    it('returns empty array when no plants have readings', () => {
      insertPlant('Cactus');
      expect(getPlantsOverwatered()).toEqual([]);
    });

    it('returns a plant whose latest reading exceeds the upper threshold', () => {
      const plant = insertPlant('Fern', undefined, undefined, undefined, 30, 85);
      logSensorReading(plant.id, 90); // above 85%
      const overwatered = getPlantsOverwatered();
      expect(overwatered.some((p) => p.id === plant.id)).toBe(true);
    });

    it('excludes a plant whose latest reading is at or below the upper threshold', () => {
      const plant = insertPlant('Succulent', undefined, undefined, undefined, 30, 85);
      logSensorReading(plant.id, 85); // at threshold, not above
      const overwatered = getPlantsOverwatered();
      expect(overwatered.some((p) => p.id === plant.id)).toBe(false);
    });

    it('excludes a plant with no sensor readings', () => {
      const plant = insertPlant('Orchid');
      const overwatered = getPlantsOverwatered();
      expect(overwatered.some((p) => p.id === plant.id)).toBe(false);
    });
  });

  describe('devices', () => {
    it('assigns a device to a plant', () => {
      const plant = insertPlant('Monstera');
      const device = assignDevice('living-room', plant.id);
      expect(device.device_id).toBe('living-room');
      expect(device.plant_id).toBe(plant.id);
      expect(device.name).toBeNull();
    });

    it('assigns a device with an optional name', () => {
      const plant = insertPlant('Fern');
      const device = assignDevice('bedroom', plant.id, 'Fern sensor');
      expect(device.name).toBe('Fern sensor');
    });

    it('reassigns a device to a different plant (upsert)', () => {
      const p1 = insertPlant('Rose');
      const p2 = insertPlant('Cactus');
      assignDevice('living-room', p1.id);
      const updated = assignDevice('living-room', p2.id);
      expect(updated.plant_id).toBe(p2.id);
    });

    it('getDevice returns the device', () => {
      const plant = insertPlant('Ficus');
      assignDevice('kitchen', plant.id);
      const d = getDevice('kitchen');
      expect(d).toBeDefined();
      expect(d?.plant_id).toBe(plant.id);
    });

    it('getDevice returns undefined for unknown device', () => {
      expect(getDevice('unknown-device')).toBeUndefined();
    });

    it('listDevices returns all assignments with plant name', () => {
      const p1 = insertPlant('Aloe');
      const p2 = insertPlant('Pothos');
      assignDevice('room-a', p1.id);
      assignDevice('room-b', p2.id);
      const devices = listDevices();
      expect(devices).toHaveLength(2);
      expect(devices.map((d) => d.device_id).sort()).toEqual(['room-a', 'room-b']);
      expect(devices.find((d) => d.device_id === 'room-a')?.plant_name).toBe('Aloe');
    });

    it('unassigns a device', () => {
      const plant = insertPlant('Succulent');
      assignDevice('office', plant.id);
      const removed = unassignDevice('office');
      expect(removed).toBe(true);
      expect(getDevice('office')).toBeUndefined();
    });

    it('unassignDevice returns false for unknown device', () => {
      expect(unassignDevice('nonexistent')).toBe(false);
    });
  });

  describe('channel mappings', () => {
    beforeEach(() => {
      getDb().exec('DELETE FROM channel_mappings');
    });

    it('maps a channel and retrieves it', () => {
      const m = mapChannel('living-room', 0, 'monstera');
      expect(m.device_id).toBe('living-room');
      expect(m.channel).toBe(0);
      expect(m.sensor_name).toBe('monstera');
    });

    it('upserts on conflict — same device and channel', () => {
      mapChannel('living-room', 0, 'monstera');
      const m = mapChannel('living-room', 0, 'pothos');
      expect(m.sensor_name).toBe('pothos');
      expect(listChannelMappings('living-room')).toHaveLength(1);
    });

    it('lists all mappings for a device ordered by channel', () => {
      mapChannel('living-room', 2, 'aloe-vera');
      mapChannel('living-room', 0, 'monstera');
      mapChannel('living-room', 1, 'basil');
      const mappings = listChannelMappings('living-room');
      expect(mappings.map((m) => m.channel)).toEqual([0, 1, 2]);
    });

    it('lists all mappings across devices when no device_id given', () => {
      mapChannel('living-room', 0, 'monstera');
      mapChannel('bedroom', 0, 'cactus');
      expect(listChannelMappings()).toHaveLength(2);
    });

    it('unmaps a channel', () => {
      mapChannel('living-room', 0, 'monstera');
      expect(unmapChannel('living-room', 0)).toBe(true);
      expect(listChannelMappings('living-room')).toHaveLength(0);
    });

    it('unmapChannel returns false for unknown mapping', () => {
      expect(unmapChannel('living-room', 5)).toBe(false);
    });

    it('getChannelMappingsForDevice returns a channel→name record', () => {
      mapChannel('living-room', 0, 'monstera');
      mapChannel('living-room', 1, 'basil');
      const record = getChannelMappingsForDevice('living-room');
      expect(record).toEqual({ '0': 'monstera', '1': 'basil' });
    });

    it('getChannelMappingsForDevice returns empty object when no mappings', () => {
      expect(getChannelMappingsForDevice('unknown-device')).toEqual({});
    });
  });
});
