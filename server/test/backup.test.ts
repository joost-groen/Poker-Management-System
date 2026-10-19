import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { gunzipSync } from 'node:zlib';

const dir = mkdtempSync(join(tmpdir(), 'backup-test-'));
process.env.DB_FILE = join(dir, 'poker.db');
process.env.ONLINE_DB_FILE = join(dir, 'online.db');
process.env.ONLINE_INVITE_CODE = 'inv';

const games = await import('../src/games.ts');
const { db } = await import('../src/db.ts');
const auth = await import('../src/online/auth.ts');
const tables = await import('../src/online/tables.ts');
const { buildBackup } = await import('../src/fullBackup.ts');

after(() => rmSync(dir, { recursive: true, force: true }));

/** The files in a ustar archive, by name. */
function untar(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (let at = 0; at + 512 <= buf.length; ) {
    const header = buf.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString('ascii').replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/s, ''), 8);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
    assert.equal(parseInt(header.subarray(148, 156).toString('ascii'), 8), sum, `checksum of ${name}`);
    out.set(name, buf.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

test('backup: one .tar.gz with consistent copies of both databases and a manifest', () => {
  const insert = db.prepare('INSERT INTO players (name) VALUES (?)');
  const ids = ['Anna', 'Ben'].map((n) => Number(insert.run(n).lastInsertRowid));
  games.createGame(1000, ids);
  const anna = auth.register({ username: 'anna', password: 'secret12', avatar: '🦊', code: 'inv' }).account;
  tables.createTable(anna, { name: 'Friday', mode: 'fun', sb: 10, bb: 20, buyIn: 1000, maxSeats: 4 });

  const { file, name, manifest } = buildBackup(new Date('2026-10-18T21:05:00Z'));
  assert.equal(name, 'poker-bank-backup-2026-10-18-2105.tar.gz');
  const files = untar(gunzipSync(file));
  assert.deepEqual([...files.keys()], ['poker.db', 'online.db', 'manifest.json', 'RESTORE.txt']);
  assert.deepEqual(JSON.parse(files.get('manifest.json')!.toString()), manifest);
  assert.deepEqual(manifest.counts, { players: 2, games: 1, accounts: 1, tables: 1, hands: 0 });

  for (const f of manifest.files) {
    const data = files.get(f.name)!;
    assert.equal(data.length, f.bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'), f.sha256);
    // Each copy is a working database on its own.
    const path = join(dir, `restored-${f.name}`);
    writeFileSync(path, data);
    const copy = new DatabaseSync(path, { readOnly: true });
    const table = f.name === 'poker.db' ? 'games' : 'tables';
    assert.equal((copy.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, 1);
    assert.equal((copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
    copy.close();
  }
  tables.dropMemory();
});
