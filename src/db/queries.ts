import { getDb } from './schema';

export interface Plant {
  id: number;
  name: string;
  species: string | null;
  notes: string | null;
  watering_interval_days: number;
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

export interface CareEvent {
  id: number;
  plant_id: number;
  type: string;
  notes: string | null;
  occurred_at: string;
}

export interface PlantWithWatering extends Plant {
  last_watered_at: string | null;
  days_since_watered: number | null;
}

// ── Plants ────────────────────────────────────────────────────────────────────

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

export function removePlant(id: number): boolean {
  const db = getDb();
  const deleteAll = db.transaction((plantId: number) => {
    // health_checks has no ON DELETE CASCADE so must be deleted explicitly
    db.prepare('DELETE FROM health_checks WHERE plant_id = ?').run(plantId);
    // care_events has ON DELETE CASCADE but deleting explicitly is harmless
    db.prepare('DELETE FROM care_events WHERE plant_id = ?').run(plantId);
    const result = db.prepare('DELETE FROM plants WHERE id = ?').run(plantId);
    return result.changes > 0;
  });
  return deleteAll(id) as boolean;
}

// ── Health checks ─────────────────────────────────────────────────────────────

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

// ── Care events ───────────────────────────────────────────────────────────────

export function logCareEvent(plantId: number, type: string, notes?: string): CareEvent {
  const db = getDb();
  return db
    .prepare('INSERT INTO care_events (plant_id, type, notes) VALUES (?, ?, ?) RETURNING *')
    .get(plantId, type, notes ?? null) as CareEvent;
}

export function getLastCareEvent(plantId: number, type: string): CareEvent | undefined {
  const db = getDb();
  return db
    .prepare(
      'SELECT * FROM care_events WHERE plant_id = ? AND type = ? ORDER BY occurred_at DESC LIMIT 1'
    )
    .get(plantId, type) as CareEvent | undefined;
}

const PLANT_WITH_WATERING_SQL = `
  SELECT
    p.*,
    wl.last_watered_at,
    CASE
      WHEN wl.last_watered_at IS NULL THEN NULL
      ELSE CAST(julianday('now') - julianday(wl.last_watered_at) AS INTEGER)
    END AS days_since_watered
  FROM plants p
  LEFT JOIN (
    SELECT plant_id, MAX(occurred_at) AS last_watered_at
    FROM care_events
    WHERE type = 'water'
    GROUP BY plant_id
  ) wl ON p.id = wl.plant_id
`;

export function getPlantWithWatering(id: number): PlantWithWatering | undefined {
  const db = getDb();
  return db.prepare(`${PLANT_WITH_WATERING_SQL} WHERE p.id = ?`).get(id) as
    | PlantWithWatering
    | undefined;
}

export function getPlantsOverdueForWatering(): PlantWithWatering[] {
  const db = getDb();
  return db
    .prepare(
      `${PLANT_WITH_WATERING_SQL}
      WHERE
        wl.last_watered_at IS NULL
        OR (julianday('now') - julianday(wl.last_watered_at)) >= p.watering_interval_days
      ORDER BY
        CASE WHEN wl.last_watered_at IS NULL THEN 1 ELSE 0 END DESC,
        (julianday('now') - julianday(wl.last_watered_at)) DESC`
    )
    .all() as PlantWithWatering[];
}
