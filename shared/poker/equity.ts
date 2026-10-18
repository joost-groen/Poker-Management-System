import { mathRng, type Card, type Rng } from './cards.ts';
import { categoryOf, CATEGORIES, evaluate, type Category } from './evaluate.ts';

export interface Equity {
  win: number;
  tie: number;
  /** Win plus the shared part of ties: the share of the pot this hand earns on average. */
  equity: number;
  samples: number;
}

/** Monte Carlo equity of `hole` against `opponents` random hands, completing the board each time. */
export function equity(hole: Card[], board: Card[], opponents: number, samples = 1000, rng: Rng = mathRng): Equity {
  if (opponents < 1) return { win: 1, tie: 0, equity: 1, samples: 0 };
  const known = new Set([...hole, ...board]);
  const rest: Card[] = [];
  for (let c = 0; c < 52; c++) if (!known.has(c)) rest.push(c);
  const missing = 5 - board.length;
  const need = opponents * 2 + missing;
  const full = [...board];
  const heroCards = [...hole, ...board];
  const oppCards = new Array<Card>(7);

  let win = 0;
  let tie = 0;
  let share = 0;
  for (let i = 0; i < samples; i++) {
    // Partial Fisher-Yates: the first `need` cards of `rest` become a fresh random draw.
    for (let k = 0; k < need; k++) {
      const j = k + rng(rest.length - k);
      const t = rest[k];
      rest[k] = rest[j];
      rest[j] = t;
    }
    for (let k = 0; k < missing; k++) {
      full[board.length + k] = rest[opponents * 2 + k];
      heroCards[hole.length + board.length + k] = rest[opponents * 2 + k];
    }
    const hero = evaluate(heroCards);
    let best = -1;
    let tied = 0;
    for (let o = 0; o < opponents; o++) {
      oppCards[0] = rest[o * 2];
      oppCards[1] = rest[o * 2 + 1];
      for (let k = 0; k < 5; k++) oppCards[2 + k] = full[k];
      const v = evaluate(oppCards);
      if (v > best) {
        best = v;
        tied = 0;
      }
      if (v === best) tied++;
    }
    if (hero > best) {
      win++;
      share++;
    } else if (hero === best) {
      tie++;
      share += 1 / (tied + 1);
    }
  }
  return { win: win / samples, tie: tie / samples, equity: share / samples, samples };
}

export interface Outs {
  total: number;
  /** Outs per hand they make, e.g. { flush: 9 }. */
  byCategory: Partial<Record<Category, number>>;
}

/** Cards that improve the player's hand to something the board alone doesn't give everyone. Flop and turn only. */
export function outs(hole: Card[], board: Card[]): Outs | null {
  if (board.length < 3 || board.length > 4) return null;
  const all = [...hole, ...board];
  const current = categoryOf(evaluate(all));
  const known = new Set(all);
  const byCategory: Partial<Record<Category, number>> = {};
  let total = 0;
  for (let c = 0; c < 52; c++) {
    if (known.has(c)) continue;
    const next = categoryOf(evaluate([...all, c]));
    const boardOnly = categoryOf(evaluate([...board, c]));
    if (CATEGORIES.indexOf(next) > CATEGORIES.indexOf(current) && CATEGORIES.indexOf(next) > CATEGORIES.indexOf(boardOnly)) {
      total++;
      byCategory[next] = (byCategory[next] ?? 0) + 1;
    }
  }
  return { total, byCategory };
}

/** Share of the final pot a call has to win to break even. */
export function potOdds(toCall: number, pot: number): number {
  return toCall <= 0 ? 0 : toCall / (pot + toCall);
}
