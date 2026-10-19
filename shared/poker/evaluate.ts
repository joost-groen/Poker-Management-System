import { rankOf, suitOf, type Card } from './cards.ts';

export const CATEGORIES = [
  'highCard', 'pair', 'twoPair', 'trips', 'straight', 'flush', 'fullHouse', 'quads', 'straightFlush',
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface HandRank {
  category: Category;
  /** The ranks that decide the hand, most important first (0 = deuce … 12 = ace). */
  ranks: number[];
}

// Score layout: category in bits 20+, then up to five ranks of 4 bits each. Higher score = better hand.
function pack(category: number, r: number[]): number {
  return (category << 20) | ((r[0] ?? 0) << 16) | ((r[1] ?? 0) << 12) | ((r[2] ?? 0) << 8) | ((r[3] ?? 0) << 4) | (r[4] ?? 0);
}

/** Highest rank of a 5-in-a-row in a rank bitmask (the wheel A-2-3-4-5 counts, topped by the 5), or -1. */
function straightTop(mask: number): number {
  const m = (mask << 1) | ((mask >> 12) & 1);
  for (let top = 13; top >= 4; top--) {
    if (((m >> (top - 4)) & 0x1f) === 0x1f) return top - 1;
  }
  return -1;
}

function topBits(mask: number, n: number): number[] {
  const out: number[] = [];
  for (let r = 12; r >= 0 && out.length < n; r--) if (mask & (1 << r)) out.push(r);
  return out;
}

const counts = new Uint8Array(13);
const suitMasks = new Uint16Array(4);
const suitCounts = new Uint8Array(4);

/** Best five-card hand out of 2 to 7 cards, as a comparable number. */
export function evaluate(cards: readonly Card[]): number {
  counts.fill(0);
  suitMasks.fill(0);
  suitCounts.fill(0);
  let rankMask = 0;
  for (const c of cards) {
    const r = rankOf(c);
    const s = suitOf(c);
    counts[r]++;
    suitMasks[s] |= 1 << r;
    suitCounts[s]++;
    rankMask |= 1 << r;
  }

  let flushMask = 0;
  for (let s = 0; s < 4; s++) {
    if (suitCounts[s] < 5) continue;
    const sf = straightTop(suitMasks[s]);
    if (sf >= 0) return pack(8, [sf]);
    flushMask = suitMasks[s];
  }

  let quad = -1;
  const trips: number[] = [];
  const pairs: number[] = [];
  const singles: number[] = [];
  for (let r = 12; r >= 0; r--) {
    const n = counts[r];
    if (n === 4) quad = r;
    else if (n === 3) trips.push(r);
    else if (n === 2) pairs.push(r);
    else if (n === 1) singles.push(r);
  }

  if (quad >= 0) {
    const kicker = topBits(rankMask & ~(1 << quad), 1);
    return pack(7, [quad, ...kicker]);
  }
  if (trips.length > 0 && (trips.length > 1 || pairs.length > 0)) {
    const second = Math.max(trips[1] ?? -1, pairs[0] ?? -1);
    return pack(6, [trips[0], second]);
  }
  if (flushMask) return pack(5, topBits(flushMask, 5));
  const st = straightTop(rankMask);
  if (st >= 0) return pack(4, [st]);
  if (trips.length > 0) return pack(3, [trips[0], ...singles.slice(0, 2)]);
  if (pairs.length >= 2) {
    const kicker = Math.max(pairs[2] ?? -1, singles[0] ?? -1);
    return pack(2, kicker >= 0 ? [pairs[0], pairs[1], kicker] : [pairs[0], pairs[1]]);
  }
  if (pairs.length === 1) return pack(1, [pairs[0], ...singles.slice(0, 3)]);
  return pack(0, singles.slice(0, 5));
}

const RANK_COUNT: Record<Category, number> = {
  highCard: 5, pair: 4, twoPair: 3, trips: 3, straight: 1, flush: 5, fullHouse: 2, quads: 2, straightFlush: 1,
};

export function categoryOf(score: number): Category {
  return CATEGORIES[score >> 20];
}

export function describe(score: number): HandRank {
  const category = categoryOf(score);
  const all = [(score >> 16) & 15, (score >> 12) & 15, (score >> 8) & 15, (score >> 4) & 15, score & 15];
  return { category, ranks: all.slice(0, RANK_COUNT[category]) };
}
