import type { Game, GameEvent, GamePlayer, GameStatus, GameSummary, LogEvent } from '../../shared/types.ts';
import { db, tx } from './db.ts';
import { HttpError } from './http.ts';
import { settle } from './settle.ts';

interface GameRow {
  id: number;
  buy_in: number;
  status: GameStatus;
  started_at: string;
  closed_at: string | null;
}

interface LineRow {
  playerId: number;
  name: string;
  finalStack: number | null;
  buyins: number;
  cashouts: number;
}

const gameStmt = db.prepare('SELECT * FROM games WHERE id = ?');
const linesStmt = db.prepare(`
  SELECT gp.player_id AS playerId, p.name AS name, gp.final_stack AS finalStack,
         COUNT(CASE WHEN e.type = 'buyin' THEN 1 END) AS buyins,
         COUNT(CASE WHEN e.type = 'cashout' THEN 1 END) AS cashouts
  FROM game_players gp
  JOIN players p ON p.id = gp.player_id
  LEFT JOIN events e ON e.game_id = gp.game_id AND e.player_id = gp.player_id
  WHERE gp.game_id = ?
  GROUP BY gp.player_id, p.name, gp.final_stack
  ORDER BY p.name COLLATE NOCASE`);
const lastEventStmt = db.prepare(`
  SELECT e.id, e.type, e.player_id AS playerId, p.name
  FROM events e JOIN players p ON p.id = e.player_id
  WHERE e.game_id = ? AND e.initial = 0
  ORDER BY e.id DESC LIMIT 1`);
const insertEvent = db.prepare('INSERT INTO events (game_id, player_id, type, initial) VALUES (?, ?, ?, ?)');
// A player whose last event is gone is no longer part of the game.
const dropIfEmpty = db.prepare(`
  DELETE FROM game_players WHERE game_id = ? AND player_id = ?
  AND NOT EXISTS (SELECT 1 FROM events WHERE game_id = ? AND player_id = ?)`);

function row(id: number): GameRow {
  const g = gameStmt.get(id) as GameRow | undefined;
  if (!g) throw new HttpError(404, 'game_not_found', 'Game not found');
  return g;
}

function liveRow(id: number): GameRow {
  const g = row(id);
  if (g.status !== 'live') throw new HttpError(409, 'game_closed', 'Game is closed');
  return g;
}

function line(g: GameRow, r: LineRow): GamePlayer {
  const debt = (r.buyins - r.cashouts) * g.buy_in;
  const result = g.status === 'closed' && r.finalStack !== null ? r.finalStack - debt : null;
  return { ...r, debt, result };
}

export function getGame(id: number): Game {
  const g = row(id);
  const players = (linesStmt.all(id) as unknown as LineRow[]).map((r) => line(g, r));
  const totalIn = players.reduce((s, p) => s + p.buyins, 0) * g.buy_in;
  const totalOut = players.reduce((s, p) => s + p.cashouts, 0) * g.buy_in;
  const transfers =
    g.status === 'closed'
      ? settle(players.map((p) => ({ id: p.playerId, name: p.name, balance: p.result ?? 0 })))
      : [];
  return {
    id: g.id,
    buyIn: g.buy_in,
    status: g.status,
    startedAt: g.started_at,
    closedAt: g.closed_at,
    players,
    totals: { in: totalIn, out: totalOut, onTable: totalIn - totalOut },
    transfers,
    lastEvent: g.status === 'live' ? ((lastEventStmt.get(id) as GameEvent | undefined) ?? null) : null,
  };
}

export function listGames(): GameSummary[] {
  const ids = db.prepare('SELECT id FROM games ORDER BY status = \'live\' DESC, started_at DESC').all() as { id: number }[];
  return ids.map(({ id }) => {
    const g = getGame(id);
    const top = g.players.reduce<GamePlayer | null>(
      (best, p) => (p.result !== null && (best === null || p.result > (best.result ?? 0)) ? p : best),
      null,
    );
    return {
      id: g.id,
      buyIn: g.buyIn,
      status: g.status,
      startedAt: g.startedAt,
      playerCount: g.players.length,
      buyins: g.players.reduce((s, p) => s + p.buyins, 0),
      onTable: g.totals.onTable,
      topName: top && top.result! > 0 ? top.name : null,
      topResult: top && top.result! > 0 ? top.result : null,
    };
  });
}

/** Only active (not archived) players can join games. */
function assertPlayers(ids: number[]) {
  const found = db.prepare(`SELECT COUNT(*) AS n FROM players WHERE archived = 0 AND id IN (${ids.map(() => '?').join(',')})`).get(...ids) as { n: number };
  if (found.n !== ids.length) throw new HttpError(400, 'unknown_player', 'Unknown player');
}

export function createGame(buyIn: number, playerIds: number[]): Game {
  const ids = [...new Set(playerIds)];
  if (ids.length < 2) throw new HttpError(400, 'min_players', 'Pick at least 2 players');
  assertPlayers(ids);
  const id = tx(() => {
    const gameId = Number(db.prepare('INSERT INTO games (buy_in) VALUES (?)').run(buyIn).lastInsertRowid);
    const join = db.prepare('INSERT INTO game_players (game_id, player_id) VALUES (?, ?)');
    for (const pid of ids) {
      join.run(gameId, pid);
      insertEvent.run(gameId, pid, 'buyin', 1);
    }
    return gameId;
  });
  return getGame(id);
}

function inGame(g: Game, playerId: number): GamePlayer {
  const p = g.players.find((x) => x.playerId === playerId);
  if (!p) throw new HttpError(404, 'not_in_game', 'Player is not in this game');
  return p;
}

export function joinGame(id: number, playerId: number): Game {
  liveRow(id);
  assertPlayers([playerId]);
  tx(() => {
    const res = db.prepare('INSERT OR IGNORE INTO game_players (game_id, player_id) VALUES (?, ?)').run(id, playerId);
    if (res.changes === 0) throw new HttpError(409, 'already_in_game', 'Player already in game');
    insertEvent.run(id, playerId, 'buyin', 0);
  });
  return getGame(id);
}

export function rebuy(id: number, playerId: number): Game {
  liveRow(id);
  inGame(getGame(id), playerId);
  insertEvent.run(id, playerId, 'buyin', 0);
  return getGame(id);
}

export function cashout(id: number, playerId: number): Game {
  liveRow(id);
  const p = inGame(getGame(id), playerId);
  // Only the stake can leave the table mid-game; profit is paid out at settlement.
  if (p.buyins - p.cashouts < 1) {
    throw new HttpError(409, 'no_debt', `${p.name} has no debt left to cash out`, { name: p.name });
  }
  insertEvent.run(id, playerId, 'cashout', 0);
  return getGame(id);
}

export function undo(id: number): Game {
  liveRow(id);
  const last = lastEventStmt.get(id) as GameEvent | undefined;
  if (!last) throw new HttpError(409, 'nothing_to_undo', 'Nothing to undo');
  tx(() => {
    db.prepare('DELETE FROM events WHERE id = ?').run(last.id);
    dropIfEmpty.run(id, last.playerId, id, last.playerId);
  });
  return getGame(id);
}

export function closeGame(id: number, stacks: Map<number, number>): Game {
  liveRow(id);
  const g = getGame(id);
  if (stacks.size !== g.players.length || g.players.some((p) => !stacks.has(p.playerId))) {
    throw new HttpError(400, 'stacks_incomplete', 'Enter a final stack for every player');
  }
  const counted = [...stacks.values()].reduce((s, v) => s + v, 0);
  if (counted !== g.totals.onTable) {
    throw new HttpError(409, 'stacks_mismatch', `Stacks add up to ${counted / 100}, table holds ${g.totals.onTable / 100}`, {
      counted,
      onTable: g.totals.onTable,
    });
  }
  tx(() => {
    const set = db.prepare('UPDATE game_players SET final_stack = ? WHERE game_id = ? AND player_id = ?');
    for (const [pid, stack] of stacks) set.run(stack, id, pid);
    db.prepare(`UPDATE games SET status = 'closed', closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(id);
  });
  return getGame(id);
}

// Admin operations

export function reopenGame(id: number): Game {
  const g = row(id);
  if (g.status !== 'closed') throw new HttpError(409, 'game_live', 'Game is already live');
  tx(() => {
    db.prepare('UPDATE game_players SET final_stack = NULL WHERE game_id = ?').run(id);
    db.prepare(`UPDATE games SET status = 'live', closed_at = NULL WHERE id = ?`).run(id);
  });
  return getGame(id);
}

export function deleteGame(id: number) {
  row(id);
  db.prepare('DELETE FROM games WHERE id = ?').run(id);
}

/** Moves the game to another day, keeping its time of day. */
export function setGameDate(id: number, day: string): Game {
  const g = row(id);
  db.prepare('UPDATE games SET started_at = ? WHERE id = ?').run(day + g.started_at.slice(10), id);
  return getGame(id);
}

export function gameLog(id: number): LogEvent[] {
  row(id);
  const rows = db.prepare(`
    SELECT e.id, e.type, e.player_id AS playerId, p.name, e.initial, e.created_at AS createdAt
    FROM events e JOIN players p ON p.id = e.player_id
    WHERE e.game_id = ? ORDER BY e.id`).all(id) as unknown as (Omit<LogEvent, 'initial'> & { initial: number })[];
  return rows.map((r) => ({ ...r, initial: r.initial === 1 }));
}

/** Removes any single entry of a live game's log; a player left without entries leaves the game. */
export function deleteEvent(id: number, eventId: number): Game {
  liveRow(id);
  const e = db.prepare('SELECT player_id AS playerId FROM events WHERE id = ? AND game_id = ?').get(eventId, id) as { playerId: number } | undefined;
  if (!e) throw new HttpError(404, 'event_not_found', 'Entry not found');
  tx(() => {
    db.prepare('DELETE FROM events WHERE id = ?').run(eventId);
    dropIfEmpty.run(id, e.playerId, id, e.playerId);
  });
  return getGame(id);
}

export function removeFromGame(id: number, playerId: number): Game {
  liveRow(id);
  inGame(getGame(id), playerId);
  tx(() => {
    db.prepare('DELETE FROM events WHERE game_id = ? AND player_id = ?').run(id, playerId);
    db.prepare('DELETE FROM game_players WHERE game_id = ? AND player_id = ?').run(id, playerId);
  });
  return getGame(id);
}
