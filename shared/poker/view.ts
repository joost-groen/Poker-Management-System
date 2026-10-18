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
 * next street is dealt, each street of an all-in runout, and the wait before the winner is shown.
 */
export const PACE = { action: 450, street: 750, runout: 1300, result: 900 } as const;

const BOARD_AT: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5, showdown: 5 };

/** Streets dealt after the last action: the board an all-in runs out, one street at a time. */
export function runoutStreets(s: Pick<HandState, 'actions' | 'board' | 'result'>): number {
  if (!s.result?.showdown) return 0;
  const last = s.actions.at(-1)?.street ?? 'preflop';
  return [3, 4, 5].filter((n) => n > BOARD_AT[last] && n <= s.board.length).length;
}

/** How long a client needs to play out the end of a finished hand. */
export function replayMs(s: Pick<HandState, 'actions' | 'board' | 'result'>): number {
  return runoutStreets(s) * PACE.runout + PACE.result + PACE.street;
}
