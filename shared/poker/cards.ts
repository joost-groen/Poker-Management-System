// A card is a number 0..51: rank * 4 + suit. Rank 0 = deuce … 12 = ace; suit 0..3 = ♠ ♥ ♦ ♣.
// Numbers keep the evaluator and the Monte Carlo loops fast and the JSON small.

export type Card = number;

/** Integer in [0, n). The server passes crypto.randomInt, the browser a crypto.getRandomValues wrapper. */
export type Rng = (n: number) => number;

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'shdc';
export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'];

export const rankOf = (c: Card) => c >> 2;
export const suitOf = (c: Card) => c & 3;
export const cardOf = (rank: number, suit: number): Card => rank * 4 + suit;

export function newDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

/** Fisher-Yates, in place. */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** "As", "Td" … for logs and tests. */
export function cardName(c: Card): string {
  return RANK_CHARS[rankOf(c)] + SUIT_CHARS[suitOf(c)];
}

export function parseCard(s: string): Card {
  const r = RANK_CHARS.indexOf(s[0].toUpperCase());
  const su = SUIT_CHARS.indexOf(s[1].toLowerCase());
  if (r < 0 || su < 0 || s.length !== 2) throw new Error(`Bad card ${s}`);
  return cardOf(r, su);
}

/** "As Kd Th" → cards. */
export function parseCards(s: string): Card[] {
  return s.trim() ? s.trim().split(/\s+/).map(parseCard) : [];
}

/** Math.random, for bot and coach estimates where fairness doesn't matter. */
export const mathRng: Rng = (n) => Math.floor(Math.random() * n);
