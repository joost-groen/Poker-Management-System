import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DB_FILE = ':memory:';
const { db } = await import('../src/db.ts');
const games = await import('../src/games.ts');
const players = await import('../src/players.ts');
const { stats } = await import('../src/analytics.ts');
const { playerDetail, ranking } = await import('../src/stats.ts');

const player = (name: string) => Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(name).lastInsertRowid);
const [anna, ben, chris, dana] = ['Anna', 'Ben', 'Chris', 'Dana'].map(player);

/** A closed game at `at` lasting `minutes`; `rebuys` per player, then final stacks. */
function play(at: string, minutes: number, stacks: Record<number, number>, rebuys: Record<number, number> = {}) {
  const ids = Object.keys(stacks).map(Number);
  let g = games.createGame(1000, ids);
  for (const [pid, n] of Object.entries(rebuys)) for (let i = 0; i < n; i++) g = games.rebuy(g.id, Number(pid));
  games.closeGame(g.id, new Map(ids.map((id) => [id, stacks[id]])));
  const start = new Date(at);
  db.prepare('UPDATE games SET started_at = ?, closed_at = ? WHERE id = ?')
    .run(start.toISOString(), new Date(start.getTime() + minutes * 60_000).toISOString(), g.id);
  db.prepare('UPDATE events SET created_at = ? WHERE game_id = ?').run(start.toISOString(), g.id);
  return g.id;
}

// Results: g1 Anna +10 Ben −10 · g2 Anna +15 Ben −5 Chris −10 (Ben 1 rebuy) · g3 Chris +5 Anna −5 · g4 Anna +20 Dana −20 (Dana 1 rebuy)
const g1 = play('2026-09-05T19:00:00.000Z', 180, { [anna]: 2000, [ben]: 0 });
const g2 = play('2026-09-19T19:00:00.000Z', 240, { [anna]: 2500, [ben]: 1500, [chris]: 0 }, { [ben]: 1 });
const g3 = play('2026-10-03T19:00:00.000Z', 120, { [anna]: 500, [chris]: 1500 });
const g4 = play('2026-10-17T19:00:00.000Z', 3000, { [anna]: 3000, [dana]: 0 }, { [dana]: 1 });

test('stats: volume, pots, averages and durations', () => {
  const s = stats(null);
  assert.deepEqual(s.games.map((g) => g.gameId), [g1, g2, g3, g4]);
  assert.deepEqual(s.games.map((g) => g.pot), [2000, 4000, 2000, 3000]);
  assert.equal(s.volume, 11000);
  assert.equal(s.won, 1000 + 1500 + 500 + 2000);
  assert.equal(s.avgPot, 2750);
  assert.equal(s.avgPlayers, 2.3);
  // g4 was "open" for 50 hours: no duration.
  assert.deepEqual(s.games.map((g) => g.minutes), [180, 240, 120, null]);
  assert.equal(s.avgMinutes, 180);
  assert.equal(s.players, 4);
  assert.deepEqual(s.attendance.map((a) => [a.name, a.games]), [['Anna', 4], ['Ben', 2], ['Chris', 2], ['Dana', 1]]);
});

test('stats and ranking: the from filter', () => {
  const s = stats('2026-10-01T00:00:00.000Z');
  assert.deepEqual(s.games.map((g) => g.gameId), [g3, g4]);
  assert.equal(s.volume, 5000);
  assert.deepEqual(ranking('2026-10-01T00:00:00.000Z').rows.map((r) => [r.name, r.net]), [['Anna', 1500], ['Chris', 500], ['Dana', -2000]]);
});

test('stats: balance race is cumulative per group game', () => {
  const race = stats(null).race;
  assert.deepEqual(race.map((r) => r.name), ['Anna', 'Chris', 'Ben', 'Dana']);
  assert.deepEqual(race[0].balance, [0, 1000, 2500, 2000, 4000]);
  assert.deepEqual(race[2].balance, [0, -1000, -1500, -1500, -1500]);
});

test('stats: records', () => {
  const r = Object.fromEntries(stats(null).records.map((x) => [x.kind, x]));
  assert.equal(r.biggestWin.value, 2000);
  assert.equal(r.biggestWin.gameId, g4);
  assert.equal(r.biggestLoss.value, -2000);
  assert.equal(r.biggestLoss.name, 'Dana');
  assert.equal(r.biggestPot.gameId, g2);
  assert.equal(r.mostRebuys.name, 'Ben');
  assert.equal(r.mostRebuys.value, 1);
  assert.equal(r.longestGame.value, 240);
  assert.equal(r.mostWins.name, 'Anna');
  assert.equal(r.mostWins.value, 3);
  assert.equal(r.winStreak.name, 'Anna');
  assert.equal(r.winStreak.value, 2);
  assert.equal(r.lossStreak.name, 'Ben');
  assert.equal(r.lossStreak.value, 2);
});

test('player detail: places and attendance', () => {
  const c = playerDetail(chris);
  assert.deepEqual(c.games.map((g) => [g.place, g.field]), [[1, 2], [3, 3]]);
  assert.deepEqual(c.attendance, { played: 2, total: 3 });
  assert.deepEqual(playerDetail(anna).attendance, { played: 4, total: 4 });
});

test('archived players leave attendance, race and records but stay in totals', () => {
  players.deletePlayer(dana);
  const s = stats(null);
  assert.equal(s.volume, 11000);
  assert.equal(s.attendance.some((a) => a.name === 'Dana'), false);
  assert.equal(s.race.some((a) => a.name === 'Dana'), false);
  const loss = s.records.find((x) => x.kind === 'biggestLoss')!;
  assert.equal(loss.name, 'Ben');
  players.restorePlayer(dana);
});

test('single games: length from the first buy-in to closing', () => {
  assert.equal(games.getGame(g2).minutes, 240);
  assert.equal(games.getGame(g2).firstAt, '2026-09-19T19:00:00.000Z');
  assert.equal(games.listGames().find((g) => g.id === g3)!.minutes, 120);
  const live = games.createGame(1000, [anna, ben]);
  assert.equal(live.minutes, null);
  assert.ok(live.firstAt);
  games.deleteGame(live.id);
});
