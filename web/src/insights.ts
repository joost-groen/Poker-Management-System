import type { PlayerGame } from '../../shared/types.ts';
import { niceStep } from './components/StepChart.tsx';

// Player numbers derived from their game list (newest first, as the API sends it).

/** Share of games with a profit, 0–1. */
export function winRate(games: PlayerGame[]): number {
  return games.length ? games.filter((g) => g.result > 0).length / games.length : 0;
}

/** Net result per money put in (all buy-ins), e.g. 0.12 = 12 cents back on every euro. */
export function roi(games: PlayerGame[]): number {
  const invested = games.reduce((s, g) => s + g.buyins * g.buyIn, 0);
  return invested ? games.reduce((s, g) => s + g.result, 0) / invested : 0;
}

/** Rebuys after the opening buy-in, per game. */
export function avgRebuys(games: PlayerGame[]): number {
  return games.length ? games.reduce((s, g) => s + g.buyins - 1, 0) / games.length : 0;
}

export function avgPlace(games: PlayerGame[]): number {
  return games.length ? games.reduce((s, g) => s + g.place, 0) / games.length : 0;
}

/** Standard deviation of results in cents: how far a typical night swings from the average. */
export function volatility(games: PlayerGame[]): number {
  if (games.length < 2) return 0;
  const mean = games.reduce((s, g) => s + g.result, 0) / games.length;
  return Math.round(Math.sqrt(games.reduce((s, g) => s + (g.result - mean) ** 2, 0) / games.length));
}

export interface Streaks {
  /** Positive = wins in a row, negative = losses in a row, 0 = last game broke even. */
  current: number;
  wins: number;
  losses: number;
}

/** Runs of profitable / losing games; a game that breaks even ends both. */
export function streaks(games: PlayerGame[]): Streaks {
  let run = 0;
  let wins = 0;
  let losses = 0;
  for (const g of [...games].reverse()) {
    const side = Math.sign(g.result);
    run = side === 0 ? 0 : Math.sign(run) === side ? run + side : side;
    wins = Math.max(wins, run);
    losses = Math.max(losses, -run);
  }
  return { current: run, wins, losses };
}

/** A range of results in cents: losses fall in [lo, hi), wins in (lo, hi]; lo = hi = 0 is break-even. */
export interface Bucket {
  lo: number;
  hi: number;
  count: number;
}

/**
 * Results grouped into equal ranges on both sides of zero (zero is always an edge, so no range mixes wins and
 * losses). Break-even games get their own bucket.
 */
export function histogram(games: PlayerGame[], count = 8): Bucket[] {
  if (!games.length) return [];
  const values = games.map((g) => g.result);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const step = niceStep(max - min, count);
  const buckets: Bucket[] = [];
  for (let lo = Math.floor(min / step) * step; lo < 0; lo += step) buckets.push({ lo, hi: lo + step, count: 0 });
  if (values.includes(0)) buckets.push({ lo: 0, hi: 0, count: 0 });
  for (let lo = 0; lo < max; lo += step) buckets.push({ lo, hi: lo + step, count: 0 });
  for (const v of values) {
    const b = v === 0 ? buckets.find((x) => x.hi === 0 && x.lo === 0) : v < 0
      ? buckets.find((x) => v >= x.lo && v < x.hi)
      : buckets.find((x) => x.hi > x.lo && x.lo >= 0 && v > x.lo && v <= x.hi);
    if (b) b.count++;
  }
  return buckets;
}
