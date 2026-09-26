import { Router, type Request, type Response } from 'express';
import type { Role } from '../../shared/types.ts';
import { requireAdmin } from './auth.ts';
import * as games from './games.ts';
import { HttpError, date, int, name } from './http.ts';
import * as players from './players.ts';
import { playerDetail, ranking } from './stats.ts';

export const api = Router();

const MAX_CENTS = 100_000_00;
const gameId = (req: Request) => int(req.params.id, 'id', 1);

// Session

api.get('/session', (req, res) => {
  res.json({ role: req.role } satisfies { role: Role | undefined });
});

// Players

api.get('/players', (req, res) => {
  res.json(players.listPlayers(req.role === 'admin' && req.query.all === '1'));
});

api.post('/players', (req, res) => {
  res.status(201).json(players.createPlayer(name(req.body?.name)));
});

api.get('/players/:id', (req, res) => {
  res.json(playerDetail(int(req.params.id, 'id', 1)));
});

api.patch('/players/:id', requireAdmin, (req, res) => {
  res.json(players.renamePlayer(int(req.params.id, 'id', 1), name(req.body?.name)));
});

api.delete('/players/:id', requireAdmin, (req, res) => {
  res.json(players.deletePlayer(int(req.params.id, 'id', 1)));
});

api.post('/players/:id/restore', requireAdmin, (req, res) => {
  res.json(players.restorePlayer(int(req.params.id, 'id', 1)));
});

// Games

api.get('/games', (_req, res) => {
  res.json(games.listGames());
});

api.post('/games', (req, res) => {
  const buyIn = int(req.body?.buyIn, 'buy-in', 1, MAX_CENTS);
  const ids = Array.isArray(req.body?.playerIds) ? req.body.playerIds.map((v: unknown) => int(v, 'player', 1)) : [];
  res.status(201).json(games.createGame(buyIn, ids));
});

api.get('/games/:id', (req, res) => {
  res.json(games.getGame(gameId(req)));
});

const playerAction = (fn: (id: number, playerId: number) => unknown) => (req: Request, res: Response) => {
  res.json(fn(gameId(req), int(req.body?.playerId, 'player', 1)));
};

api.post('/games/:id/join', playerAction(games.joinGame));
api.post('/games/:id/rebuy', playerAction(games.rebuy));
api.post('/games/:id/cashout', playerAction(games.cashout));

api.post('/games/:id/undo', (req, res) => {
  res.json(games.undo(gameId(req)));
});

api.post('/games/:id/close', (req, res) => {
  const list: unknown = req.body?.stacks;
  if (!Array.isArray(list)) throw new HttpError(400, 'stacks_incomplete', 'Missing stacks');
  const stacks = new Map<number, number>();
  for (const s of list) stacks.set(int(s?.playerId, 'player', 1), int(s?.stack, 'stack', 0, MAX_CENTS));
  res.json(games.closeGame(gameId(req), stacks));
});

// Games: admin

api.post('/games/:id/reopen', requireAdmin, (req, res) => {
  res.json(games.reopenGame(gameId(req)));
});

api.delete('/games/:id', requireAdmin, (req, res) => {
  games.deleteGame(gameId(req));
  res.status(204).end();
});

api.patch('/games/:id', requireAdmin, (req, res) => {
  res.json(games.setGameDate(gameId(req), date(req.body?.date)));
});

// Readable by everyone (TV mode's feed and chart); changing it stays admin-only.
api.get('/games/:id/log', (req, res) => {
  res.json(games.gameLog(gameId(req)));
});

api.delete('/games/:id/log/:eventId', requireAdmin, (req, res) => {
  res.json(games.deleteEvent(gameId(req), int(req.params.eventId, 'entry', 1)));
});

api.delete('/games/:id/players/:playerId', requireAdmin, (req, res) => {
  res.json(games.removeFromGame(gameId(req), int(req.params.playerId, 'player', 1)));
});

// Ranking

api.get('/ranking', (req, res) => {
  const year = typeof req.query.year === 'string' && /^\d{4}$/.test(req.query.year) ? req.query.year : null;
  res.json(ranking(year));
});
