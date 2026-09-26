import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const file = process.env.DB_FILE ?? 'data/poker.db';
if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });

export const db = new DatabaseSync(file);

const now = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS players (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT ${now}
  );

  CREATE TABLE IF NOT EXISTS games (
    id         INTEGER PRIMARY KEY,
    buy_in     INTEGER NOT NULL CHECK (buy_in > 0),
    status     TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'closed')),
    started_at TEXT NOT NULL DEFAULT ${now},
    closed_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS game_players (
    game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id   INTEGER NOT NULL REFERENCES players(id),
    final_stack INTEGER,
    PRIMARY KEY (game_id, player_id)
  );

  -- Every buy-in and cash-out moves exactly one games.buy_in. 'initial' marks the opening buy-ins.
  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY,
    game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id  INTEGER NOT NULL REFERENCES players(id),
    type       TEXT NOT NULL CHECK (type IN ('buyin', 'cashout')),
    initial    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ${now}
  );
  CREATE INDEX IF NOT EXISTS events_game ON events (game_id, player_id);
`);

// Migrations for databases created by earlier versions.
const playerColumns = (db.prepare('PRAGMA table_info(players)').all() as { name: string }[]).map((c) => c.name);
if (!playerColumns.includes('archived')) {
  db.exec('ALTER TABLE players ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
