import type { Card } from './cards.ts';
import { legalActions, potTotal, type HandPlayer, type HandState, type Legal, type Street } from './holdem.ts';

export interface PlayerView extends Omit<HandPlayer, 'cards'> {
  /** Null when hidden from the viewer. */
  cards: Card[] | null;
}

/** What one player may see of a hand: no deck, no other hole cards until they are shown at showdown. */
export interface HandView extends Omit<HandState, 'deck' | 'players'> {
  players: PlayerView[];
  pot: number;
  /** Index of the viewer among the players, or null for a spectator / someone not dealt in. */
  you: number | null;
  /** The viewer's options when it is their turn. */
  legal: Legal | null;
}

export function viewFor(s: HandState, viewerId: string | null): HandView {
  const { deck: _deck, players, ...rest } = s;
  const you = players.findIndex((p) => p.id === viewerId);
  return {
    ...structuredClone(rest),
    players: players.map((p) => ({
      ...p,
      cards: p.id === viewerId ? [...p.cards] : s.result?.shown[p.id] ? [...s.result.shown[p.id]] : null,
    })),
    pot: potTotal(s),
    you: you < 0 ? null : you,
    legal: you < 0 ? null : legalActions(s, you),
  };
}

/**
 * How clients pace a hand on screen (ms): a gap between actions that arrive together, the pause before the
 * next street is dealt, the pause before each street of an all-in runout, and the wait before the winner is shown.
 * Dealing: the gap between hole cards going round (about one card's flight, so each lands before the next is
 * pitched) and that flight from the deck; one board card sliding in face down and turning up (flop cards one after
 * the other, and the turn), the river's slower reveal, and the gap between the cards of a board shown after the hand.
 */
export const PACE = {
  action: 450, street: 750, runout: 900, result: 900,
  card: 550, fly: 650,
  turnUp: 1000, river: 2000, peek: 450,
} as const;

/** How far into a board card's animation its face shows (the click), for a flop or turn card and for the river. */
export const FACE_AT = { card: 0.75, river: 0.7 } as const;

/** When hole card `round` (0 or 1) of the player `k` seats after the small blind lands. */
export function holeCardAt(players: number, k: number, round: number): number {
  return (round * players + k) * PACE.card + PACE.fly;
}

/** Dealing the hole cards round the table. */
export function dealMs(players: number): number {
  return holeCardAt(players, players - 1, 1);
}

/** Turning up the cards that bring the board to `board` cards: the flop card by card (3 s), the turn (1 s), the river (2 s). */
export function boardMs(board: number): number {
  if (board === 5) return PACE.river;
  if (board === 4) return PACE.turnUp;
  return 3 * PACE.turnUp;
}

/** An all-in runout dealing `boards` (e.g. [3, 4, 5]): a pause before each street once the one before is up, then the last turning up. */
function runoutMs(boards: number[]): number {
  return boards.reduce((sum, b, i) => sum + PACE.runout + (i ? boardMs(boards[i - 1]) : 0), 0) + (boards.length ? boardMs(boards.at(-1)!) : 0);
}

const BOARD_AT: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5, showdown: 5 };

/** Streets dealt after the last action: the board an all-in runs out, one street at a time. */
export function runoutStreets(s: Pick<HandState, 'actions' | 'board' | 'result'>): number {
  if (!s.result?.showdown) return 0;
  const last = s.actions.at(-1)?.street ?? 'preflop';
  return [3, 4, 5].filter((n) => n > BOARD_AT[last] && n <= s.board.length).length;
}

/** How long a client needs to play out the end of a finished hand. */
export function replayMs(s: Pick<HandState, 'actions' | 'board' | 'result'>): number {
  const runout = runoutStreets(s);
  return runoutMs([3, 4, 5].slice(3 - runout)) + PACE.result + PACE.street;
}

/** How long clients need on screen before the player to act can decide: the deal of a new hand, or a new street. */
export function leadMs(s: Pick<HandState, 'actions' | 'street' | 'players'>): number {
  const last = s.actions.at(-1);
  if (!last || last.type === 'bb' || last.type === 'sb') return dealMs(s.players.length);
  if (last.street !== s.street) return PACE.street + boardMs(BOARD_AT[s.street]);
  return 0;
}
