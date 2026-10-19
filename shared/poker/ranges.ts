import { mathRng, rankOf, suitOf, type Card, type Rng } from './cards.ts';
import { describe, evaluate } from './evaluate.ts';
import { positionOf, type Street } from './holdem.ts';
import { handGroup, OPEN_RANGE, shortHandedBonus } from './preflop.ts';
import type { HandView } from './view.ts';

// Hand reading: what an opponent probably holds, given how they played, and equity against those hands
// instead of against random cards. A raise from early position is a strong range; a bet on the turn
// usually means a pair or a draw.

/** All 1326 two-card combinations with their starting-hand group, sorted best first. */
const COMBOS: { a: Card; b: Card; group: number }[] = [];
for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) COMBOS.push({ a, b, group: handGroup([a, b]) });
/** BY_GROUP[g]: every combination in group g or better. */
const BY_GROUP: { a: Card; b: Card }[][] = Array.from({ length: 10 }, (_, g) => COMBOS.filter((c) => c.group <= Math.max(g, 1)));

/** Share of all starting hands in group `g` or better. */
export function rangeShare(group: number): number {
  return BY_GROUP[Math.min(Math.max(group, 1), 9)].length / COMBOS.length;
}

export interface RangeLine {
  /** Board size when the action was taken. */
  board: number;
  /** 'strong': bet or raised; 'some': called a bet. */
  need: 'strong' | 'some';
}

export interface RangeModel {
  id: string;
  /** Worst starting-hand group they would play this way (9 = any two cards). */
  group: number;
  lines: RangeLine[];
}

const BOARD_AT: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5, showdown: 5 };

/** What player `i` likely holds. `postflop` false reads the preflop action only. */
export function readRange(view: Pick<HandView, 'players' | 'actions' | 'button' | 'sbIndex' | 'bbIndex'>, i: number, postflop = true): RangeModel {
  const p = view.players[i];
  const pos = positionOf(view, i);
  const open = Math.min(OPEN_RANGE[pos] + shortHandedBonus(view.players.length), 8);
  let group = 9;
  let raises = 0;
  const lines: RangeLine[] = [];
  for (const a of view.actions) {
    if (a.type === 'sb' || a.type === 'bb') continue;
    if (a.street === 'preflop') {
      if (a.playerId === p.id) {
        if (a.type === 'raise') group = Math.min(group, raises === 0 ? open : raises === 1 ? 2 : 1);
        else if (a.type === 'call') group = Math.min(group, raises === 0 ? 8 : raises === 1 ? (pos === 'bb' ? 6 : 5) : 2);
      }
      if (a.type === 'raise') raises++;
    } else if (postflop && a.playerId === p.id && (a.type === 'raise' || a.type === 'call')) {
      const board = BOARD_AT[a.street];
      const need = a.type === 'raise' ? 'strong' : 'some';
      const prev = lines.find((l) => l.board === board);
      if (!prev) lines.push({ board, need });
      else if (need === 'strong') prev.need = 'strong';
    }
  }
  return { id: p.id, group, lines };
}

/**
 * How much a hand is worth on a board, in five steps: 0 nothing, 1 a draw, 2 a weak pair,
 * 3 top pair or an overpair, 4 two pair or better that uses a hole card.
 */
export function strength(hole: Card[], board: Card[]): number {
  if (board.length < 3) return 0;
  const cat = evaluate([...hole, ...board]) >> 20;
  const boardCat = evaluate(board) >> 20;
  if (cat >= 3 && cat > boardCat) return 4;
  if (cat === 2) return boardCat === 0 ? 4 : boardCat === 1 ? 3 : 0;
  if (cat === 1 && boardCat === 0) {
    const pair = describe(evaluate([...hole, ...board])).ranks[0];
    return pair >= Math.max(...board.map(rankOf)) ? 3 : 2;
  }
  return board.length < 5 && drawing(hole, board) ? 1 : 0;
}

/** A flush draw or a straight draw (open-ended or gutshot) that uses a hole card. */
function drawing(hole: Card[], board: Card[]): boolean {
  const all = [...hole, ...board];
  for (let s = 0; s < 4; s++) {
    if (all.filter((c) => suitOf(c) === s).length >= 4 && hole.some((c) => suitOf(c) === s)) return true;
  }
  const bits = (cards: Card[]) => cards.reduce((m, c) => m | (1 << (rankOf(c) + 1)) | (rankOf(c) === 12 ? 1 : 0), 0);
  const mask = bits(all);
  const mine = bits(hole);
  for (let low = 0; low <= 9; low++) {
    const window = 0x1f << low;
    let n = 0;
    for (let k = 0; k < 5; k++) if (mask & (1 << (low + k))) n++;
    if (n >= 4 && mask & mine & window) return true;
  }
  return false;
}

/** Chance that a hand matching the preflop range still plays this way; the rest are bluffs and floats. */
const LOOSE: Record<RangeLine['need'], number> = { strong: 0.2, some: 0.3 };

function fits(m: RangeModel, hole: Card[], board: Card[], rng: Rng): boolean {
  for (const line of m.lines) {
    const s = strength(hole, board.slice(0, line.board));
    const ok = line.need === 'strong' ? s >= 3 || s === 1 : s >= 1;
    if (!ok && rng(100) >= LOOSE[line.need] * 100) return false;
  }
  return true;
}

/** Monte Carlo equity of `hole` against the hands the opponents probably hold. */
export function rangeEquity(hole: Card[], board: Card[], models: RangeModel[], samples = 700, rng: Rng = mathRng) {
  if (!models.length) return { equity: 1, samples: 0 };
  const used = new Uint8Array(52);
  const full = new Array<Card>(5);
  const opp: Card[][] = models.map(() => [0, 0]);
  let share = 0;
  for (let i = 0; i < samples; i++) {
    used.fill(0);
    for (const c of hole) used[c] = 1;
    for (const c of board) used[c] = 1;
    for (let o = 0; o < models.length; o++) {
      const m = models[o];
      const list = BY_GROUP[m.group];
      let pick: { a: Card; b: Card } | null = null;
      for (let tries = 0; tries < 40; tries++) {
        const c = list[rng(list.length)];
        if (used[c.a] || used[c.b]) continue;
        pick = c;
        if (fits(m, [c.a, c.b], board, rng)) break;
      }
      if (!pick) pick = { a: free(used, rng), b: -1 };
      used[pick.a] = 1;
      if (pick.b < 0) pick = { a: pick.a, b: free(used, rng) };
      used[pick.b] = 1;
      opp[o][0] = pick.a;
      opp[o][1] = pick.b;
    }
    for (let k = 0; k < 5; k++) {
      if (k < board.length) full[k] = board[k];
      else {
        full[k] = free(used, rng);
        used[full[k]] = 1;
      }
    }
    const hero = evaluate([...hole, ...full]);
    let best = -1;
    let tied = 0;
    for (const h of opp) {
      const v = evaluate([...h, ...full]);
      if (v > best) {
        best = v;
        tied = 0;
      }
      if (v === best) tied++;
    }
    if (hero > best) share++;
    else if (hero === best) share += 1 / (tied + 1);
  }
  return { equity: share / samples, samples };
}

function free(used: Uint8Array, rng: Rng): Card {
  for (;;) {
    const c = rng(52);
    if (!used[c]) return c;
  }
}
