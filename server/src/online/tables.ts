import { randomInt } from 'node:crypto';
import type { Account, LiveTableView, SeatView, StakesMode, TableStatus, TableSummary } from '../../../shared/online.ts';
import { act, legalActions, startHand, type Action, type HandState } from '../../../shared/poker/holdem.ts';
import { replayMs, viewFor } from '../../../shared/poker/view.ts';
import { getAccount } from './auth.ts';
import { odb, otx } from './db.ts';
import { OnlineError, int, text } from './http.ts';

// Live tables run in memory, one engine each; the database holds stacks between hands and the ledger.

const ACTION_MS = Number(process.env.ONLINE_ACTION_MS ?? 30_000);
const NEXT_HAND_MS = Number(process.env.ONLINE_NEXT_HAND_MS ?? 4_000);
/** 0 skips the wait for clients replaying the end of a hand (tests). */
const REPLAY_SCALE = Number(process.env.ONLINE_REPLAY_SCALE ?? 1);
/** Timeouts in a row before a player is sat out. */
const MAX_TIMEOUTS = 2;
const MAX_CENTS = 100_000_00;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface Seat {
  seat: number;
  account: Account;
  stack: number;
  sittingOut: boolean;
  leaving: boolean;
  timeouts: number;
  boughtIn: number;
}

interface Listener {
  accountId: number;
  send: (view: LiveTableView) => void;
}

interface Live {
  id: number;
  code: string;
  name: string;
  mode: StakesMode;
  sb: number;
  bb: number;
  buyIn: number;
  maxSeats: number;
  hostId: number;
  status: TableStatus;
  started: boolean;
  closing: boolean;
  createdAt: string;
  closedAt: string | null;
  button: number | null;
  handNo: number;
  seats: (Seat | null)[];
  hand: HandState | null;
  deadline: number | null;
  actionTimer: NodeJS.Timeout | null;
  nextTimer: NodeJS.Timeout | null;
  listeners: Set<Listener>;
}

interface TableRow {
  id: number;
  code: string;
  name: string;
  host_id: number;
  mode: StakesMode;
  sb: number;
  bb: number;
  buy_in: number;
  max_seats: number;
  status: TableStatus;
  started: number;
  button: number | null;
  hand_no: number;
  created_at: string;
  closed_at: string | null;
}

const live = new Map<string, Live>();

function tableRow(code: string): TableRow {
  const row = odb.prepare('SELECT * FROM tables WHERE code = ?').get(code.toUpperCase()) as TableRow | undefined;
  if (!row) throw new OnlineError(404, 'table_not_found', 'Table not found');
  return row;
}

const boughtInStmt = odb.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM ledger WHERE table_id = ? AND account_id = ? AND type = 'buyin'`);

/** The table in memory; loaded from the database after a restart (any hand that was running is void). */
function load(code: string): Live {
  const key = code.toUpperCase();
  const cached = live.get(key);
  if (cached) return cached;
  const row = tableRow(key);
  const t: Live = {
    id: row.id, code: row.code, name: row.name, mode: row.mode, sb: row.sb, bb: row.bb, buyIn: row.buy_in,
    maxSeats: row.max_seats, hostId: row.host_id, status: row.status, started: row.started === 1, closing: false,
    createdAt: row.created_at, closedAt: row.closed_at, button: row.button, handNo: row.hand_no,
    seats: Array.from({ length: row.max_seats }, () => null), hand: null, deadline: null, actionTimer: null, nextTimer: null,
    listeners: new Set(),
  };
  const seats = odb.prepare('SELECT seat, account_id, stack, sitting_out FROM seats WHERE table_id = ?').all(row.id) as {
    seat: number; account_id: number; stack: number; sitting_out: number;
  }[];
  for (const s of seats) {
    t.seats[s.seat] = {
      seat: s.seat, account: getAccount(s.account_id), stack: s.stack, sittingOut: s.sitting_out === 1, leaving: false, timeouts: 0,
      boughtIn: (boughtInStmt.get(row.id, s.account_id) as { n: number }).n,
    };
  }
  if (t.status === 'open') {
    live.set(key, t);
    scheduleNext(t, NEXT_HAND_MS);
  }
  return t;
}

function openTable(code: string): Live {
  const t = load(code);
  if (t.status !== 'open') throw new OnlineError(409, 'table_closed', 'This table is closed');
  return t;
}

function seatOf(t: Live, accountId: number): Seat | null {
  return t.seats.find((s) => s?.account.id === accountId) ?? null;
}

function mySeat(t: Live, accountId: number): Seat {
  const s = seatOf(t, accountId);
  if (!s) throw new OnlineError(409, 'not_seated', 'You are not seated at this table');
  return s;
}

/** Dealt into the running hand. */
function inHand(t: Live, accountId: number): boolean {
  return Boolean(t.hand && !t.hand.result && t.hand.players.some((p) => p.id === String(accountId)));
}

function connected(t: Live, accountId: number): boolean {
  for (const l of t.listeners) if (l.accountId === accountId) return true;
  return false;
}

export function viewOf(t: Live, accountId: number): LiveTableView {
  const seats = t.seats.map((s): SeatView | null => s && {
    seat: s.seat, account: s.account, stack: s.stack, sittingOut: s.sittingOut, leaving: s.leaving,
    boughtIn: s.boughtIn, connected: connected(t, s.account.id),
  });
  // During a hand the live stacks come from the engine.
  if (t.hand && !t.hand.result) {
    for (const p of t.hand.players) {
      const s = seats.find((x) => x?.account.id === Number(p.id));
      if (s) s.stack = p.stack;
    }
  }
  return {
    code: t.code, name: t.name, mode: t.mode, sb: t.sb, bb: t.bb, buyIn: t.buyIn, maxSeats: t.maxSeats, status: t.status,
    started: t.started, createdAt: t.createdAt, closedAt: t.closedAt, hostId: t.hostId, closing: t.closing, seats,
    hand: t.hand ? viewFor(t.hand, String(accountId)) : null,
    you: seatOf(t, accountId)?.seat ?? null,
    deadline: t.deadline, serverTime: Date.now(),
  };
}

function broadcast(t: Live) {
  for (const l of t.listeners) {
    try {
      l.send(viewOf(t, l.accountId));
    } catch {
      t.listeners.delete(l);
    }
  }
}

// Persistence

const saveSeat = odb.prepare('UPDATE seats SET stack = ?, sitting_out = ? WHERE table_id = ? AND seat = ?');
const addLedger = odb.prepare('INSERT INTO ledger (table_id, account_id, type, amount) VALUES (?, ?, ?, ?)');

function saveSeats(t: Live) {
  for (const s of t.seats) if (s) saveSeat.run(s.stack, s.sittingOut ? 1 : 0, t.id, s.seat);
}

/** Cash out and free the seat. */
function removeSeat(t: Live, s: Seat) {
  otx(() => {
    addLedger.run(t.id, s.account.id, 'cashout', s.stack);
    odb.prepare('DELETE FROM seats WHERE table_id = ? AND seat = ?').run(t.id, s.seat);
  });
  t.seats[s.seat] = null;
}

// Hands

function clearAction(t: Live) {
  if (t.actionTimer) clearTimeout(t.actionTimer);
  t.actionTimer = null;
  t.deadline = null;
}

function scheduleNext(t: Live, delay: number) {
  if (t.nextTimer) clearTimeout(t.nextTimer);
  t.nextTimer = null;
  if (!t.started || t.closing || t.status !== 'open' || (t.hand && !t.hand.result)) return;
  t.nextTimer = setTimeout(() => {
    t.nextTimer = null;
    deal(t);
  }, delay);
  t.nextTimer.unref();
}

function eligible(t: Live): Seat[] {
  return t.seats.filter((s): s is Seat => s !== null && s.stack > 0 && !s.sittingOut && !s.leaving);
}

function deal(t: Live) {
  if (t.status !== 'open' || t.closing || (t.hand && !t.hand.result)) return;
  const players = eligible(t);
  if (players.length < 2) return broadcast(t);
  t.handNo++;
  t.hand = startHand({
    players: players.map((s) => ({ id: String(s.account.id), name: s.account.username, seat: s.seat, stack: s.stack })),
    previousButton: t.button,
    sb: t.sb,
    bb: t.bb,
    rng: (n) => randomInt(n),
    handNo: t.handNo,
  });
  t.button = t.hand.players[t.hand.button].seat;
  odb.prepare('UPDATE tables SET button = ?, hand_no = ? WHERE id = ?').run(t.button, t.handNo, t.id);
  advance(t);
}

/** After every change: auto-fold players who left or sit out, start the clock for the next one, or end the hand. */
function advance(t: Live) {
  clearAction(t);
  while (t.hand && !t.hand.result) {
    const actor = t.hand.players[t.hand.toAct!];
    const seat = seatOf(t, Number(actor.id));
    if (seat && !seat.leaving && !seat.sittingOut) break;
    // Leaving folds the hand; sitting out only checks or folds, so a free card is never given away.
    t.hand = act(t.hand, t.hand.toAct!, !seat || seat.leaving ? { type: 'fold' } : passive(t.hand));
  }
  if (!t.hand) return broadcast(t);
  if (t.hand.result) return endHand(t);
  t.deadline = Date.now() + ACTION_MS;
  t.actionTimer = setTimeout(() => timeout(t), ACTION_MS);
  t.actionTimer.unref();
  broadcast(t);
}

function passive(hand: HandState): Action {
  return legalActions(hand, hand.toAct!)?.check ? { type: 'check' } : { type: 'fold' };
}

function timeout(t: Live) {
  if (!t.hand || t.hand.result) return;
  const actor = t.hand.players[t.hand.toAct!];
  const seat = seatOf(t, Number(actor.id));
  if (seat && ++seat.timeouts >= MAX_TIMEOUTS) seat.sittingOut = true;
  t.hand = act(t.hand, t.hand.toAct!, passive(t.hand));
  advance(t);
}

function endHand(t: Live) {
  const hand = t.hand!;
  const result = hand.result!;
  const vpip = new Set(hand.actions.filter((a) => a.street === 'preflop' && (a.type === 'call' || a.type === 'raise')).map((a) => a.playerId));
  otx(() => {
    for (const p of hand.players) {
      const s = seatOf(t, Number(p.id));
      if (s) s.stack = p.stack;
    }
    saveSeats(t);
    const data = {
      board: hand.board,
      players: hand.players.map((p) => ({ id: Number(p.id), seat: p.seat, cards: result.shown[p.id] ?? null, net: result.net[p.id] })),
      actions: hand.actions,
      pots: result.pots,
    };
    const handId = Number(odb.prepare('INSERT INTO hands (table_id, hand_no, data) VALUES (?, ?, ?)').run(t.id, hand.handNo, JSON.stringify(data)).lastInsertRowid);
    const hp = odb.prepare('INSERT INTO hand_players (hand_id, account_id, net, vpip) VALUES (?, ?, ?, ?)');
    for (const p of hand.players) hp.run(handId, Number(p.id), result.net[p.id], vpip.has(p.id) ? 1 : 0);
  });
  for (const s of t.seats) if (s?.leaving) removeSeat(t, s);
  if (t.closing) return finalize(t);
  broadcast(t);
  // Clients play an all-in runout street by street; the next hand waits until they are done.
  scheduleNext(t, NEXT_HAND_MS + replayMs(hand) * REPLAY_SCALE);
}

/** Everyone still seated cashes out their stack; the table becomes read-only. */
function finalize(t: Live) {
  clearAction(t);
  if (t.nextTimer) clearTimeout(t.nextTimer);
  for (const s of t.seats) if (s) removeSeat(t, s);
  odb.prepare(`UPDATE tables SET status = 'closed', closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(t.id);
  const row = tableRow(t.code);
  t.status = 'closed';
  t.closedAt = row.closed_at;
  t.closing = false;
  broadcast(t);
  live.delete(t.code);
}

// Public operations

export interface TableInput {
  name?: unknown;
  mode?: unknown;
  sb?: unknown;
  bb?: unknown;
  buyIn?: unknown;
  maxSeats?: unknown;
}

function newCode(): string {
  for (;;) {
    const code = Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
    if (!odb.prepare('SELECT 1 FROM tables WHERE code = ?').get(code)) return code;
  }
}

export function createTable(host: Account, body: TableInput): TableSummary {
  const name = text(body.name, 'name', 40);
  if (body.mode !== 'cash' && body.mode !== 'fun') throw new OnlineError(400, 'invalid', 'Invalid mode', { field: 'mode' });
  const sb = int(body.sb, 'small blind', 1, MAX_CENTS);
  const bb = int(body.bb, 'big blind', sb, MAX_CENTS);
  const buyIn = int(body.buyIn, 'buy-in', bb * 10, MAX_CENTS);
  const maxSeats = int(body.maxSeats, 'seats', 2, 9);
  const code = newCode();
  odb.prepare('INSERT INTO tables (code, name, host_id, mode, sb, bb, buy_in, max_seats) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(code, name, host.id, body.mode, sb, bb, buyIn, maxSeats);
  return summary(code, host.id);
}

export function summary(code: string, accountId: number): TableSummary {
  const row = tableRow(code);
  const t = row.status === 'open' ? load(code) : null;
  const seated = t ? t.seats.filter(Boolean).length : 0;
  const mine = t
    ? seatOf(t, accountId) !== null
    : Boolean(odb.prepare('SELECT 1 FROM ledger WHERE table_id = ? AND account_id = ?').get(row.id, accountId));
  return {
    code: row.code, name: row.name, mode: row.mode, sb: row.sb, bb: row.bb, buyIn: row.buy_in, maxSeats: row.max_seats,
    seated, host: getAccount(row.host_id), status: row.status, started: row.started === 1, createdAt: row.created_at,
    closedAt: row.closed_at, mine,
  };
}

/** Open tables, then the closed ones the account played at (latest 30). */
export function listTables(accountId: number): TableSummary[] {
  const open = odb.prepare(`SELECT code FROM tables WHERE status = 'open' ORDER BY created_at DESC`).all() as { code: string }[];
  const closed = odb.prepare(`
    SELECT DISTINCT t.code, t.closed_at FROM tables t JOIN ledger l ON l.table_id = t.id
    WHERE t.status = 'closed' AND l.account_id = ? ORDER BY t.closed_at DESC LIMIT 30`).all(accountId) as { code: string }[];
  return [...open, ...closed].map((r) => summary(r.code, accountId));
}

export function tableView(code: string, accountId: number): LiveTableView {
  return viewOf(load(code), accountId);
}

export function join(code: string, account: Account, seatNo?: number): LiveTableView {
  const t = openTable(code);
  if (t.closing) throw new OnlineError(409, 'table_closed', 'This table is closing');
  if (seatOf(t, account.id)) throw new OnlineError(409, 'already_seated', 'You already have a seat');
  const free = t.seats.findIndex((s) => s === null);
  if (free < 0) throw new OnlineError(409, 'table_full', 'The table is full');
  const seat = seatNo ?? free;
  if (seat < 0 || seat >= t.maxSeats) throw new OnlineError(400, 'invalid', 'Invalid seat', { field: 'seat' });
  if (t.seats[seat]) throw new OnlineError(409, 'seat_taken', 'That seat is taken');
  otx(() => {
    odb.prepare('INSERT INTO seats (table_id, seat, account_id, stack) VALUES (?, ?, ?, ?)').run(t.id, seat, account.id, t.buyIn);
    addLedger.run(t.id, account.id, 'buyin', t.buyIn);
  });
  t.seats[seat] = {
    seat, account, stack: t.buyIn, sittingOut: false, leaving: false, timeouts: 0,
    boughtIn: (boughtInStmt.get(t.id, account.id) as { n: number }).n,
  };
  broadcast(t);
  scheduleNext(t, NEXT_HAND_MS);
  return viewOf(t, account.id);
}

export function sit(code: string, account: Account, out: boolean): LiveTableView {
  const t = openTable(code);
  const s = mySeat(t, account.id);
  s.sittingOut = out;
  if (!out) s.timeouts = 0;
  saveSeat.run(s.stack, out ? 1 : 0, t.id, s.seat);
  if (out && inHand(t, account.id) && t.hand!.players[t.hand!.toAct!]?.id === String(account.id)) advance(t);
  else broadcast(t);
  scheduleNext(t, NEXT_HAND_MS);
  return viewOf(t, account.id);
}

export function start(code: string, account: Account): LiveTableView {
  const t = openTable(code);
  if (t.hostId !== account.id) throw new OnlineError(403, 'not_host', 'Only the host can do that');
  if (eligible(t).length < 2) throw new OnlineError(409, 'not_enough_players', 'Need at least 2 players with chips');
  t.started = true;
  odb.prepare('UPDATE tables SET started = 1 WHERE id = ?').run(t.id);
  scheduleNext(t, 0);
  broadcast(t);
  return viewOf(t, account.id);
}

export function action(code: string, account: Account, body: { type?: unknown; to?: unknown }): LiveTableView {
  const t = openTable(code);
  const s = mySeat(t, account.id);
  if (!t.hand || t.hand.result) throw new OnlineError(409, 'hand_over', 'No hand is running');
  const type = body.type;
  if (type !== 'fold' && type !== 'check' && type !== 'call' && type !== 'raise') throw new OnlineError(400, 'invalid', 'Invalid action', { field: 'type' });
  const a: Action = type === 'raise' ? { type, to: int(body.to, 'amount', 1, MAX_CENTS * 10) } : { type };
  t.hand = act(t.hand, String(account.id), a);
  s.timeouts = 0;
  advance(t);
  return viewOf(t, account.id);
}

/** Like at the real table: one more buy-in while your stack is below the buy-in, between hands. */
export function rebuy(code: string, account: Account): LiveTableView {
  const t = openTable(code);
  const s = mySeat(t, account.id);
  if (inHand(t, account.id)) throw new OnlineError(409, 'hand_running', 'Wait for the hand to finish');
  if (s.stack >= t.buyIn) throw new OnlineError(409, 'rebuy_not_allowed', 'Rebuy only while your stack is below the buy-in');
  otx(() => {
    addLedger.run(t.id, account.id, 'buyin', t.buyIn);
    s.stack += t.buyIn;
    saveSeat.run(s.stack, s.sittingOut ? 1 : 0, t.id, s.seat);
  });
  s.boughtIn += t.buyIn;
  broadcast(t);
  scheduleNext(t, NEXT_HAND_MS);
  return viewOf(t, account.id);
}

/** Cash out now, or (when dealt into the running hand) fold and leave once it ends. */
export function leave(code: string, account: Account): LiveTableView {
  const t = openTable(code);
  const s = mySeat(t, account.id);
  if (inHand(t, account.id)) {
    s.leaving = true;
    if (t.hand!.players[t.hand!.toAct!]?.id === String(account.id)) advance(t);
    else broadcast(t);
  } else {
    removeSeat(t, s);
    broadcast(t);
  }
  return viewOf(t, account.id);
}

export function close(code: string, account: Account): LiveTableView {
  const t = openTable(code);
  if (t.hostId !== account.id) throw new OnlineError(403, 'not_host', 'Only the host can do that');
  if (t.hand && !t.hand.result) {
    t.closing = true;
    broadcast(t);
    return viewOf(t, account.id);
  }
  finalize(t);
  return viewOf(t, account.id);
}

export function subscribe(code: string, accountId: number, send: Listener['send']): () => void {
  const t = load(code);
  const l: Listener = { accountId, send };
  t.listeners.add(l);
  broadcast(t);
  return () => {
    t.listeners.delete(l);
    if (t.status === 'open') broadcast(t);
  };
}

/** Tests: forget everything in memory, as after a server restart. */
export function dropMemory() {
  for (const t of live.values()) {
    clearAction(t);
    if (t.nextTimer) clearTimeout(t.nextTimer);
  }
  live.clear();
}
