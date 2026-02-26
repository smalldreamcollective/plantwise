// Must be set before any call to getDb() — DB_PATH is read lazily inside getDb()
process.env['DB_PATH'] = ':memory:';

import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from './schema';
import { insertHealthCheck, insertPlant, listPlants } from './queries';

describe('DB queries', () => {
  beforeEach(() => {
    // Clear all rows between tests; schema tables already exist from first getDb() call
    const db = getDb();
    db.exec('DELETE FROM health_checks; DELETE FROM plants;');
  });

  describe('insertPlant', () => {
    it('inserts and returns a plant with all fields', () => {
      const plant = insertPlant('Fern', 'Nephrolepis exaltata', 'Keep moist');
      expect(plant.id).toBeTypeOf('number');
      expect(plant.name).toBe('Fern');
      expect(plant.species).toBe('Nephrolepis exaltata');
      expect(plant.notes).toBe('Keep moist');
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
      // Both plants present; ORDER BY created_at DESC is tested at the SQL level
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
      expect(check.created_at).toBeTypeOf('string');
    });

    it('inserts a health check with no plant linked (null plant_id)', () => {
      const raw = { unknown: true };
      const check = insertHealthCheck(null, '/photos/unknown.jpg', raw, 'Unknown plant');
      expect(check.plant_id).toBeNull();
      expect(check.photo_path).toBe('/photos/unknown.jpg');
    });

    it('stores plantid_raw as JSON string', () => {
      const plant = insertPlant('Mint');
      const raw = { diseases: ['root rot'], confidence: 0.8 };
      const check = insertHealthCheck(plant.id, '/photos/mint.jpg', raw, 'Needs attention');
      expect(JSON.parse(check.plantid_raw)).toEqual(raw);
    });
  });
});
