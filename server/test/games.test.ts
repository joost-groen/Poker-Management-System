import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DB_FILE = ':memory:';
const { db } = await import('../src/db.ts');
const games = await import('../src/games.ts');
const { ranking } = await import('../src/stats.ts');
const { settle } = await import('../src/settle.ts');

const player = (name: string) => Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(name).lastInsertRowid);
const [anna, ben, chris] = ['Anna', 'Ben', 'Chris'].map(player);

test('a full game: rebuys, cash-outs, settlement and ranking', () => {
  let g = games.createGame(2000, [anna, ben, chris]);
  assert.equal(g.totals.onTable, 6000);

  g = games.rebuy(g.id, ben);
  g = games.rebuy(g.id, ben);
  g = games.cashout(g.id, anna);
  assert.equal(g.players.find((p) => p.playerId === ben)!.debt, 6000);
  assert.equal(g.players.find((p) => p.playerId === anna)!.debt, 0);
  assert.equal(g.totals.onTable, 8000);

  // Anna plays on pure profit now; she cannot take more out mid-game.
  assert.throws(() => games.cashout(g.id, anna), /no debt/);

  // Undo only touches actions after the opening buy-ins.
  g = games.rebuy(g.id, chris);
  g = games.undo(g.id);
  assert.equal(g.players.find((p) => p.playerId === chris)!.buyins, 1);

  assert.throws(() => games.closeGame(g.id, new Map([[anna, 3000], [ben, 0], [chris, 3000]])), /add up/);
  g = games.closeGame(g.id, new Map([[anna, 3500], [ben, 0], [chris, 4500]]));

  const result = Object.fromEntries(g.players.map((p) => [p.name, p.result]));
  assert.deepEqual(result, { Anna: 3500, Ben: -6000, Chris: 2500 });
  assert.deepEqual(
    g.transfers.map((t) => [t.fromName, t.toName, t.amount]),
    [['Ben', 'Anna', 3500], ['Ben', 'Chris', 2500]],
  );
  assert.equal(g.totals.onTable, 8000);
  assert.equal(g.players.reduce((s, p) => s + p.result!, 0), 0);

  const r = ranking(null);
  assert.deepEqual(r.rows.map((x) => [x.name, x.net, x.wins]), [['Anna', 3500, 1], ['Chris', 2500, 0], ['Ben', -6000, 0]]);
});

test('late join is undone completely', () => {
  let g = games.createGame(1000, [anna, ben]);
  g = games.joinGame(g.id, chris);
  assert.equal(g.players.length, 3);
  g = games.undo(g.id);
  assert.equal(g.players.length, 2);
  assert.throws(() => games.undo(g.id), /Nothing to undo/);
});

test('settle minimises to greedy transfers', () => {
  const t = settle([
    { id: 1, name: 'A', balance: 45 }, { id: 2, name: 'B', balance: -60 }, { id: 3, name: 'C', balance: 18 },
    { id: 4, name: 'D', balance: 2 }, { id: 5, name: 'E', balance: 15 }, { id: 6, name: 'F', balance: -20 },
  ]);
  assert.equal(t.reduce((s, x) => s + x.amount, 0), 80);
  assert.ok(t.length <= 5);
});

test('daily backup keeps one file per day', async () => {
  const { mkdtempSync, readdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(`${tmpdir()}/poker-backup-`);
  process.env.BACKUP_DIR = dir;
  const { backup } = await import('../src/backup.ts');
  backup();
  backup();
  assert.deepEqual(readdirSync(dir), [`poker-${new Date().toISOString().slice(0, 10)}.db`]);
});

test('admin: log entries, removing players, date and archiving', async () => {
  const players = await import('../src/players.ts');
  const dana = players.createPlayer('Dana').id;
  let g = games.createGame(1000, [anna, dana]);
  g = games.rebuy(g.id, dana);
  const log = games.gameLog(g.id);
  assert.deepEqual(log.map((e) => [e.name, e.type, e.initial]), [['Anna', 'buyin', true], ['Dana', 'buyin', true], ['Dana', 'buyin', false]]);

  // Deleting an opening buy-in is possible for admins (unlike undo).
  g = games.deleteEvent(g.id, log[0].id);
  assert.equal(g.players.some((p) => p.name === 'Anna'), false);
  g = games.removeFromGame(g.id, dana);
  assert.equal(g.players.length, 0);

  g = games.setGameDate(g.id, '2025-12-31');
  assert.equal(g.startedAt.slice(0, 10), '2025-12-31');
  games.deleteGame(g.id);
  assert.throws(() => games.getGame(g.id), /not found/);

  // Dana has no history left → really deleted. Ben played → archived, hidden from ranking and new games.
  assert.deepEqual(players.deletePlayer(dana), { deleted: true, archived: false });
  assert.deepEqual(players.deletePlayer(ben), { deleted: false, archived: true });
  assert.equal(ranking(null).rows.some((r) => r.name === 'Ben'), false);
  assert.throws(() => games.createGame(1000, [anna, ben]), /Unknown player/);
  players.restorePlayer(ben);
  assert.equal(ranking(null).rows.some((r) => r.name === 'Ben'), true);
});
