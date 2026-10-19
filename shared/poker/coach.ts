import { decide, openingRange, type Reason } from './bots.ts';
import { equity, type Outs } from './equity.ts';
import { describe, evaluate, type HandRank } from './evaluate.ts';
import { positionOf, type Action, type Position, type Street } from './holdem.ts';
import { handGroup, handLabel } from './preflop.ts';
import { rangeEquity, rangeShare, readRange } from './ranges.ts';
import type { HandView } from './view.ts';

// Learn mode: the numbers behind a decision, a suggested line, and feedback on what the player did.
// Everything is codes and numbers; the client words them in the current language.

export interface Advice {
  street: Street;
  position: Position;
  start: { label: string; group: number; /** Worst group worth opening from this position. */ range: number };
  /** Made hand, from the flop on. */
  hand: HandRank | null;
  /** Against the hands the opponents' actions point to. */
  equity: number;
  /** Against random cards, for comparison. */
  equityAny: number;
  /** Each live opponent's likely range: share of all starting hands, and whether bets after the flop narrowed it. */
  ranges: { id: string; name: string; share: number; narrowed: boolean }[];
  opponents: number;
  toCall: number;
  pot: number;
  potOdds: number;
  outs: Outs | null;
  suggestion: Action;
  reason: Reason;
}

export function advise(view: HandView): Advice {
  const me = view.you!;
  const p = view.players[me];
  const cards = p.cards!;
  const d = decide(view, 'coach', () => 0.999);
  const live = view.players.flatMap((q, i) => (i !== me && !q.folded ? [i] : []));
  const opponents = live.length;
  const models = live.map((i) => readRange(view, i));
  const position = positionOf(view, me);
  return {
    street: view.street,
    position,
    start: { label: handLabel(cards), group: handGroup(cards), range: openingRange(position) },
    hand: view.board.length ? describe(evaluate([...cards, ...view.board])) : null,
    equity: d.equity ?? rangeEquity(cards, view.board, models, 1500).equity,
    equityAny: equity(cards, view.board, opponents, 800).equity,
    ranges: models.map((m, k) => ({ id: m.id, name: view.players[live[k]].name, share: rangeShare(m.group), narrowed: m.lines.length > 0 })),
    opponents,
    toCall: view.legal!.call,
    pot: view.pot,
    potOdds: d.potOdds,
    outs: d.outs,
    suggestion: d.action,
    reason: d.reason,
  };
}

export type Verdict = 'good' | 'ok' | 'mistake';
export type Leak = 'loose' | 'tight' | 'passive' | 'calling' | 'freeFold';
export type FeedbackCode =
  | 'followed' | 'different' | 'goodFold' | 'goodCall' | 'goodValue'
  | 'freeFold' | 'foldWithOdds' | 'callWithoutOdds' | 'missedValue' | 'looseEntry' | 'tightFold' | 'passivePremium' | 'riskyBluff';

export interface Feedback {
  verdict: Verdict;
  code: FeedbackCode;
  leak: Leak | null;
  street: Street;
  equity: number;
  needed: number;
  action: Action;
  suggestion: Action;
}

const DRAW_CREDIT = 0.05;

/** How the player's action compares to the advice given for the same spot. `canCheck`: checking was free. */
export function review(advice: Advice, action: Action, canCheck: boolean): Feedback {
  const t = action.type === 'call' && canCheck ? 'check' : action.type;
  const s = advice.suggestion.type;
  const eq = advice.equity;
  const need = advice.potOdds;
  const make = (verdict: Verdict, code: FeedbackCode, leak: Leak | null = null): Feedback => ({
    verdict, code, leak, street: advice.street, equity: eq, needed: need, action, suggestion: advice.suggestion,
  });
  const same = t === s;

  if (t === 'fold' && canCheck) return make('mistake', 'freeFold', 'freeFold');

  if (advice.street === 'preflop') {
    const { group, range } = advice.start;
    if (t === 'fold') {
      if (group <= 2) return make('mistake', 'tightFold', 'tight');
      return same ? make('good', 'goodFold') : make('ok', 'different');
    }
    if ((t === 'call' || t === 'raise') && (s === 'fold' || s === 'check') && group > range + 2) {
      return make('mistake', 'looseEntry', 'loose');
    }
    if (t === 'call' && group <= 2 && s === 'raise') return make('ok', 'passivePremium', 'passive');
    return same ? make('good', 'followed') : make('ok', 'different');
  }

  const drawing = (advice.outs?.byCategory.flush ?? 0) + (advice.outs?.byCategory.straight ?? 0) >= 8 && advice.street !== 'river';
  switch (t) {
    case 'fold':
      return eq >= need + 0.1 ? make('mistake', 'foldWithOdds', 'tight') : make('good', 'goodFold');
    case 'call':
      return eq + (drawing ? DRAW_CREDIT : 0) < need - 0.08 ? make('mistake', 'callWithoutOdds', 'calling') : make('good', 'goodCall');
    case 'check':
      if (eq >= 0.7) return make('ok', 'missedValue', 'passive');
      return same ? make('good', 'followed') : make('ok', 'different');
    case 'raise':
      if (eq >= 0.6) return make('good', 'goodValue');
      if (eq < 0.35 && !drawing) return make('ok', 'riskyBluff');
      return same ? make('good', 'followed') : make('ok', 'different');
  }
}

export function countLeaks(feedback: Feedback[]): Partial<Record<Leak, number>> {
  const out: Partial<Record<Leak, number>> = {};
  for (const f of feedback) if (f.leak) out[f.leak] = (out[f.leak] ?? 0) + 1;
  return out;
}
