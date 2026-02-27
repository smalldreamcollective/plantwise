// Must be set before any call to getDb() — DB_PATH is read lazily inside getDb()
process.env['DB_PATH'] = ':memory:';

import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from './schema';
import {
  getHealthChecksForPlant,
  getLastCareEvent,
  getPlantWithWatering,
  getPlantsOverdueForWatering,
  insertHealthCheck,
  insertPlant,
  listPlants,
  logCareEvent,
  removePlant,
} from './queries';

describe('DB queries', () => {
  beforeEach(() => {
    const db = getDb();
    db.exec('DELETE FROM care_events; DELETE FROM health_checks; DELETE FROM plants;');
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
  });
});
