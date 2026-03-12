import { getDb } from './schema';

export interface Plant {
  id: number;
  name: string;
  species: string | null;
  notes: string | null;
  watering_interval_days: number;
  moisture_threshold_pct: number;
  moisture_upper_threshold_pct: number;
  created_at: string;
}

export interface SensorReading {
  id: number;
  plant_id: number;
  moisture_pct: number;
  source: string;
  recorded_at: string;
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

export interface Device {
  device_id: string;
  plant_id: number;
  name: string | null;
  created_at: string;
}

export interface PlantWithWatering extends Plant {
  last_watered_at: string | null;
  days_since_watered: number | null;
}

// ── Plants ────────────────────────────────────────────────────────────────────

export function insertPlant(
  name: string,
  species?: string,
  notes?: string,
  wateringIntervalDays?: number,
  moistureThresholdPct?: number,
  moistureUpperThresholdPct?: number
): Plant {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO plants (name, species, notes, watering_interval_days, moisture_threshold_pct, moisture_upper_threshold_pct)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
  );
  return stmt.get(
    name,
    species ?? null,
    notes ?? null,
    wateringIntervalDays ?? 7,
    moistureThresholdPct ?? 30,
    moistureUpperThresholdPct ?? 85
  ) as Plant;
}

export function getPlant(id: number): Plant | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM plants WHERE id = ?').get(id) as Plant | undefined;
}

export function listPlants(): Plant[] {
  const db = getDb();
  return db.prepare('SELECT * FROM plants ORDER BY created_at DESC').all() as Plant[];
}

export interface PlantUpdates {
  name?: string;
  species?: string;
  notes?: string;
  watering_interval_days?: number;
  moisture_threshold_pct?: number;
  moisture_upper_threshold_pct?: number;
}

export function updatePlant(id: number, updates: PlantUpdates): Plant | undefined {
  const db = getDb();
  const fields = Object.keys(updates) as (keyof PlantUpdates)[];
  if (fields.length === 0) return getPlant(id);
  const setClauses = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => updates[f]);
  return db
    .prepare(`UPDATE plants SET ${setClauses} WHERE id = ? RETURNING *`)
    .get(...values, id) as Plant | undefined;
}

export function removePlant(id: number): boolean {
  const db = getDb();
  const deleteAll = db.transaction((plantId: number) => {
    // health_checks has no ON DELETE CASCADE so must be deleted explicitly
    db.prepare('DELETE FROM health_checks WHERE plant_id = ?').run(plantId);
    // care_events + sensor_readings have ON DELETE CASCADE but deleting explicitly is harmless
    db.prepare('DELETE FROM care_events WHERE plant_id = ?').run(plantId);
    db.prepare('DELETE FROM sensor_readings WHERE plant_id = ?').run(plantId);
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
  // A plant is NOT overdue if it has a fresh sensor reading (≤24h) at or above threshold.
  // Otherwise fall back to time-based logic.
  return db
    .prepare(
      `${PLANT_WITH_WATERING_SQL}
      LEFT JOIN (
        SELECT sr.plant_id, sr.moisture_pct, sr.recorded_at
        FROM sensor_readings sr
        INNER JOIN (
          SELECT plant_id, MAX(recorded_at) AS latest
          FROM sensor_readings
          GROUP BY plant_id
        ) latest_sr ON sr.plant_id = latest_sr.plant_id AND sr.recorded_at = latest_sr.latest
      ) sr ON p.id = sr.plant_id
      WHERE
        CASE
          -- Fresh sensor reading exists and moisture is below threshold → overdue
          WHEN sr.moisture_pct IS NOT NULL
            AND (julianday('now') - julianday(sr.recorded_at)) <= 1
            THEN sr.moisture_pct < p.moisture_threshold_pct
          -- No fresh sensor: fall back to time-based
          ELSE
            wl.last_watered_at IS NULL
            OR (julianday('now') - julianday(wl.last_watered_at)) >= p.watering_interval_days
        END
      ORDER BY
        CASE WHEN wl.last_watered_at IS NULL THEN 1 ELSE 0 END DESC,
        (julianday('now') - julianday(wl.last_watered_at)) DESC`
    )
    .all() as PlantWithWatering[];
}

export function getPlantsOverwatered(): Plant[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.*
       FROM plants p
       INNER JOIN (
         SELECT sr.plant_id, sr.moisture_pct
         FROM sensor_readings sr
         INNER JOIN (
           SELECT plant_id, MAX(recorded_at) AS latest
           FROM sensor_readings
           GROUP BY plant_id
         ) latest_sr ON sr.plant_id = latest_sr.plant_id AND sr.recorded_at = latest_sr.latest
         WHERE (julianday('now') - julianday(latest_sr.latest)) <= 1
       ) recent ON p.id = recent.plant_id
       WHERE recent.moisture_pct > p.moisture_upper_threshold_pct
       ORDER BY recent.moisture_pct DESC`
    )
    .all() as Plant[];
}

// ── Sensor readings ───────────────────────────────────────────────────────────

export function logSensorReading(
  plantId: number,
  moisturePct: number,
  source: string = 'manual'
): SensorReading {
  const db = getDb();
  return db
    .prepare(
      'INSERT INTO sensor_readings (plant_id, moisture_pct, source) VALUES (?, ?, ?) RETURNING *'
    )
    .get(plantId, moisturePct, source) as SensorReading;
}

export function getLatestSensorReading(plantId: number): SensorReading | undefined {
  const db = getDb();
  return db
    .prepare('SELECT * FROM sensor_readings WHERE plant_id = ? ORDER BY recorded_at DESC LIMIT 1')
    .get(plantId) as SensorReading | undefined;
}

export function getSensorReadings(plantId: number, limit = 100): SensorReading[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM sensor_readings WHERE plant_id = ? ORDER BY recorded_at DESC LIMIT ?')
    .all(plantId, limit) as SensorReading[];
}

export interface PlantMoistureStats {
  id: number;
  name: string;
  moisture_threshold_pct: number;
  moisture_upper_threshold_pct: number;
  avg_moisture: number | null;
  min_moisture: number | null;
  max_moisture: number | null;
  reading_count: number;
}

export function getAllPlantsWithMoistureStats(): PlantMoistureStats[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT
        p.id,
        p.name,
        p.moisture_threshold_pct,
        p.moisture_upper_threshold_pct,
        ROUND(AVG(sr.moisture_pct)) AS avg_moisture,
        MIN(sr.moisture_pct)        AS min_moisture,
        MAX(sr.moisture_pct)        AS max_moisture,
        COUNT(sr.id)                AS reading_count
       FROM plants p
       LEFT JOIN sensor_readings sr ON p.id = sr.plant_id
       GROUP BY p.id
       ORDER BY p.name ASC`
    )
    .all() as PlantMoistureStats[];
}

// ── Devices ───────────────────────────────────────────────────────────────────

export function assignDevice(deviceId: string, plantId: number, name?: string): Device {
  const db = getDb();
  return db
    .prepare(
      `INSERT INTO devices (device_id, plant_id, name)
       VALUES (?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET plant_id = excluded.plant_id, name = excluded.name
       RETURNING *`
    )
    .get(deviceId, plantId, name ?? null) as Device;
}

export function unassignDevice(deviceId: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM devices WHERE device_id = ?').run(deviceId).changes > 0;
}

export function getDevice(deviceId: string): Device | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId) as
    | Device
    | undefined;
}

export function listDevices(): (Device & { plant_name: string })[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT d.*, p.name AS plant_name
       FROM devices d
       JOIN plants p ON d.plant_id = p.id
       ORDER BY d.device_id ASC`
    )
    .all() as (Device & { plant_name: string })[];
}

export function getAllPlantsWithLatestReading(): (Plant & {
  moisture_pct: number | null;
  recorded_at: string | null;
})[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.*,
        sr.moisture_pct,
        sr.recorded_at
       FROM plants p
       LEFT JOIN (
         SELECT sr2.plant_id, sr2.moisture_pct, sr2.recorded_at
         FROM sensor_readings sr2
         INNER JOIN (
           SELECT plant_id, MAX(recorded_at) AS latest
           FROM sensor_readings
           GROUP BY plant_id
         ) m ON sr2.plant_id = m.plant_id AND sr2.recorded_at = m.latest
       ) sr ON p.id = sr.plant_id
       ORDER BY p.name ASC`
    )
    .all() as (Plant & { moisture_pct: number | null; recorded_at: string | null })[];
}
