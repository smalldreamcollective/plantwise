import { getDb } from './schema';

export interface Plant {
  id: number;
  name: string;
  species: string | null;
  notes: string | null;
  created_at: string;
}

export interface HealthCheck {
  id: number;
  plant_id: number | null;
  photo_path: string;
  plantid_raw: string;
  diagnosis: string;
  created_at: string;
}

export function insertPlant(name: string, species?: string, notes?: string): Plant {
  const db = getDb();
  const stmt = db.prepare('INSERT INTO plants (name, species, notes) VALUES (?, ?, ?) RETURNING *');
  return stmt.get(name, species ?? null, notes ?? null) as Plant;
}

export function getPlant(id: number): Plant | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM plants WHERE id = ?').get(id) as Plant | undefined;
}

export function listPlants(): Plant[] {
  const db = getDb();
  return db.prepare('SELECT * FROM plants ORDER BY created_at DESC').all() as Plant[];
}

export function insertHealthCheck(
  plantId: number | null,
  photoPath: string,
  plantidRaw: object,
  diagnosis: string
): HealthCheck {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT INTO health_checks (plant_id, photo_path, plantid_raw, diagnosis) VALUES (?, ?, ?, ?) RETURNING *'
  );
  return stmt.get(plantId, photoPath, JSON.stringify(plantidRaw), diagnosis) as HealthCheck;
}

export function getHealthChecksForPlant(plantId: number): HealthCheck[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM health_checks WHERE plant_id = ? ORDER BY created_at DESC')
    .all(plantId) as HealthCheck[];
}

export function listRecentHealthChecks(limit = 10): HealthCheck[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM health_checks ORDER BY created_at DESC LIMIT ?')
    .all(limit) as HealthCheck[];
}
