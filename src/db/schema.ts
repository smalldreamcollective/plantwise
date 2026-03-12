import Database from 'better-sqlite3';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    const dbPath = process.env['DB_PATH'] ?? './plantwise.db';
    _db = new Database(path.resolve(dbPath));
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      species TEXT,
      notes TEXT,
      watering_interval_days INTEGER DEFAULT 7,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS health_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plant_id INTEGER REFERENCES plants(id),
      photo_path TEXT NOT NULL,
      plantid_raw TEXT NOT NULL,
      diagnosis TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS care_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      notes TEXT,
      occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sensor_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
      moisture_pct INTEGER NOT NULL CHECK (moisture_pct BETWEEN 0 AND 100),
      source TEXT NOT NULL DEFAULT 'manual',
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY,
      plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
      name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrate existing DBs: add watering_interval_days if not already present
  try {
    db.exec('ALTER TABLE plants ADD COLUMN watering_interval_days INTEGER DEFAULT 7');
  } catch {
    // Column already exists — expected for any DB that has run this schema before
  }

  // Migrate existing DBs: add moisture_threshold_pct if not already present
  try {
    db.exec('ALTER TABLE plants ADD COLUMN moisture_threshold_pct INTEGER DEFAULT 30');
  } catch {
    // Column already exists
  }

  // Migrate existing DBs: add moisture_upper_threshold_pct if not already present
  try {
    db.exec('ALTER TABLE plants ADD COLUMN moisture_upper_threshold_pct INTEGER DEFAULT 85');
  } catch {
    // Column already exists
  }

  // One-time migration: copy watering_logs → care_events, then drop the old table
  // Silently fails on fresh installs (watering_logs won't exist)
  try {
    db.exec(`
      INSERT INTO care_events (plant_id, type, notes, occurred_at)
      SELECT plant_id, 'water', NULL, watered_at FROM watering_logs
    `);
    db.exec('DROP TABLE IF EXISTS watering_logs');
  } catch {
    // watering_logs doesn't exist — fresh install or already migrated
  }
}
