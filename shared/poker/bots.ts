import { rankOf } from './cards.ts';
import { equity, outs, potOdds, type Outs } from './equity.ts';
import { positionOf, type Action, type Position, type Street } from './holdem.ts';
import { handGroup, isPair, isSuited, OPEN_RANGE, shortHandedBonus } from './preflop.ts';
import { rangeEquity, readRange } from './ranges.ts';
import type { HandView } from './view.ts';

export type BotLevel = 'beginner' | 'casual' | 'regular' | 'shark';
export const BOT_LEVELS: BotLevel[] = ['beginner', 'casual', 'regular', 'shark'];

/** Why a decision was made; the coach turns these into tips. */
export type Reason =
  | 'premium' | 'openRange' | 'limp' | 'outsideRange' | 'freeCheck' | 'shortShove'
  | 'threeBetValue' | 'threeBetBluff' | 'defendRange' | 'foldToRaise'
  | 'valueBet' | 'semiBluff' | 'cBet' | 'bluff' | 'checkBehind'
  | 'raiseValue' | 'callOdds' | 'callDraw' | 'foldOdds' | 'stickyCall' | 'mix';

export interface Decision {
  action: Action;
  reason: Reason;
  /** Postflop only. */
  equity: number | null;
  potOdds: number;
  outs: Outs | null;
}

interface Profile {
  /** Worst starting-hand group opened from each position. */
  open: Record<Position, number>;
  /** Chance to raise (rather than limp) a hand inside the opening range. */
  raiseFreq: number;
  /** Worst group limped when nobody raised. */
  limp: number;
  /** Chance to limp a weaker hand anyway when it only costs a big blind. */
  limpLoose?: number;
  threeBet: number;
  bluff3Bet: number;
  callRaise: number;
  /** Defends one group wider in position and from the big blind. */
  positional: boolean;
  callFourBet: number;
  /** Equity to bet for value; raises need valueEq + 0.15. */
  valueEq: number;
  /** Calls when equity ≥ pot odds × callSlack. Below 1 = calls too much. */
  callSlack: number;
  /** Equity is measured against random hands; a bet means a stronger range, so this much is taken off per pot-sized bet. */
  respect: number;
  /** Plays wider at short tables, where hands are worth more. */
  shortHanded: boolean;
  /** Extra equity credited to draws for future bets (implied odds). */
  implied: number;
  /** Chance to call anyway when the odds say fold. */
  sticky: number;
  bluff: number;
  semiBluff: number;
  cBet: number;
  sizing: (eq: number) => number;
  /** Hand reading: 0 counts every opponent as random cards, 1 reads their preflop action, 2 every street. */
  reads: 0 | 1 | 2;
  samples: number;
  /** Chance of a random passive move, so a bot can't be read perfectly. */
  noise: number;
}

const PROFILES: Record<Exclude<BotLevel, 'casual'> | 'coach', Profile> = {
  beginner: {
    open: { early: 5, middle: 6, late: 7, button: 7, sb: 7, bb: 7 },
    raiseFreq: 0.25, limp: 8, threeBet: 1, bluff3Bet: 0, callRaise: 7, positional: false, callFourBet: 4,
    valueEq: 0.72, callSlack: 0.55, respect: 0, shortHanded: false, implied: 0.1, sticky: 0.2, bluff: 0.03, semiBluff: 0.05, cBet: 0.2,
    sizing: () => 0.5, reads: 0, samples: 250, noise: 0.1,
  },
  regular: {
    open: { early: 3, middle: 4, late: 5, button: 6, sb: 5, bb: 5 },
    raiseFreq: 1, limp: 0, threeBet: 2, bluff3Bet: 0, callRaise: 3, positional: false, callFourBet: 2,
    valueEq: 0.6, callSlack: 1, respect: 0.08, shortHanded: true, implied: 0.04, sticky: 0, bluff: 0.06, semiBluff: 0.3, cBet: 0.5,
    sizing: () => 0.66, reads: 1, samples: 500, noise: 0.03,
  },
  shark: {
    open: { early: 3, middle: 5, late: 6, button: 7, sb: 6, bb: 6 },
    raiseFreq: 1, limp: 0, threeBet: 2, bluff3Bet: 0.15, callRaise: 4, positional: true, callFourBet: 2,
    valueEq: 0.56, callSlack: 0.95, respect: 0, shortHanded: true, implied: 0.06, sticky: 0, bluff: 0.18, semiBluff: 0.55, cBet: 0.65,
    sizing: (eq) => (eq > 0.8 ? 1 : eq > 0.65 ? 0.75 : 0.55), reads: 2, samples: 700, noise: 0,
  },
  // Solid, readable baseline for Learn mode: never random, so a tip explains one clear line.
  coach: {
    open: OPEN_RANGE,
    raiseFreq: 1, limp: 0, threeBet: 2, bluff3Bet: 0, callRaise: 3, positional: true, callFourBet: 1,
    valueEq: 0.58, callSlack: 1, respect: 0, shortHanded: true, implied: 0.05, sticky: 0, bluff: 0, semiBluff: 1, cBet: 1,
    sizing: (eq) => (eq > 0.8 ? 0.75 : 0.6), reads: 2, samples: 1200, noise: 0,
  },
};

/** The Beginner's loose, passive preflop game, a little looser still: limps most hands and calls raises to see the flop. */
const CASUAL_PREFLOP: Profile = { ...PROFILES.beginner, limpLoose: 0.4, callRaise: 8, sticky: 0.3, raiseFreq: 0.2 };

/**
 * The Casual plays two games: the Beginner's before the flop (limps and calls a lot, because seeing flops is
 * the fun part) and the Regular's from the flop on (bets when ahead, folds without the odds).
 */
export function profileFor(level: BotLevel | 'coach', street: Street): Profile {
  if (level === 'casual') return street === 'preflop' ? CASUAL_PREFLOP : PROFILES.regular;
  return PROFILES[level];
}

export function openingRange(pos: Position): number {
  return PROFILES.coach.open[pos];
}

/** Decision for the player at `view.you`; it must be their turn. `random` returns [0, 1). */
export function decide(view: HandView, level: BotLevel | 'coach', random: () => number = Math.random): Decision {
  const me = view.you!;
  const legal = view.legal!;
  const prof = profileFor(level, view.street);
  const p = view.players[me];
  const cards = p.cards!;
  const pos = positionOf(view, me);
  const opponents = view.players.filter((q, i) => i !== me && !q.folded).length;
  const odds = potOdds(legal.call, view.pot);
  const out = (action: Action, reason: Reason, eq: number | null = null, o: Outs | null = null): Decision => ({
    action, reason, equity: eq, potOdds: odds, outs: o,
  });
  const check = (): Action => (legal.check ? { type: 'check' } : { type: 'fold' });
  const call = (): Action => (legal.check ? { type: 'check' } : { type: 'call' });
  /** Raise to roughly `target`, rounded to small blinds; close to all-in becomes all-in. */
  const raise = (target: number): Action | null => {
    if (!legal.raise) return null;
    const { min, max } = legal.raise;
    let to = Math.min(Math.max(Math.round(target / view.sb) * view.sb, min), max);
    if (to >= max * 0.85) to = max;
    return { type: 'raise', to };
  };

  // The random move stays cheap: a passive bot never pays off a big bet or a shove just to be unpredictable.
  if (level !== 'coach' && random() < prof.noise) {
    const cheap = legal.check || legal.call <= Math.max(view.bb, (p.stack + p.bet) * 0.1);
    return out(cheap && random() < 0.5 ? call() : check(), 'mix');
  }
  return view.street === 'preflop' ? preflop() : postflop();

  function preflop(): Decision {
    const g = handGroup(cards);
    const raises = view.actions.filter((a) => a.street === 'preflop' && a.type === 'raise').length;
    const limpers = view.actions.filter((a) => a.street === 'preflop' && a.type === 'call').length;
    const stackBb = (p.stack + p.bet) / view.bb;
    // In position after the flop; the small blind steals late but plays every pot out of position.
    const late = pos === 'late' || pos === 'button';
    const n = view.players.length;
    const wider = prof.shortHanded ? shortHandedBonus(n) : 0;
    const open = prof.open[pos] + wider;

    if (raises === 0) {
      if (g <= open && stackBb <= 12 && legal.raise) return out(raise(legal.raise.max)!, 'shortShove');
      if (g <= open) {
        const r = random() < prof.raiseFreq ? raise(view.bb * (3 + limpers)) : null;
        if (r) return out(r, g <= 2 ? 'premium' : 'openRange');
        return out(call(), legal.check ? 'freeCheck' : 'limp');
      }
      if (legal.check) return out(check(), 'freeCheck');
      if (g <= prof.limp || (legal.call <= view.bb && random() < (prof.limpLoose ?? 0))) return out(call(), 'limp');
      return out(check(), 'outsideRange');
    }

    if (raises === 1) {
      if (g <= prof.threeBet) {
        const r = raise(view.currentBet * (late ? 3 : 3.5));
        if (r) return out(r, 'threeBetValue');
        return out(call(), 'premium');
      }
      const bluffable = isSuited(cards) && (rankOf(cards[0]) === 12 || rankOf(cards[1]) === 12 || Math.abs(rankOf(cards[0]) - rankOf(cards[1])) === 1);
      if (late && bluffable && random() < prof.bluff3Bet) {
        const r = raise(view.currentBet * 3);
        if (r) return out(r, 'threeBetBluff');
      }
      const range = prof.callRaise + wider + (prof.positional && (late || pos === 'bb') ? 1 : 0);
      if (g <= range && legal.call <= (p.stack + p.bet) * 0.25) return out(call(), 'defendRange');
      if (g <= 8 && random() < prof.sticky) return out(call(), 'stickyCall');
      return out(check(), 'foldToRaise');
    }

    if (g === 1 && (isPair(cards) && rankOf(cards[0]) >= 11)) {
      const r = raise(view.currentBet * 2.3);
      if (r) return out(r, 'premium');
    }
    if (g <= prof.callFourBet) return out(call(), 'defendRange');
    return out(check(), 'foldToRaise');
  }

  function postflop(): Decision {
    const eq = postflopEquity(view, prof.reads, prof.samples);
    const o = outs(cards, view.board);
    const drawOuts = (o?.byCategory.flush ?? 0) + (o?.byCategory.straight ?? 0) + (o?.byCategory.straightFlush ?? 0);
    const draw = view.street !== 'river' && drawOuts >= 8;
    const pot = view.pot;
    const live = view.players.map((q, i) => ({ q, i })).filter(({ q }) => !q.folded);
    const order = live.map(({ i }) => (i - view.button - 1 + view.players.length) % view.players.length);
    const inPosition = Math.max(...order) === (me - view.button - 1 + view.players.length) % view.players.length;
    const lastPreflopRaise = view.actions.filter((a) => a.street === 'preflop' && a.type === 'raise').at(-1);
    const aggressor = lastPreflopRaise?.playerId === p.id;
    const bet = (fraction: number) => raise(p.bet + pot * fraction);

    if (legal.check) {
      if (eq >= prof.valueEq) {
        const r = bet(prof.sizing(eq));
        if (r) return out(r, 'valueBet', eq, o);
      }
      if (draw && random() < prof.semiBluff) {
        const r = bet(0.6);
        if (r) return out(r, 'semiBluff', eq, o);
      }
      if (aggressor && view.street === 'flop' && opponents <= 2 && random() < prof.cBet) {
        const r = bet(0.5);
        if (r) return out(r, 'cBet', eq, o);
      }
      if (random() < prof.bluff * (view.street === 'river' && inPosition ? 1.5 : 1)) {
        const r = bet(0.6);
        if (r) return out(r, 'bluff', eq, o);
      }
      return out({ type: 'check' }, 'checkBehind', eq, o);
    }

    const betSize = Math.min(1, legal.call / Math.max(pot - legal.call, 1));
    const strength = eq - prof.respect * betSize;
    if (strength >= prof.valueEq + 0.15) {
      const r = raise(view.currentBet + (pot + legal.call) * 0.75);
      if (r) return out(r, 'raiseValue', eq, o);
    }
    const implied = draw ? prof.implied : 0;
    if (strength + implied >= odds * prof.callSlack) return out(call(), draw && eq < odds ? 'callDraw' : 'callOdds', eq, o);
    if (random() < prof.sticky) return out(call(), 'stickyCall', eq, o);
    return out({ type: 'fold' }, 'foldOdds', eq, o);
  }
}

/** Equity against the opponents still in: random cards, or the hands their actions point to. */
export function postflopEquity(view: HandView, reads: 0 | 1 | 2, samples: number): number {
  const me = view.you!;
  const cards = view.players[me].cards!;
  const live = view.players.flatMap((q, i) => (i !== me && !q.folded ? [i] : []));
  if (!reads) return equity(cards, view.board, live.length, samples).equity;
  return rangeEquity(cards, view.board, live.map((i) => readRange(view, i, reads === 2)), samples).equity;
}

/** Display data for a bot opponent. */
export const BOT_STYLE: Record<BotLevel, { avatars: string[]; names: string[] }> = {
  beginner: { avatars: ['🐣', '🐥', '🐼', '🐨', '🐹'], names: ['Pip', 'Lou', 'Mo', 'Tess', 'Bo'] },
  casual: { avatars: ['🐶', '🐱', '🐰', '🦆', '🐸'], names: ['Finn', 'Mia', 'Leo', 'Juna', 'Ole'] },
  regular: { avatars: ['🦊', '🦉', '🐺', '🦝', '🐻'], names: ['Rhea', 'Otto', 'Vera', 'Nils', 'Ida'] },
  shark: { avatars: ['🦈', '🐙', '🦅', '🐍', '🐯'], names: ['Vex', 'Kaya', 'Rook', 'Sly', 'Nova'] },
};
