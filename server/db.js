import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = process.env.DECK_DB || resolve(ROOT, 'data', 'deck.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/* --------------------------------------------------------------------------
   Schema. Every migration is additive and idempotent, so start-up is safe to
   run against an existing database.
   -------------------------------------------------------------------------- */
const MIGRATIONS = [
  {
    id: '001-core',
    sql: `
    CREATE TABLE courses (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      credits             REAL NOT NULL DEFAULT 0,
      assessment          TEXT NOT NULL DEFAULT 'Exam',
      date_state          TEXT NOT NULL DEFAULT 'tbd',
      exam_date           TEXT,
      estimated_date      TEXT,
      subject_area        TEXT,
      prep_estimate_hours REAL NOT NULL DEFAULT 0,
      position            INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL,
      CHECK (date_state IN ('confirmed','tbd','none')),
      CHECK (date_state <> 'confirmed' OR exam_date IS NOT NULL)
    );

    CREATE TABLE topics (
      id        TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      name      TEXT NOT NULL,
      done      INTEGER NOT NULL DEFAULT 0,
      position  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_topics_course ON topics(course_id, position);

    CREATE TABLE deliverables (
      id         TEXT PRIMARY KEY,
      course_id  TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      kind       TEXT NOT NULL DEFAULT 'assignment',
      due_date   TEXT,
      est_hours  REAL NOT NULL DEFAULT 0,
      submitted  INTEGER NOT NULL DEFAULT 0,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_deliv_course ON deliverables(course_id, position);
    CREATE INDEX idx_deliv_due ON deliverables(due_date);

    CREATE TABLE sessions (
      id             TEXT PRIMARY KEY,
      course_id      TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      deliverable_id TEXT REFERENCES deliverables(id) ON DELETE SET NULL,
      on_date        TEXT NOT NULL,
      minutes        INTEGER NOT NULL,
      note           TEXT,
      created_at     TEXT NOT NULL,
      CHECK (minutes > 0)
    );
    CREATE INDEX idx_sessions_course ON sessions(course_id, on_date);
    CREATE INDEX idx_sessions_date ON sessions(on_date);

    CREATE TABLE capacity (
      weekday INTEGER PRIMARY KEY,
      hours   REAL NOT NULL DEFAULT 0,
      CHECK (weekday BETWEEN 0 AND 6)
    );

    CREATE TABLE capacity_overrides (
      on_date TEXT PRIMARY KEY,
      hours   REAL NOT NULL,
      reason  TEXT
    );

    CREATE TABLE settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE activity (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      at        TEXT NOT NULL,
      kind      TEXT NOT NULL,
      summary   TEXT NOT NULL,
      entity    TEXT,
      entity_id TEXT,
      undo      TEXT
    );
    CREATE INDEX idx_activity_at ON activity(at DESC);
    `
  }
];

db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);

export function migrate() {
  const done = new Set(db.prepare('SELECT id FROM schema_migrations').all().map(r => r.id));
  const applied = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(m.id, new Date().toISOString());
      db.exec('COMMIT');
      applied.push(m.id);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${m.id} failed: ${e.message}`);
    }
  }
  return applied;
}

/* Run migrations at module load: importers prepare statements at their own
   module top level, and ESM evaluates those before any caller's first line. */
export const appliedMigrations = migrate();

/* --------------------------------------------------------------------------
   Settings — stored as JSON scalars so booleans and arrays survive a round trip
   -------------------------------------------------------------------------- */
export const DEFAULT_SETTINGS = {
  semester: 'Winter semester 2026/27',
  reserveShare: 0.25,       // share of each day the nearest deadline may not take
  clusterWindow: 14,        // days — exams closer than this chain into one period
  clusterMin: 3,            // exams in a chain before it counts as high density
  tightGap: 2,              // days between exams that counts as a clash
  examReminders: [30, 14, 7, 3, 1],
  workReminders: [7, 3, 1],
  dayStartHour: 18          // used only to stamp ICS reminder times
};

export const DEFAULT_CAPACITY = [3, 3, 3, 3, 2, 4, 3]; // Mon…Sun

export function readSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

export function writeSettings(patch) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    stmt.run(k, JSON.stringify(v));
  }
  return readSettings();
}

export function readCapacity() {
  const rows = db.prepare('SELECT weekday, hours FROM capacity ORDER BY weekday').all();
  const out = [...DEFAULT_CAPACITY];
  for (const r of rows) out[r.weekday] = r.hours;
  return out;
}

export function writeCapacity(hoursByWeekday) {
  const stmt = db.prepare('INSERT INTO capacity (weekday, hours) VALUES (?, ?) ON CONFLICT(weekday) DO UPDATE SET hours = excluded.hours');
  hoursByWeekday.forEach((h, i) => stmt.run(i, Math.max(0, Math.min(16, Number(h) || 0))));
  return readCapacity();
}

export function readOverrides() {
  return db.prepare('SELECT on_date AS date, hours, reason FROM capacity_overrides ORDER BY on_date').all();
}

/* --------------------------------------------------------------------------
   Activity log — also the undo source
   -------------------------------------------------------------------------- */
export function logActivity({ kind, summary, entity = null, entityId = null, undo = null }) {
  const info = db.prepare(
    'INSERT INTO activity (at, kind, summary, entity, entity_id, undo) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(new Date().toISOString(), kind, summary, entity, entityId, undo ? JSON.stringify(undo) : null);
  // keep the log bounded
  db.exec('DELETE FROM activity WHERE id <= (SELECT MAX(id) - 500 FROM activity)');
  return Number(info.lastInsertRowid);
}

export function readActivity(limit = 40) {
  return db.prepare('SELECT id, at, kind, summary, entity, entity_id AS entityId, undo FROM activity ORDER BY id DESC LIMIT ?')
    .all(Math.min(200, Math.max(1, limit)))
    .map(r => ({ ...r, undo: r.undo ? JSON.parse(r.undo) : null, undoable: !!r.undo }));
}

export const nowIso = () => new Date().toISOString();
export const newId = prefix => prefix + Math.random().toString(36).slice(2, 10);
