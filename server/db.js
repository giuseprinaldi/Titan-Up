import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export const newId = (bytes = 8) => randomBytes(bytes).toString('base64url');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS retros (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  template TEXT NOT NULL,
  columns TEXT NOT NULL,
  phase TEXT NOT NULL,
  review_enabled INTEGER NOT NULL DEFAULT 0,
  votes_per_person INTEGER NOT NULL DEFAULT 5,
  facilitator_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  current_topic_id TEXT,
  timer_ends_at INTEGER,
  timer_duration INTEGER,
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS retros_team ON retros(team_id, created_at);
CREATE TABLE IF NOT EXISTS retro_participants (
  retro_id TEXT NOT NULL REFERENCES retros(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (retro_id, user_id)
);
CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  retro_id TEXT NOT NULL REFERENCES retros(id) ON DELETE CASCADE,
  column_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL,
  discussed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS topics_retro ON topics(retro_id);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  retro_id TEXT NOT NULL REFERENCES retros(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_retro ON notes(retro_id);
CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  retro_id TEXT NOT NULL REFERENCES retros(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS votes_retro ON votes(retro_id);
CREATE TABLE IF NOT EXISTS action_items (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  retro_id TEXT REFERENCES retros(id) ON DELETE SET NULL,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  done_at INTEGER
);
CREATE INDEX IF NOT EXISTS actions_team ON action_items(team_id);
CREATE TABLE IF NOT EXISTS radars (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  dimensions TEXT NOT NULL,
  phase TEXT NOT NULL,
  facilitator_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS radars_team ON radars(team_id, created_at);
CREATE TABLE IF NOT EXISTS radar_participants (
  radar_id TEXT NOT NULL REFERENCES radars(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (radar_id, user_id)
);
CREATE TABLE IF NOT EXISTS radar_ratings (
  radar_id TEXT NOT NULL REFERENCES radars(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  dim INTEGER NOT NULL,
  value INTEGER NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (radar_id, user_id, dim)
);
`;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);

  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) cache.set(sql, (s = db.prepare(sql)));
    return s;
  };

  return {
    raw: db,
    get: (sql, ...p) => stmt(sql).get(...p),
    all: (sql, ...p) => stmt(sql).all(...p),
    run: (sql, ...p) => stmt(sql).run(...p),
    /** Run fn inside a transaction; rolls back if it throws. */
    tx(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    close: () => db.close(),
  };
}

/** An error whose message is safe and useful to show to the person who caused it. */
export class OpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function cleanText(value, max, { required = true, what = 'Text' } = {}) {
  const text = typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
  if (!text && required) throw new OpError(`${what} can't be empty.`);
  if (text.length > max) throw new OpError(`${what} is too long (max ${max} characters).`);
  return text;
}
