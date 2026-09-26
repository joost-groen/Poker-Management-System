import type { PlayerDetail, PlayerGame, Ranking, RankingRow } from '../../shared/types.ts';
import { db } from './db.ts';
import { HttpError } from './http.ts';

interface ResultRow {
  gameId: number;
  startedAt: string;
  buyIn: number;
  playerId: number;
  name: string;
  finalStack: number;
  archived: number;
  buyins: number;
  cashouts: number;
}

const resultsStmt = db.prepare(`
  SELECT g.id AS gameId, g.started_at AS startedAt, g.buy_in AS buyIn,
         gp.player_id AS playerId, p.name AS name, gp.final_stack AS finalStack, p.archived AS archived,
         COUNT(CASE WHEN e.type = 'buyin' THEN 1 END) AS buyins,
         COUNT(CASE WHEN e.type = 'cashout' THEN 1 END) AS cashouts
  FROM games g
  JOIN game_players gp ON gp.game_id = g.id
  JOIN players p ON p.id = gp.player_id
  LEFT JOIN events e ON e.game_id = g.id AND e.player_id = gp.player_id
  WHERE g.status = 'closed' AND (:year IS NULL OR substr(g.started_at, 1, 4) = :year)
  GROUP BY g.id, gp.player_id
  ORDER BY g.started_at DESC`);

function results(year: string | null): (PlayerGame & { playerId: number; name: string; archived: boolean })[] {
  return (resultsStmt.all({ year }) as unknown as ResultRow[]).map((r) => ({
    gameId: r.gameId,
    startedAt: r.startedAt,
    buyIn: r.buyIn,
    playerId: r.playerId,
    name: r.name,
    archived: r.archived === 1,
    buyins: r.buyins,
    cashouts: r.cashouts,
    result: r.finalStack - (r.buyins - r.cashouts) * r.buyIn,
  }));
}

export function ranking(year: string | null, includeArchived = false): Ranking {
  const all = results(year);

  // A win = the single best result of a game (ties share it), and only if it is a profit.
  const topByGame = new Map<number, number>();
  for (const r of all) topByGame.set(r.gameId, Math.max(topByGame.get(r.gameId) ?? 0, r.result));

  const rows = new Map<number, RankingRow>();
  for (const r of all) {
    // Archived players still count for wins above, but leave the ranking itself.
    if (r.archived && !includeArchived) continue;
    const row = rows.get(r.playerId) ?? {
      playerId: r.playerId, name: r.name, games: 0, net: 0, avg: 0, wins: 0,
      best: Number.NEGATIVE_INFINITY, worst: Number.POSITIVE_INFINITY,
    };
    row.games++;
    row.net += r.result;
    if (r.result > 0 && r.result === topByGame.get(r.gameId)) row.wins++;
    row.best = Math.max(row.best, r.result);
    row.worst = Math.min(row.worst, r.result);
    rows.set(r.playerId, row);
  }
  for (const row of rows.values()) row.avg = Math.round(row.net / row.games);

  const years = (db.prepare(`SELECT DISTINCT substr(started_at, 1, 4) AS y FROM games WHERE status = 'closed' ORDER BY y DESC`).all() as { y: string }[]).map((r) => r.y);

  return {
    years,
    rows: [...rows.values()].sort((a, b) => b.net - a.net || b.avg - a.avg || a.name.localeCompare(b.name)),
  };
}

export function playerDetail(id: number): PlayerDetail {
  const p = db.prepare('SELECT id, name, archived FROM players WHERE id = ?').get(id) as { id: number; name: string; archived: number } | undefined;
  if (!p) throw new HttpError(404, 'player_not_found', 'Player not found');
  const games = results(null)
    .filter((r) => r.playerId === id)
    .map(({ playerId: _, name: __, archived: ___, ...g }) => g);
  return { id: p.id, name: p.name, ...(p.archived ? { archived: true } : {}), stats: ranking(null, true).rows.find((r) => r.playerId === id) ?? null, games };
}
