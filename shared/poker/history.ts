import type { Card } from './cards.ts';
import { evaluate } from './evaluate.ts';
import type { HandState, LoggedAction, PotResult, Street } from './holdem.ts';
import type { HandView } from './view.ts';

// A finished hand, kept for the history, replays and stats. Small enough to store as JSON per hand.

export interface RecordPlayer {
  id: string;
  name: string;
  seat: number;
  /** Stack when the hand was dealt. */
  stack: number;
  /** Hole cards. Only ever sent to their owner, or to everyone when shown at showdown. */
  hole: Card[];
  shown: boolean;
  won: number;
  net: number;
}

export interface HandRecord {
  handNo: number;
  sb: number;
  bb: number;
  button: number;
  sbIndex: number;
  bbIndex: number;
  board: Card[];
  players: RecordPlayer[];
  actions: LoggedAction[];
  pots: PotResult[];
  showdown: boolean;
}

export function recordOf(s: HandState): HandRecord {
  const r = s.result!;
  return {
    handNo: s.handNo, sb: s.sb, bb: s.bb, button: s.button, sbIndex: s.sbIndex, bbIndex: s.bbIndex,
    board: [...s.board],
    players: s.players.map((p) => ({
      id: p.id, name: p.name, seat: p.seat, stack: p.stack + p.committed - r.won[p.id], hole: [...p.cards],
      shown: Boolean(r.shown[p.id]), won: r.won[p.id], net: r.net[p.id],
    })),
    actions: s.actions.map((a) => ({ ...a })),
    pots: r.pots.map((p) => ({ ...p, eligible: [...p.eligible], winners: [...p.winners] })),
    showdown: r.showdown,
  };
}

/** Records written before this format lack starting stacks; they are skipped. */
export function isRecord(x: unknown): x is HandRecord {
  const r = x as HandRecord;
  return Boolean(r && Array.isArray(r.players) && r.players.every((p) => typeof p.stack === 'number' && Array.isArray(p.hole)));
}

/** What `viewerId` may see: their own hole cards and the hands shown at showdown. */
export function redact(r: HandRecord, viewerId: string | null): HandRecord {
  return { ...r, players: r.players.map((p) => (p.id === viewerId || p.shown ? p : { ...p, hole: [] })) };
}

/** Chips each player put in, from the log: the last amount per street, added up. */
function committedOf(r: HandRecord): Map<string, number> {
  const last = new Map<string, number>();
  for (const a of r.actions) last.set(`${a.playerId}|${a.street}`, a.amount);
  const out = new Map(r.players.map((p) => [p.id, 0]));
  for (const [key, amount] of last) {
    const id = key.slice(0, key.lastIndexOf('|'));
    out.set(id, (out.get(id) ?? 0) + amount);
  }
  return out;
}

/** The table as dealt and as it ended, as `viewerId` saw it: the replay plays the frames between them. */
export function replayViews(r: HandRecord, viewerId: string | null): { start: HandView; end: HandView } {
  const committed = committedOf(r);
  const you = r.players.findIndex((p) => p.id === viewerId);
  const base = {
    handNo: r.handNo, sb: r.sb, bb: r.bb, button: r.button, sbIndex: r.sbIndex, bbIndex: r.bbIndex,
    toAct: null, minRaise: r.bb, legal: null, you: you < 0 ? null : you,
  };
  const start: HandView = {
    ...base, street: 'preflop', board: [], currentBet: 0, actions: [], result: null, pot: 0,
    players: r.players.map((p) => ({
      id: p.id, name: p.name, seat: p.seat, stack: p.stack, bet: 0, committed: 0, folded: false, allIn: false, acted: false,
      cards: p.id === viewerId && p.hole.length ? p.hole : null,
    })),
  };
  const shown = Object.fromEntries(r.players.filter((p) => p.shown && p.hole.length).map((p) => [p.id, p.hole]));
  const scores = Object.fromEntries(Object.entries(shown).map(([id, hole]) => [id, evaluate([...hole, ...r.board])]));
  const lastStreet: Street = r.actions.at(-1)?.street ?? 'preflop';
  const end: HandView = {
    ...base, street: r.showdown ? 'showdown' : lastStreet, board: [...r.board], currentBet: 0, actions: r.actions,
    pot: [...committed.values()].reduce((a, b) => a + b, 0),
    players: r.players.map((p) => {
      const mine = r.actions.filter((a) => a.playerId === p.id);
      const c = committed.get(p.id) ?? 0;
      return {
        id: p.id, name: p.name, seat: p.seat, stack: p.stack - c + p.won, bet: 0, committed: c,
        folded: mine.some((a) => a.type === 'fold'), allIn: mine.at(-1)?.allIn ?? false, acted: true,
        cards: shown[p.id] ?? (p.id === viewerId && p.hole.length ? p.hole : null),
      };
    }),
    result: {
      showdown: r.showdown, pots: r.pots, shown, scores,
      won: Object.fromEntries(r.players.map((p) => [p.id, p.won])),
      net: Object.fromEntries(r.players.map((p) => [p.id, p.net])),
    },
  };
  return { start, end };
}

/** Per-player habits in one hand, for the stats. */
export interface HandFlags {
  /** Put money in voluntarily before the flop. */
  vpip: boolean;
  /** Raised before the flop. */
  pfr: boolean;
  /** Faced exactly one raise before the flop, so could 3-bet. */
  threeBetChance: boolean;
  threeBet: boolean;
  sawFlop: boolean;
  /** Saw the flop and went to showdown. */
  wtsd: boolean;
  /** Won chips at showdown. */
  wsd: boolean;
}

export function handFlags(r: HandRecord): Record<string, HandFlags> {
  const out: Record<string, HandFlags> = {};
  for (const p of r.players) {
    out[p.id] = { vpip: false, pfr: false, threeBetChance: false, threeBet: false, sawFlop: false, wtsd: false, wsd: false };
  }
  let raises = 0;
  const chanceTaken = new Set<string>();
  for (const a of r.actions) {
    if (a.street !== 'preflop' || a.type === 'sb' || a.type === 'bb') continue;
    const f = out[a.playerId];
    if (raises === 1 && !chanceTaken.has(a.playerId)) {
      chanceTaken.add(a.playerId);
      f.threeBetChance = true;
      if (a.type === 'raise') f.threeBet = true;
    }
    if (a.type === 'call' || a.type === 'raise') f.vpip = true;
    if (a.type === 'raise') {
      f.pfr = true;
      raises++;
    }
  }
  for (const p of r.players) {
    const foldedOn = r.actions.find((a) => a.playerId === p.id && a.type === 'fold')?.street;
    const f = out[p.id];
    f.sawFlop = r.board.length >= 3 && foldedOn !== 'preflop';
    f.wtsd = f.sawFlop && r.showdown && !foldedOn;
    f.wsd = f.wtsd && p.won > 0;
  }
  return out;
}
