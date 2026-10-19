import { RANK_CHARS, rankOf, suitOf, type Card } from './cards.ts';

/** "AKs", "QQ", "T9o". */
export function handLabel(hole: Card[]): string {
  const [a, b] = [...hole].sort((x, y) => rankOf(y) - rankOf(x));
  const hi = RANK_CHARS[rankOf(a)];
  const lo = RANK_CHARS[rankOf(b)];
  if (hi === lo) return hi + lo;
  return hi + lo + (suitOf(a) === suitOf(b) ? 's' : 'o');
}

// Starting-hand groups after Sklansky: 1 is best, 8 is the weakest still playable, 9 is everything else.
const GROUPS: string[][] = [
  ['AA', 'KK', 'QQ', 'JJ', 'AKs'],
  ['TT', 'AQs', 'AJs', 'KQs', 'AKo'],
  ['99', 'ATs', 'KJs', 'QJs', 'JTs', 'AQo'],
  ['88', 'KTs', 'QTs', 'J9s', 'T9s', '98s', 'AJo', 'KQo'],
  ['77', 'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s', 'Q9s', 'T8s', '97s', '87s', '76s', 'KJo', 'QJo', 'JTo'],
  ['66', '55', 'K9s', 'J8s', '86s', '75s', '65s', '54s', 'ATo', 'KTo', 'QTo'],
  ['44', '33', '22', 'K8s', 'K7s', 'K6s', 'K5s', 'K4s', 'K3s', 'K2s', 'Q8s', 'T7s', '64s', '53s', '43s', 'J9o', 'T9o', '98o'],
  ['J7s', '96s', '85s', '74s', '42s', '32s', 'A9o', 'K9o', 'Q9o', 'J8o', 'T8o', '87o', '76o', '65o', '54o'],
];
const GROUP_OF = new Map(GROUPS.flatMap((labels, i) => labels.map((l) => [l, i + 1] as const)));

export function handGroup(hole: Card[]): number {
  return GROUP_OF.get(handLabel(hole)) ?? 9;
}

export const isSuited = (hole: Card[]) => suitOf(hole[0]) === suitOf(hole[1]);
export const isPair = (hole: Card[]) => rankOf(hole[0]) === rankOf(hole[1]);

/** Worst starting-hand group worth opening (raising first in) from each position at a full table. */
export const OPEN_RANGE = { early: 3, middle: 4, late: 5, button: 6, sb: 5, bb: 5 } as const;

/** Short tables play wider: hands are worth more with fewer players left to act. */
export function shortHandedBonus(players: number): number {
  return players <= 2 ? 2 : players <= 4 ? 1 : 0;
}
