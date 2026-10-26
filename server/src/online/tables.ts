import { randomInt } from 'node:crypto';
import {
  REACTIONS, VOICE_MAX_CHARS, VOICE_MAX_MS, type Account, type ChatMessage, type LiveTableView, type SeatView, type StakesMode,
  type TableStatus, type TableSummary,
} from '../../../shared/online.ts';
import { handFlags, recordOf, type HandRecord } from '../../../shared/poker/history.ts';
import { BOT_LEVELS, decide, type BotLevel } from '../../../shared/poker/bots.ts';
import { act, legalActions, remainingBoard, startHand, type Action, type HandState } from '../../../shared/poker/holdem.ts';
import { leadMs, replayMs, viewFor } from '../../../shared/poker/view.ts';
import { botAccount, getAccount } from './auth.ts';
import { odb, otx } from './db.ts';
import { OnlineError, int, text } from './http.ts';

// Live tables run in memory, one engine each; the database holds stacks between hands and the ledger.

const ACTION_MS = Number(process.env.ONLINE_ACTION_MS ?? 30_000);
const NEXT_HAND_MS = Number(process.env.ONLINE_NEXT_HAND_MS ?? 12_000);
/** 0 skips the wait for clients replaying the end of a hand (tests). */
const REPLAY_SCALE = Number(process.env.ONLINE_REPLAY_SCALE ?? 1);
/** Bots' thinking time is multiplied by this; 0 makes them act at once (tests). */
const BOT_SCALE = Number(process.env.ONLINE_BOT_SCALE ?? 1);
/** A bot's thinking time per move (ms), before a random part of up to 80% on top, as in the bot games. */
const BOT_THINK: Record<Action['type'], number> = { fold: 700, check: 650, call: 1000, raise: 1400 };
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
  chat: (message: ChatMessage) => void;
}

/** Chat kept in memory per table: the latest messages, and voice audio for the newest few only. */
const CHAT_KEEP = 40;
const VOICE_KEEP = 8;
/** At most this many messages per player in CHAT_WINDOW_MS. */
const CHAT_BURST = 6;
const CHAT_WINDOW_MS = 10_000;

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
  /** The last hand's row in the hands table, once it has ended. */
  handId: number | null;
  /** Someone asked to see the board the last hand would have dealt. */
  rest: boolean;
  deadline: number | null;
  actionTimer: NodeJS.Timeout | null;
  nextTimer: NodeJS.Timeout | null;
  listeners: Set<Listener>;
  chat: ChatMessage[];
  chatSeq: number;
  /** Recent message times per account, for the rate limit. */
  chatTimes: Map<number, number[]>;
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

// What a player has in at this table now: buy-ins minus earlier cash-outs (standing up and sitting down again counts once).
const boughtInStmt = odb.prepare(`
  SELECT COALESCE(SUM(CASE WHEN type = 'buyin' THEN amount ELSE -amount END), 0) AS n
  FROM ledger WHERE table_id = ? AND account_id = ?`);

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
    seats: Array.from({ length: row.max_seats }, () => null), hand: null, handId: null, rest: false, deadline: null, actionTimer: null, nextTimer: null,
    listeners: new Set(), chat: [], chatSeq: 0, chatTimes: new Map(),
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
  if (seatOf(t, accountId)?.account.bot) return true;
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
    rest: t.rest && t.hand?.result ? remainingBoard(t.hand) : null,
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

/**
 * Deals the next hand after `delay`. A countdown already running is kept: joining, sitting in or rebuying between
 * hands must neither cut the result short for everyone nor push the deal back (repeated clicks would stall the table).
 */
function scheduleNext(t: Live, delay: number) {
  if (!t.started || t.closing || t.status !== 'open' || (t.hand && !t.hand.result)) {
    if (t.nextTimer) clearTimeout(t.nextTimer);
    t.nextTimer = null;
    return;
  }
  if (t.nextTimer) return;
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
  // Busted bots buy in again, so the table keeps going (fun tables only: play chips, never counted).
  for (const s of t.seats) {
    if (!s?.account.bot || s.stack > 0) continue;
    otx(() => {
      addLedger.run(t.id, s.account.id, 'buyin', t.buyIn);
      s.stack = t.buyIn;
      saveSeat.run(s.stack, 0, t.id, s.seat);
    });
    s.boughtIn += t.buyIn;
  }
  const players = eligible(t);
  // Bots never play on by themselves: someone real has to be dealt in.
  if (players.length < 2 || players.every((s) => s.account.bot)) return broadcast(t);
  t.handNo++;
  t.handId = null;
  t.rest = false;
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
  // The clock starts once the clients have dealt the hand or the new street on screen.
  const lead = leadMs(t.hand) * REPLAY_SCALE;
  t.deadline = Date.now() + lead + ACTION_MS;
  const level = seatOf(t, Number(t.hand.players[t.hand.toAct!].id))?.account.bot;
  t.actionTimer = level ? botTurn(t, level, lead) : setTimeout(() => timeout(t), lead + ACTION_MS);
  t.actionTimer.unref();
  broadcast(t);
}

/**
 * A bot decides at once but acts after a human-like pause: longer for a raise than for a fold, and only once the
 * clients have dealt a new hand or street (`lead`).
 */
function botTurn(t: Live, level: BotLevel, lead: number): NodeJS.Timeout {
  const hand = t.hand!;
  const i = hand.toAct!;
  let action: Action;
  try {
    action = decide(viewFor(hand, hand.players[i].id), level).action;
  } catch {
    action = passive(hand);
  }
  const think = BOT_THINK[action.type] * (1 + Math.random() * 0.8) * BOT_SCALE + lead;
  return setTimeout(() => {
    if (t.hand !== hand) return;
    t.hand = act(hand, i, action);
    advance(t);
  }, think);
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
  const record = recordOf(hand);
  const flags = handFlags(record);
  otx(() => {
    for (const p of hand.players) {
      const s = seatOf(t, Number(p.id));
      if (s) s.stack = p.stack;
    }
    saveSeats(t);
    // The full record, hole cards included: the history API only ever hands them to their owner or after showdown.
    const handId = t.handId = Number(odb.prepare('INSERT INTO hands (table_id, hand_no, data) VALUES (?, ?, ?)').run(t.id, hand.handNo, JSON.stringify(record)).lastInsertRowid);
    const hp = odb.prepare(`INSERT INTO hand_players (hand_id, account_id, net, vpip, pfr, three_bet_chance, three_bet, saw_flop, wtsd, wsd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const p of hand.players) {
      const f = flags[p.id];
      hp.run(handId, Number(p.id), result.net[p.id], +f.vpip, +f.pfr, +f.threeBetChance, +f.threeBet, +f.sawFlop, +f.wtsd, +f.wsd);
    }
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
  // A full table with bots: a bot that isn't in the running hand stands up for the person; otherwise one leaves after it.
  if (!account.bot && !t.seats.some((s) => s === null)) {
    const bots = t.seats.filter((s): s is Seat => Boolean(s?.account.bot));
    const idle = bots.find((b) => !inHand(t, b.account.id));
    if (idle) removeSeat(t, idle);
    else if (bots.length) {
      if (!bots.some((b) => b.leaving)) leaveSeat(t, bots[bots.length - 1]);
      throw new OnlineError(409, 'bot_leaving', 'A bot gives up its seat after this hand');
    }
  }
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

/** The host runs their table; admins can run any table. */
function requireHost(t: Live, account: Account) {
  if (t.hostId !== account.id && !account.admin) throw new OnlineError(403, 'not_host', 'Only the host can do that');
}

export function start(code: string, account: Account): LiveTableView {
  const t = openTable(code);
  requireHost(t, account);
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

/** The hand that just ended, between hands, if the account was dealt in. */
function endedHand(t: Live, accountId: number): HandState {
  if (t.hand && !t.hand.result) throw new OnlineError(409, 'hand_running', 'Wait for the hand to finish');
  if (!t.hand?.players.some((p) => p.id === String(accountId))) throw new OnlineError(409, 'not_in_hand', 'You were not in this hand');
  return t.hand;
}

/** Until the next hand is dealt: turn your hole cards up for the table, and in the hand history. */
export function showCards(code: string, account: Account): LiveTableView {
  const t = openTable(code);
  const hand = endedHand(t, account.id);
  const id = String(account.id);
  const result = hand.result!;
  if (!result.shown[id]) {
    const cards = hand.players.find((p) => p.id === id)!.cards;
    t.hand = { ...hand, result: { ...result, shown: { ...result.shown, [id]: [...cards] } } };
    const row = t.handId === null ? undefined : odb.prepare('SELECT data FROM hands WHERE id = ?').get(t.handId) as { data: string } | undefined;
    if (row) {
      const record = JSON.parse(row.data) as HandRecord;
      for (const p of record.players) if (p.id === id) p.shown = true;
      odb.prepare('UPDATE hands SET data = ? WHERE id = ?').run(JSON.stringify(record), t.handId);
    }
    broadcast(t);
  }
  return viewOf(t, account.id);
}

/** Until the next hand is dealt: show everyone the board a hand that ended early would have dealt. */
export function showRest(code: string, account: Account): LiveTableView {
  const t = openTable(code);
  const hand = endedHand(t, account.id);
  if (hand.board.length < 5 && !t.rest) {
    t.rest = true;
    broadcast(t);
  }
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
  leaveSeat(t, mySeat(t, account.id));
  return viewOf(t, account.id);
}

function leaveSeat(t: Live, s: Seat) {
  const id = s.account.id;
  if (inHand(t, id)) {
    s.leaving = true;
    if (t.hand!.players[t.hand!.toAct!]?.id === String(id)) advance(t);
    else broadcast(t);
  } else {
    removeSeat(t, s);
    broadcast(t);
  }
}

/** Host (or admin) of a fun table: bots of `level` take free seats; one stays free if the host has no seat yet. */
export function fillBots(code: string, account: Account, body: { level?: unknown; count?: unknown }): LiveTableView {
  const t = openTable(code);
  requireHost(t, account);
  if (t.mode !== 'fun') throw new OnlineError(409, 'bots_fun_only', 'Bots only play at fun tables');
  if (t.closing) throw new OnlineError(409, 'table_closed', 'This table is closing');
  const level = body.level as BotLevel;
  if (!BOT_LEVELS.includes(level)) throw new OnlineError(400, 'invalid', 'Invalid level', { field: 'level' });
  const free = t.seats.flatMap((s, i) => (s === null ? [i] : [])).slice(0, seatOf(t, account.id) ? undefined : -1);
  const count = body.count === undefined ? free.length : Math.min(int(body.count, 'count', 1, 8), free.length);
  for (let index = 0, added = 0; added < count; index++) {
    const bot = botAccount(level, index);
    if (seatOf(t, bot.id)) continue;
    const seat = free[added++];
    otx(() => {
      odb.prepare('INSERT INTO seats (table_id, seat, account_id, stack) VALUES (?, ?, ?, ?)').run(t.id, seat, bot.id, t.buyIn);
      addLedger.run(t.id, bot.id, 'buyin', t.buyIn);
    });
    t.seats[seat] = { seat, account: bot, stack: t.buyIn, sittingOut: false, leaving: false, timeouts: 0, boughtIn: (boughtInStmt.get(t.id, bot.id) as { n: number }).n };
  }
  broadcast(t);
  scheduleNext(t, NEXT_HAND_MS);
  return viewOf(t, account.id);
}

/** Host (or admin): a bot stands up (folding first if it is in the hand). */
export function removeBot(code: string, account: Account, botId: number): LiveTableView {
  const t = openTable(code);
  requireHost(t, account);
  const s = seatOf(t, botId);
  if (!s?.account.bot) throw new OnlineError(409, 'not_seated', 'No bot in that seat');
  leaveSeat(t, s);
  return viewOf(t, account.id);
}

/** Admin: stand a player up, as if they had left themselves (folding first when they are in the hand). */
export function kick(code: string, admin: Account, accountId: number): LiveTableView {
  if (!admin.admin) throw new OnlineError(403, 'admin_required', 'Only admins can do that');
  leave(code, getAccount(accountId));
  return viewOf(openTable(code), admin.id);
}

export function close(code: string, account: Account): LiveTableView {
  const t = openTable(code);
  requireHost(t, account);
  if (t.hand && !t.hand.result) {
    t.closing = true;
    broadcast(t);
    return viewOf(t, account.id);
  }
  finalize(t);
  return viewOf(t, account.id);
}

export function subscribe(code: string, accountId: number, send: Listener['send'], chat: Listener['chat']): () => void {
  const t = load(code);
  const l: Listener = { accountId, send, chat };
  t.listeners.add(l);
  for (const m of t.chat) chat(m);
  broadcast(t);
  return () => {
    t.listeners.delete(l);
    if (t.status === 'open') broadcast(t);
  };
}

// Chat

export interface ChatInput {
  kind?: unknown;
  text?: unknown;
  audio?: unknown;
  ms?: unknown;
}

/** A text, a reaction or a voice message, pushed to everyone at the table. Anyone signed in who can see the table may chat. */
export function postChat(code: string, account: Account, body: ChatInput): ChatMessage {
  const t = openTable(code);
  const now = Date.now();
  const times = (t.chatTimes.get(account.id) ?? []).filter((x) => now - x < CHAT_WINDOW_MS);
  if (times.length >= CHAT_BURST) throw new OnlineError(429, 'chat_too_fast', 'Slow down a little');
  const base = { id: ++t.chatSeq, accountId: account.id, username: account.username, avatar: account.avatar, seat: seatOf(t, account.id)?.seat ?? null, at: now };
  let m: ChatMessage;
  if (body.kind === 'text') m = { ...base, kind: 'text', text: text(body.text, 'message', 200) };
  else if (body.kind === 'reaction') {
    if (!REACTIONS.includes(body.text as (typeof REACTIONS)[number])) throw new OnlineError(400, 'invalid', 'Invalid reaction', { field: 'text' });
    m = { ...base, kind: 'reaction', text: body.text as string };
  } else if (body.kind === 'voice') {
    const audio = body.audio;
    if (typeof audio !== 'string' || !/^data:audio\/[\w.+-]+(;[\w=.+-]+)*;base64,[A-Za-z0-9+/=]+$/.test(audio) || audio.length > VOICE_MAX_CHARS) {
      throw new OnlineError(400, 'invalid', 'Invalid voice message', { field: 'audio' });
    }
    m = { ...base, kind: 'voice', audio, ms: int(body.ms, 'length', 200, VOICE_MAX_MS + 1000) };
  } else throw new OnlineError(400, 'invalid', 'Invalid message', { field: 'kind' });

  t.chatTimes.set(account.id, [...times, now]);
  t.chat.push(m);
  if (t.chat.length > CHAT_KEEP) t.chat.shift();
  const voices = t.chat.filter((x) => x.audio);
  for (const old of voices.slice(0, -VOICE_KEEP)) delete old.audio;
  for (const l of t.listeners) {
    try {
      l.chat(m);
    } catch {
      t.listeners.delete(l);
    }
  }
  return m;
}

/** Tests: forget everything in memory, as after a server restart. */
export function dropMemory() {
  for (const t of live.values()) {
    clearAction(t);
    if (t.nextTimer) clearTimeout(t.nextTimer);
  }
  live.clear();
}
