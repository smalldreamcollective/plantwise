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

    CREATE TABLE IF NOT EXISTS watering_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
      watered_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrate existing DBs: add watering_interval_days if not already present
  try {
    db.exec('ALTER TABLE plants ADD COLUMN watering_interval_days INTEGER DEFAULT 7');
  } catch {
    // Column already exists — expected for any DB that has run this schema before
  }
}
