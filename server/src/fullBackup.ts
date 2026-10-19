import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { DatabaseSync } from 'node:sqlite';
import { db } from './db.ts';
import { odb } from './online/db.ts';

// One download with everything: Poker Bank's database and the Play section's, as consistent copies taken at the
// same moment, plus a manifest. A .tar.gz, so it opens anywhere without extra software or dependencies.

export interface BackupManifest {
  createdAt: string;
  files: { name: string; bytes: number; sha256: string }[];
  counts: { players: number; games: number; accounts: number; tables: number; hands: number };
}

const RESTORE = `Poker Bank backup

poker.db   Poker Bank: players, games, buy-ins, results
online.db  Play: accounts, tables, hand history

Restore: stop the app, put both files in the data folder (in Docker the "poker-data" volume, /data),
replacing poker.db and online.db, delete any poker.db-wal/-shm and online.db-wal/-shm next to them, start the app.
`;

/** A consistent copy of a live SQLite database, even while it is being written to. */
function snapshot(database: DatabaseSync, dir: string, name: string): Buffer {
  const file = join(dir, name);
  database.prepare('VACUUM INTO ?').run(file);
  return readFileSync(file);
}

const count = (database: DatabaseSync, table: string) => (database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

export function buildBackup(now = new Date()): { file: Buffer; name: string; manifest: BackupManifest } {
  const dir = mkdtempSync(join(tmpdir(), 'poker-backup-'));
  try {
    const poker = snapshot(db, dir, 'poker.db');
    const online = snapshot(odb, dir, 'online.db');
    const files = [
      { name: 'poker.db', data: poker },
      { name: 'online.db', data: online },
    ];
    const manifest: BackupManifest = {
      createdAt: now.toISOString(),
      files: files.map((f) => ({ name: f.name, bytes: f.data.length, sha256: createHash('sha256').update(f.data).digest('hex') })),
      counts: {
        players: count(db, 'players'),
        games: count(db, 'games'),
        accounts: (odb.prepare('SELECT COUNT(*) AS n FROM accounts WHERE bot IS NULL').get() as { n: number }).n,
        tables: count(odb, 'tables'),
        hands: count(odb, 'hands'),
      },
    };
    const entries = [
      ...files,
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) },
      { name: 'RESTORE.txt', data: Buffer.from(RESTORE) },
    ];
    const stamp = now.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    return { file: gzipSync(tar(entries, now)), name: `poker-bank-backup-${stamp}.tar.gz`, manifest };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A plain ustar archive: a 512-byte header per file, the data padded to 512 bytes, two empty blocks at the end. */
function tar(entries: { name: string; data: Buffer }[], date: Date): Buffer {
  const blocks: Buffer[] = [];
  for (const { name, data } of entries) {
    const h = Buffer.alloc(512);
    const field = (value: string, offset: number, length: number) => h.write(value, offset, length, 'ascii');
    const octal = (n: number, length: number) => n.toString(8).padStart(length - 1, '0') + '\0';
    field(name, 0, 100);
    field(octal(0o644, 8), 100, 8);
    field(octal(0, 8), 108, 8);
    field(octal(0, 8), 116, 8);
    field(octal(data.length, 12), 124, 12);
    field(octal(Math.floor(date.getTime() / 1000), 12), 136, 12);
    field('        ', 148, 8);
    field('0', 156, 1);
    field('ustar\0', 257, 6);
    field('00', 263, 2);
    let sum = 0;
    for (const byte of h) sum += byte;
    field(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
