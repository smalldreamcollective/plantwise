// Must be set before any call to getDb() — DB_PATH is read lazily inside getDb()
process.env['DB_PATH'] = ':memory:';

import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from './schema';
import {
  getAllPlantsWithLatestReading,
  getHealthChecksForPlant,
  getLastCareEvent,
  getLatestSensorReading,
  getPlant,
  getPlantWithWatering,
  getPlantsOverdueForWatering,
  getSensorReadings,
  insertHealthCheck,
  insertPlant,
  listPlants,
  logCareEvent,
  logSensorReading,
  removePlant,
  updatePlant,
} from './queries';

describe('DB queries', () => {
  beforeEach(() => {
    const db = getDb();
    db.exec(
      'DELETE FROM sensor_readings; DELETE FROM care_events; DELETE FROM health_checks; DELETE FROM plants;'
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
});
