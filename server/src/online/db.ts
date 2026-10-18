import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// The online section keeps its own SQLite file and never opens Poker Bank's database.
function defaultFile(): string {
  const main = process.env.DB_FILE ?? 'data/poker.db';
  return main === ':memory:' ? ':memory:' : join(dirname(main), 'online.db');
}

export const ONLINE_DB_FILE = process.env.ONLINE_DB_FILE ?? defaultFile();

if (ONLINE_DB_FILE !== ':memory:') {
  if (resolve(ONLINE_DB_FILE) === resolve(process.env.DB_FILE ?? 'data/poker.db')) {
    throw new Error('ONLINE_DB_FILE must not be the Poker Bank database');
  }
  mkdirSync(dirname(ONLINE_DB_FILE), { recursive: true });
}

export const odb = new DatabaseSync(ONLINE_DB_FILE);

const now = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

odb.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS accounts (
    id         INTEGER PRIMARY KEY,
    username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password   TEXT NOT NULL,
    avatar     TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${now}
  );

  -- Only a hash of the session token is stored.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${now}
  );

  CREATE TABLE IF NOT EXISTS tables (
    id         INTEGER PRIMARY KEY,
    code       TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    host_id    INTEGER NOT NULL REFERENCES accounts(id),
    mode       TEXT NOT NULL CHECK (mode IN ('cash', 'fun')),
    sb         INTEGER NOT NULL CHECK (sb > 0),
    bb         INTEGER NOT NULL CHECK (bb >= sb),
    buy_in     INTEGER NOT NULL CHECK (buy_in > 0),
    max_seats  INTEGER NOT NULL CHECK (max_seats BETWEEN 2 AND 9),
    status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    started    INTEGER NOT NULL DEFAULT 0,
    button     INTEGER,
    hand_no    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ${now},
    closed_at  TEXT
  );

  -- Stacks are written between hands only, so after a restart a running hand is simply void.
  CREATE TABLE IF NOT EXISTS seats (
    table_id    INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
    seat        INTEGER NOT NULL,
    account_id  INTEGER NOT NULL REFERENCES accounts(id),
    stack       INTEGER NOT NULL CHECK (stack >= 0),
    sitting_out INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (table_id, seat),
    UNIQUE (table_id, account_id)
  );

  -- Money (or chips) brought to and taken from a table. Result = cash-outs − buy-ins.
  CREATE TABLE IF NOT EXISTS ledger (
    id         INTEGER PRIMARY KEY,
    table_id   INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    type       TEXT NOT NULL CHECK (type IN ('buyin', 'cashout')),
    amount     INTEGER NOT NULL CHECK (amount >= 0),
    created_at TEXT NOT NULL DEFAULT ${now}
  );
  CREATE INDEX IF NOT EXISTS ledger_table ON ledger (table_id, account_id);

  CREATE TABLE IF NOT EXISTS hands (
    id         INTEGER PRIMARY KEY,
    table_id   INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
    hand_no    INTEGER NOT NULL,
    data       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${now}
  );

  CREATE TABLE IF NOT EXISTS hand_players (
    hand_id    INTEGER NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    net        INTEGER NOT NULL,
    vpip       INTEGER NOT NULL,
    PRIMARY KEY (hand_id, account_id)
  );
`);

export function otx<T>(fn: () => T): T {
  odb.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    odb.exec('COMMIT');
    return result;
  } catch (err) {
    odb.exec('ROLLBACK');
    throw err;
  }
}
