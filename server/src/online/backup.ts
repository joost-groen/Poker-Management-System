import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ONLINE_DB_FILE, odb } from './db.ts';

// Same folder and retention as Poker Bank's backups, but its own file names, so neither prunes the other's copies.
const DIR = process.env.BACKUP_DIR ?? join(dirname(ONLINE_DB_FILE), 'backups');
const KEEP = Number(process.env.BACKUP_KEEP ?? 30);
const HOUR = 60 * 60 * 1000;
const PATTERN = /^online-\d{4}-\d{2}-\d{2}\.db$/;

/** One consistent copy per day (online-YYYY-MM-DD.db), keeping the newest KEEP. */
export function backupOnline() {
  mkdirSync(DIR, { recursive: true });
  const name = `online-${new Date().toISOString().slice(0, 10)}.db`;
  const existing = readdirSync(DIR).filter((f) => PATTERN.test(f)).sort();
  if (!existing.includes(name)) {
    odb.prepare('VACUUM INTO ?').run(join(DIR, name));
    existing.push(name);
  }
  for (const old of existing.sort().slice(0, Math.max(0, existing.length - KEEP))) rmSync(join(DIR, old));
}

export function scheduleOnlineBackups() {
  if (ONLINE_DB_FILE === ':memory:' || KEEP <= 0) return;
  const run = () => {
    try {
      backupOnline();
    } catch (err) {
      console.error('Online backup failed', err);
    }
  };
  run();
  setInterval(run, HOUR).unref();
}
