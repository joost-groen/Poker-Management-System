import type { Player } from '../../shared/types.ts';
import { db } from './db.ts';
import { HttpError } from './http.ts';

interface PlayerRow {
  id: number;
  name: string;
  archived: number;
}

const toPlayer = (r: PlayerRow): Player => (r.archived ? { id: r.id, name: r.name, archived: true } : { id: r.id, name: r.name });

export function listPlayers(includeArchived: boolean): Player[] {
  const rows = db.prepare(`SELECT id, name, archived FROM players ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY name COLLATE NOCASE`).all() as unknown as PlayerRow[];
  return rows.map(toPlayer);
}

function get(id: number): PlayerRow {
  const p = db.prepare('SELECT id, name, archived FROM players WHERE id = ?').get(id) as PlayerRow | undefined;
  if (!p) throw new HttpError(404, 'player_not_found', 'Player not found');
  return p;
}

function exists(name: string): never {
  throw new HttpError(409, 'player_exists', `${name} already exists`, { name });
}

export function createPlayer(name: string): Player {
  try {
    const id = Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(name).lastInsertRowid);
    return { id, name };
  } catch {
    return exists(name);
  }
}

export function renamePlayer(id: number, name: string): Player {
  const p = get(id);
  try {
    db.prepare('UPDATE players SET name = ? WHERE id = ?').run(name, id);
  } catch {
    exists(name);
  }
  return toPlayer({ ...p, name });
}

/**
 * Deletes a player without history. A player who played keeps their past games (so every game still adds up)
 * and is archived instead: hidden from lists, new games and the ranking.
 */
export function deletePlayer(id: number): { deleted: boolean; archived: boolean } {
  get(id);
  const played = db.prepare('SELECT 1 FROM game_players WHERE player_id = ? LIMIT 1').get(id);
  if (played) {
    db.prepare('UPDATE players SET archived = 1 WHERE id = ?').run(id);
    return { deleted: false, archived: true };
  }
  db.prepare('DELETE FROM players WHERE id = ?').run(id);
  return { deleted: true, archived: false };
}

export function restorePlayer(id: number): Player {
  const p = get(id);
  db.prepare('UPDATE players SET archived = 0 WHERE id = ?').run(id);
  return toPlayer({ ...p, archived: 0 });
}
