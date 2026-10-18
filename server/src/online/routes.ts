import { Router, type Request } from 'express';
import type { TableDetail } from '../../../shared/online.ts';
import { getAccount, login, logout, register, requireAccount, setAvatar } from './auth.ts';
import { int, onlineErrors } from './http.ts';
import { onlinePlayer, onlineRanking, tableResult } from './stats.ts';
import { tableStream } from './stream.ts';
import * as tables from './tables.ts';

export const online = Router();

const code = (req: Request) => String(req.params.code);

// Accounts

online.post('/register', (req, res) => {
  res.status(201).json(register(req.body ?? {}));
});

online.post('/login', (req, res) => {
  res.json(login(req.body ?? {}, req.ip ?? ''));
});

online.use(requireAccount);

online.post('/logout', (req, res) => {
  logout(req.sessionHash!);
  res.status(204).end();
});

online.get('/me', (req, res) => {
  res.json(getAccount(req.account!.id));
});

online.patch('/me', (req, res) => {
  res.json(setAvatar(req.account!.id, req.body?.avatar));
});

// Tables

online.get('/tables', (req, res) => {
  res.json(tables.listTables(req.account!.id));
});

online.post('/tables', (req, res) => {
  res.status(201).json(tables.createTable(req.account!, req.body ?? {}));
});

online.get('/tables/:code', (req, res) => {
  const detail: TableDetail = { ...tables.summary(code(req), req.account!.id), result: tableResult(code(req)) };
  res.json(detail);
});

online.get('/tables/:code/view', (req, res) => {
  res.json(tables.tableView(code(req), req.account!.id));
});

online.get('/tables/:code/stream', tableStream);

online.post('/tables/:code/join', (req, res) => {
  const seat = req.body?.seat === undefined ? undefined : int(req.body.seat, 'seat', 0, 8);
  res.json(tables.join(code(req), req.account!, seat));
});

online.post('/tables/:code/sit', (req, res) => {
  res.json(tables.sit(code(req), req.account!, req.body?.out === true));
});

online.post('/tables/:code/start', (req, res) => {
  res.json(tables.start(code(req), req.account!));
});

online.post('/tables/:code/action', (req, res) => {
  res.json(tables.action(code(req), req.account!, req.body ?? {}));
});

online.post('/tables/:code/rebuy', (req, res) => {
  res.json(tables.rebuy(code(req), req.account!));
});

online.post('/tables/:code/leave', (req, res) => {
  res.json(tables.leave(code(req), req.account!));
});

online.post('/tables/:code/close', (req, res) => {
  res.json(tables.close(code(req), req.account!));
});

// Stats: closed cash tables only

online.get('/stats', (_req, res) => {
  res.json(onlineRanking());
});

online.get('/stats/:accountId', (req, res) => {
  res.json(onlinePlayer(int(req.params.accountId, 'player', 1)));
});

online.use(onlineErrors);
