import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { db } from './db.ts';

const DB_FILE = process.env.DB_FILE ?? 'data/poker.db';
const DIR = process.env.BACKUP_DIR ?? join(dirname(DB_FILE), 'backups');
const KEEP = Number(process.env.BACKUP_KEEP ?? 30);
const HOUR = 60 * 60 * 1000;

/** One consistent copy per day (poker-YYYY-MM-DD.db), keeping the newest KEEP. */
export function backup() {
  mkdirSync(DIR, { recursive: true });
  const file = join(DIR, `poker-${new Date().toISOString().slice(0, 10)}.db`);
  const existing = readdirSync(DIR).filter((f) => /^poker-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  if (!existing.includes(file.slice(DIR.length + 1))) {
    db.prepare('VACUUM INTO ?').run(file);
    existing.push(file.slice(DIR.length + 1));
  }
  for (const old of existing.sort().slice(0, Math.max(0, existing.length - KEEP))) rmSync(join(DIR, old));
}

export function scheduleBackups() {
  if (DB_FILE === ':memory:' || KEEP <= 0) return;
  const run = () => {
    try {
      backup();
    } catch (err) {
      console.error('Backup failed', err);
    }
  };
  run();
  setInterval(run, HOUR).unref();
}
