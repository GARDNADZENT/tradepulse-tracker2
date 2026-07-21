const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'traderspulse.db');

function ensureDataDir() {
  const fs = require('fs');
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

let db = null;

function getDb() {
  if (!db) {
    ensureDataDir();
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    migrate(db);
  }
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS journeys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_loginid TEXT NOT NULL,
      initial_balance REAL NOT NULL,
      daily_target_pct REAL NOT NULL,
      cycle_length_days INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_loginid)
    );

    CREATE TABLE IF NOT EXISTS journey_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      journey_id INTEGER NOT NULL,
      day_number INTEGER NOT NULL,
      date TEXT NOT NULL,
      expected_start REAL NOT NULL,
      expected_end REAL NOT NULL,
      actual_balance REAL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE CASCADE,
      UNIQUE(journey_id, day_number)
    );

    CREATE TABLE IF NOT EXISTS contract_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_loginid TEXT NOT NULL,
      account_type TEXT NOT NULL,
      contract_id TEXT,
      contract_type TEXT,
      profit REAL,
      date_expiry INTEGER,
      purchase_time INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
