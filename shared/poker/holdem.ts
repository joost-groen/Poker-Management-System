import { newDeck, shuffle, type Card, type Rng } from './cards.ts';
import { evaluate } from './evaluate.ts';

// No-Limit Texas Hold'em, one hand at a time. Pure: every function returns a new state.
// Amounts are integers in the table's unit (cents for cash tables, chips otherwise).

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type ActionType = 'fold' | 'check' | 'call' | 'raise';

export interface Action {
  type: ActionType;
  /** Raise (or bet): the player's total bet on this street after the raise. */
  to?: number;
}

export interface HandPlayer {
  id: string;
  name: string;
  seat: number;
  /** Chips behind, not yet bet. */
  stack: number;
  /** In front of the player on this street. */
  bet: number;
  /** Everything put in this hand, including `bet`. */
  committed: number;
  cards: Card[];
  folded: boolean;
  allIn: boolean;
  /** Has acted since the last full raise on this street. */
  acted: boolean;
}

export interface LoggedAction {
  street: Street;
  playerId: string;
  type: ActionType | 'sb' | 'bb';
  /** The player's bet on this street after the action. */
  amount: number;
  allIn: boolean;
}

export interface PotResult {
  amount: number;
  eligible: string[];
  winners: string[];
}

export interface HandResult {
  showdown: boolean;
  pots: PotResult[];
  /** Chips each player took from the pots (an uncalled bet comes back this way too). */
  won: Record<string, number>;
  /** Won minus committed: the hand's result per player. */
  net: Record<string, number>;
  /** Hole cards turned over at showdown. */
  shown: Record<string, Card[]>;
  scores: Record<string, number>;
}

export interface HandState {
  handNo: number;
  sb: number;
  bb: number;
  /** Dealt-in players, ordered by seat. Indexes below point into this list. */
  players: HandPlayer[];
  button: number;
  sbIndex: number;
  bbIndex: number;
  street: Street;
  board: Card[];
  deck: Card[];
  toAct: number | null;
  currentBet: number;
  /** Smallest allowed raise increment on this street. */
  minRaise: number;
  actions: LoggedAction[];
  result: HandResult | null;
}

export interface Legal {
  fold: boolean;
  check: boolean;
  /** Chips needed to call (0 when checking is possible). Capped at the stack: calling all-in. */
  call: number;
  /** Range for Action.to; max is all-in. Null when raising isn't allowed. */
  raise: { min: number; max: number } | null;
}

export type PokerErrorCode = 'not_enough_players' | 'not_your_turn' | 'illegal_action' | 'hand_over';

export class PokerError extends Error {
  code: PokerErrorCode;
  constructor(code: PokerErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface SeatIn {
  id: string;
  name: string;
  seat: number;
  stack: number;
}

export interface StartOptions {
  players: SeatIn[];
  /** Seat of the previous button; the button moves to the next dealt-in seat. Null: the first player gets it. */
  previousButton: number | null;
  sb: number;
  bb: number;
  rng: Rng;
  handNo: number;
}

export function potTotal(s: Pick<HandState, 'players'>): number {
  return s.players.reduce((sum, p) => sum + p.committed, 0);
}

export function startHand(o: StartOptions): HandState {
  const players: HandPlayer[] = o.players
    .filter((p) => p.stack > 0)
    .sort((a, b) => a.seat - b.seat)
    .map((p) => ({ ...p, bet: 0, committed: 0, cards: [], folded: false, allIn: false, acted: false }));
  const n = players.length;
  if (n < 2) throw new PokerError('not_enough_players', 'Need at least 2 players with chips');

  const after = o.previousButton === null ? -1 : players.findIndex((p) => p.seat > o.previousButton!);
  const button = o.previousButton === null ? 0 : after < 0 ? 0 : after;
  // Heads-up the button posts the small blind and acts first before the flop.
  const sbIndex = n === 2 ? button : (button + 1) % n;
  const bbIndex = (sbIndex + 1) % n;

  const deck = shuffle(newDeck(), o.rng);
  for (let round = 0; round < 2; round++) {
    for (let k = 0; k < n; k++) players[(sbIndex + k) % n].cards.push(deck.pop()!);
  }

  const s: HandState = {
    handNo: o.handNo, sb: o.sb, bb: o.bb, players, button, sbIndex, bbIndex,
    street: 'preflop', board: [], deck, toAct: null, currentBet: o.bb, minRaise: o.bb, actions: [], result: null,
  };
  post(s, sbIndex, o.sb, 'sb');
  post(s, bbIndex, o.bb, 'bb');
  s.toAct = nextToAct(s, bbIndex);
  if (s.toAct === null) endRound(s);
  return s;
}

function post(s: HandState, i: number, blind: number, type: 'sb' | 'bb') {
  const p = s.players[i];
  const amount = Math.min(blind, p.stack);
  p.stack -= amount;
  p.bet += amount;
  p.committed += amount;
  p.allIn = p.stack === 0;
  s.actions.push({ street: 'preflop', playerId: p.id, type, amount: p.bet, allIn: p.allIn });
}

function nextToAct(s: HandState, from: number): number | null {
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    const p = s.players[i];
    if (!p.folded && !p.allIn && (!p.acted || p.bet < s.currentBet)) return i;
  }
  return null;
}

export function legalActions(s: HandState, i: number): Legal | null {
  if (s.result || s.toAct !== i) return null;
  const p = s.players[i];
  const check = p.bet >= s.currentBet;
  const call = check ? 0 : Math.min(s.currentBet - p.bet, p.stack);
  const othersCanAct = s.players.some((q, j) => j !== i && !q.folded && !q.allIn);
  const max = p.bet + p.stack;
  // `acted` is only still set after a short all-in raise, which doesn't reopen the betting.
  const raise = !p.acted && othersCanAct && max > s.currentBet ? { min: Math.min(s.currentBet + s.minRaise, max), max } : null;
  return { fold: true, check, call, raise };
}

/** `who` is the player's index or id. */
export function act(state: HandState, who: number | string, action: Action): HandState {
  if (state.result) throw new PokerError('hand_over', 'The hand is over');
  const i = typeof who === 'number' ? who : state.players.findIndex((p) => p.id === who);
  if (i < 0 || state.toAct !== i) throw new PokerError('not_your_turn', 'Not your turn');
  const s = structuredClone(state);
  const legal = legalActions(s, i)!;
  const p = s.players[i];
  const log = (type: ActionType) => s.actions.push({ street: s.street, playerId: p.id, type, amount: p.bet, allIn: p.allIn });

  switch (action.type) {
    case 'fold':
      p.folded = true;
      log('fold');
      break;
    case 'check':
      if (!legal.check) throw new PokerError('illegal_action', 'Cannot check, there is a bet');
      log('check');
      break;
    case 'call': {
      if (legal.check) {
        log('check');
        break;
      }
      move(p, legal.call);
      log('call');
      break;
    }
    case 'raise': {
      const to = action.to;
      if (!legal.raise || typeof to !== 'number' || !Number.isInteger(to) || to < legal.raise.min || to > legal.raise.max) {
        throw new PokerError('illegal_action', 'Invalid raise');
      }
      const increment = to - s.currentBet;
      move(p, to - p.bet);
      if (increment >= s.minRaise) {
        s.minRaise = increment;
        for (const q of s.players) if (q !== p) q.acted = false;
      }
      s.currentBet = Math.max(s.currentBet, to);
      log('raise');
      break;
    }
    default:
      throw new PokerError('illegal_action', 'Unknown action');
  }
  p.acted = true;

  if (s.players.filter((q) => !q.folded).length === 1) {
    finish(s, false);
    return s;
  }
  s.toAct = nextToAct(s, i);
  if (s.toAct === null) endRound(s);
  return s;
}

function move(p: HandPlayer, amount: number) {
  p.stack -= amount;
  p.bet += amount;
  p.committed += amount;
  p.allIn = p.stack === 0;
}

const NEXT: Record<Street, Street> = { preflop: 'flop', flop: 'turn', turn: 'river', river: 'showdown', showdown: 'showdown' };

/** Bets are matched: deal the next street, or run the board out when at most one player can still bet. */
function endRound(s: HandState) {
  for (;;) {
    for (const p of s.players) {
      p.bet = 0;
      p.acted = false;
    }
    s.currentBet = 0;
    s.minRaise = s.bb;
    s.street = NEXT[s.street];
    if (s.street === 'showdown') {
      finish(s, true);
      return;
    }
    s.deck.pop(); // burn
    const count = s.street === 'flop' ? 3 : 1;
    for (let k = 0; k < count; k++) s.board.push(s.deck.pop()!);
    const canBet = s.players.filter((p) => !p.folded && !p.allIn).length;
    if (canBet >= 2) {
      s.toAct = nextToAct(s, s.button);
      return;
    }
  }
}

function finish(s: HandState, showdown: boolean) {
  const live = s.players.filter((p) => !p.folded);
  const scores: Record<string, number> = {};
  const shown: Record<string, Card[]> = {};
  if (showdown) {
    for (const p of live) {
      scores[p.id] = evaluate([...p.cards, ...s.board]);
      shown[p.id] = p.cards;
    }
  }

  // Side pots: one layer per distinct amount a live player has in.
  const levels = [...new Set(live.map((p) => p.committed))].sort((a, b) => a - b);
  const pots: PotResult[] = [];
  let prev = 0;
  for (const level of levels) {
    const amount = s.players.reduce((sum, p) => sum + Math.max(0, Math.min(p.committed, level) - prev), 0);
    const eligible = live.filter((p) => p.committed >= level).map((p) => p.id);
    if (amount > 0) pots.push({ amount, eligible, winners: [] });
    prev = level;
  }
  const dead = s.players.reduce((sum, p) => sum + Math.max(0, p.committed - prev), 0);
  if (dead > 0 && pots.length) pots[pots.length - 1].amount += dead;

  // Odd chips go to the first winner left of the button.
  const n = s.players.length;
  const order = Array.from({ length: n }, (_, k) => s.players[(s.button + 1 + k) % n].id);
  const won: Record<string, number> = Object.fromEntries(s.players.map((p) => [p.id, 0]));
  for (const pot of pots) {
    let winners = pot.eligible;
    if (showdown && winners.length > 1) {
      const best = Math.max(...winners.map((id) => scores[id]));
      winners = winners.filter((id) => scores[id] === best);
    }
    winners = order.filter((id) => winners.includes(id));
    pot.winners = winners;
    const share = Math.floor(pot.amount / winners.length);
    let rest = pot.amount - share * winners.length;
    for (const id of winners) {
      won[id] += share + (rest > 0 ? 1 : 0);
      rest--;
    }
  }

  const net: Record<string, number> = {};
  for (const p of s.players) {
    p.stack += won[p.id];
    p.bet = 0;
    net[p.id] = won[p.id] - p.committed;
  }
  s.toAct = null;
  if (showdown) s.street = 'showdown';
  s.result = { showdown, pots, won, net, shown, scores };
}

export type Position = 'button' | 'sb' | 'bb' | 'early' | 'middle' | 'late';

export function positionOf(s: { players: unknown[]; button: number; sbIndex: number; bbIndex: number }, i: number): Position {
  if (i === s.button) return 'button';
  if (i === s.sbIndex) return 'sb';
  if (i === s.bbIndex) return 'bb';
  // Seats between the big blind and the button: the first third is early, the last one or two are late.
  const n = s.players.length;
  const others = n - 3;
  const k = (i - s.bbIndex + n) % n;
  if (k >= others - (others >= 5 ? 1 : 0)) return 'late';
  return others >= 3 && k <= Math.ceil(others / 3) ? 'early' : 'middle';
}
