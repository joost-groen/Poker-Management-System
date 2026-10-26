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
  WHERE g.status = 'closed' AND (:from IS NULL OR g.started_at >= :from)
  GROUP BY g.id, gp.player_id
  ORDER BY g.started_at DESC, g.id DESC`);

export type Result = PlayerGame & { playerId: number; name: string; archived: boolean };

/** Every player's line in every closed game since `from` (an ISO timestamp), newest first. */
export function results(from: string | null): Result[] {
  const rows = (resultsStmt.all({ from }) as unknown as ResultRow[]).map((r) => ({
    gameId: r.gameId,
    startedAt: r.startedAt,
    buyIn: r.buyIn,
    playerId: r.playerId,
    name: r.name,
    archived: r.archived === 1,
    buyins: r.buyins,
    cashouts: r.cashouts,
    result: r.finalStack - (r.buyins - r.cashouts) * r.buyIn,
    place: 0,
    field: 0,
  }));

  // Finish position within the game: 1 + players with a strictly better result, so ties share a place.
  const byGame = new Map<number, typeof rows>();
  for (const r of rows) byGame.set(r.gameId, [...(byGame.get(r.gameId) ?? []), r]);
  for (const lines of byGame.values()) {
    for (const r of lines) {
      r.place = 1 + lines.filter((o) => o.result > r.result).length;
      r.field = lines.length;
    }
  }
  return rows;
}

export function ranking(from: string | null, includeArchived = false): Ranking {
  const all = results(from);

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

  return {
    rows: [...rows.values()].sort((a, b) => b.net - a.net || b.avg - a.avg || a.name.localeCompare(b.name)),
  };
}

export function playerDetail(id: number): PlayerDetail {
  const p = db.prepare('SELECT id, name, archived FROM players WHERE id = ?').get(id) as { id: number; name: string; archived: number } | undefined;
  if (!p) throw new HttpError(404, 'player_not_found', 'Player not found');
  const games = results(null)
    .filter((r) => r.playerId === id)
    .map(({ playerId: _, name: __, archived: ___, ...g }) => g);
  // Closed group games since this player's first one: how often they show up.
  const first = games.at(-1)?.startedAt;
  const total = first
    ? (db.prepare(`SELECT COUNT(*) AS n FROM games WHERE status = 'closed' AND started_at >= ?`).get(first) as { n: number }).n
    : 0;
  return {
    id: p.id,
    name: p.name,
    ...(p.archived ? { archived: true } : {}),
    stats: ranking(null, true).rows.find((r) => r.playerId === id) ?? null,
    games,
    attendance: { played: games.length, total },
  };
}
