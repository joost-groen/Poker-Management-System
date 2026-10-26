import type { StatsGame, StatsOverview, StatsRecord } from '../../shared/types.ts';
import { db } from './db.ts';
import { ranking, results, type Result } from './stats.ts';

/** Longer than this, a game was most likely left open by mistake; its duration says nothing. */
const MAX_MINUTES = 24 * 60;
/** Lines drawn in the balance race. */
const RACE_SIZE = 5;

const durationStmt = db.prepare(`
  SELECT g.id AS gameId, g.closed_at AS closedAt, MIN(e.created_at) AS firstAt
  FROM games g JOIN events e ON e.game_id = g.id
  WHERE g.status = 'closed' AND (:from IS NULL OR g.started_at >= :from)
  GROUP BY g.id`);

function durations(from: string | null): Map<number, number | null> {
  const rows = durationStmt.all({ from }) as { gameId: number; closedAt: string | null; firstAt: string }[];
  return new Map(rows.map((r) => {
    const minutes = r.closedAt ? Math.round((Date.parse(r.closedAt) - Date.parse(r.firstAt)) / 60_000) : null;
    return [r.gameId, minutes !== null && minutes >= 0 && minutes <= MAX_MINUTES ? minutes : null];
  }));
}

/** Longest run of consecutive results matching `hit`, per player, over their own games (oldest first). */
function longestStreak(lines: Result[], hit: (result: number) => boolean): StatsRecord | null {
  const runs = new Map<number, { now: number; best: number }>();
  let top: StatsRecord | null = null;
  for (const r of lines) {
    const run = runs.get(r.playerId) ?? { now: 0, best: 0 };
    run.now = hit(r.result) ? run.now + 1 : 0;
    run.best = Math.max(run.best, run.now);
    runs.set(r.playerId, run);
    if (run.now > (top?.value ?? 1)) top = { kind: 'winStreak', value: run.now, playerId: r.playerId, name: r.name };
  }
  return top;
}

/** Group-wide numbers for all closed games since `from` (an ISO timestamp), or all time. */
export function stats(from: string | null): StatsOverview {
  const all = results(from).reverse();
  const active = all.filter((r) => !r.archived);
  const minutes = durations(from);

  const games: StatsGame[] = [];
  for (const r of all) {
    let g = games.at(-1);
    if (g?.gameId !== r.gameId) {
      g = { gameId: r.gameId, startedAt: r.startedAt, players: 0, pot: 0, minutes: minutes.get(r.gameId) ?? null };
      games.push(g);
    }
    g.players++;
    g.pot += r.buyins * r.buyIn;
  }

  const volume = games.reduce((s, g) => s + g.pot, 0);
  const timed = games.filter((g) => g.minutes !== null);
  const avg = (sum: number, n: number) => (n ? Math.round(sum / n) : 0);

  const attendance = new Map<number, { playerId: number; name: string; games: number }>();
  for (const r of active) {
    const a = attendance.get(r.playerId) ?? { playerId: r.playerId, name: r.name, games: 0 };
    a.games++;
    attendance.set(r.playerId, a);
  }

  const rows = ranking(from).rows;
  const index = new Map(games.map((g, i) => [g.gameId, i + 1]));
  const race = rows.slice(0, RACE_SIZE).map((row) => {
    const balance = new Array<number>(games.length + 1).fill(0);
    for (const r of active) if (r.playerId === row.playerId) balance[index.get(r.gameId)!] += r.result;
    for (let i = 1; i < balance.length; i++) balance[i] += balance[i - 1];
    return { playerId: row.playerId, name: row.name, balance };
  });

  return {
    games,
    players: attendance.size,
    volume,
    won: all.reduce((s, r) => s + Math.max(r.result, 0), 0),
    avgPot: avg(volume, games.length),
    avgPlayers: games.length ? Math.round((all.length / games.length) * 10) / 10 : 0,
    avgMinutes: timed.length ? avg(timed.reduce((s, g) => s + g.minutes!, 0), timed.length) : null,
    attendance: [...attendance.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name)),
    race,
    records: records(active, games, rows),
  };
}

function records(lines: Result[], games: StatsGame[], rows: ReturnType<typeof ranking>['rows']): StatsRecord[] {
  const out: StatsRecord[] = [];
  const line = (kind: StatsRecord['kind'], r: Result, value: number): StatsRecord =>
    ({ kind, value, playerId: r.playerId, name: r.name, gameId: r.gameId, startedAt: r.startedAt });
  // The first (oldest) holder keeps a record until someone beats it.
  const maxBy = <T>(items: T[], score: (x: T) => number) =>
    items.reduce<T | null>((best, x) => (best === null || score(x) > score(best) ? x : best), null);

  const win = maxBy(lines, (r) => r.result);
  if (win && win.result > 0) out.push(line('biggestWin', win, win.result));
  const loss = maxBy(lines, (r) => -r.result);
  if (loss && loss.result < 0) out.push(line('biggestLoss', loss, loss.result));

  const pot = maxBy(games, (g) => g.pot);
  if (pot) out.push({ kind: 'biggestPot', value: pot.pot, gameId: pot.gameId, startedAt: pot.startedAt });

  const rebuys = maxBy(lines, (r) => r.buyins);
  if (rebuys && rebuys.buyins > 1) out.push(line('mostRebuys', rebuys, rebuys.buyins - 1));

  const long = maxBy(games.filter((g) => g.minutes !== null), (g) => g.minutes!);
  if (long) out.push({ kind: 'longestGame', value: long.minutes!, gameId: long.gameId, startedAt: long.startedAt });

  const wins = maxBy(rows.filter((r) => r.wins > 0), (r) => r.wins);
  if (wins) out.push({ kind: 'mostWins', value: wins.wins, playerId: wins.playerId, name: wins.name });

  const up = longestStreak(lines, (v) => v > 0);
  if (up) out.push({ ...up, kind: 'winStreak' });
  const down = longestStreak(lines, (v) => v < 0);
  if (down) out.push({ ...down, kind: 'lossStreak' });

  return out;
}
