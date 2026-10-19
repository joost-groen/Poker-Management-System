import { useEffect, useRef, useState } from 'react';
import type { LoggedAction, Street } from '../../../shared/poker/holdem.ts';
import { PACE, type HandView } from '../../../shared/poker/view.ts';

// The engine jumps from one decision to the next: a call that closes the betting comes back with the next
// street already dealt, and an all-in comes back with the whole board and the winner. On screen the hand is
// replayed step by step: the action, the bets going in, each street, then the winner.

export interface Frame {
  view: HandView;
  /** Wait before this frame is shown (ms). */
  delay: number;
}

const BOARD_AT: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5, showdown: 5 };
const STREET_OF_BOARD: Record<number, Street> = { 3: 'flop', 4: 'turn', 5: 'river' };

const sameAction = (a: LoggedAction, b: LoggedAction) =>
  a.street === b.street && a.playerId === b.playerId && a.type === b.type && a.amount === b.amount;

/** The table between two decisions: nobody to act, no buttons. */
function idle(v: HandView): HandView {
  return { ...v, toAct: null, legal: null, result: null };
}

function applyAction(v: HandView, a: LoggedAction): HandView {
  let delta = 0;
  const players = v.players.map((p) => {
    if (p.id !== a.playerId) return p;
    delta = a.amount - p.bet;
    return { ...p, bet: a.amount, stack: p.stack - delta, committed: p.committed + delta, folded: p.folded || a.type === 'fold', allIn: a.allIn };
  });
  return { ...v, players, pot: v.pot + delta, currentBet: Math.max(v.currentBet, a.amount), actions: [...v.actions, a] };
}

/** Bets go into the pot and the board grows to `street`. `reveal`: hole cards turned up for an all-in. */
function dealStreet(v: HandView, street: Street, board: number[], reveal: HandView | null): HandView {
  return {
    ...v,
    street,
    board: board.slice(0, BOARD_AT[street]),
    currentBet: 0,
    players: v.players.map((p, i) => ({ ...p, bet: 0, cards: reveal?.players[i].cards ?? p.cards })),
  };
}

/** The frames that lead from what is on screen to the latest state. */
export function stage(from: HandView | null, to: HandView): Frame[] {
  if (!from || from.handNo !== to.handNo || from.actions.length > to.actions.length || !from.actions.every((a, i) => sameAction(a, to.actions[i]))) {
    return [{ view: to, delay: 0 }];
  }
  const frames: Frame[] = [];
  let cur = idle(from);
  for (const a of to.actions.slice(from.actions.length)) {
    if (a.street !== cur.street) {
      cur = dealStreet(cur, a.street, to.board, null);
      frames.push({ view: cur, delay: PACE.street });
    }
    cur = applyAction(cur, a);
    frames.push({ view: cur, delay: frames.length ? PACE.action : 0 });
  }

  if (to.result) {
    // All-in: the live hands are turned up, then the board runs out one street at a time.
    const showdown = to.result.showdown;
    if (cur.board.length < to.board.length) {
      cur = dealStreet(cur, cur.street, to.board, showdown ? to : null);
      frames.push({ view: cur, delay: PACE.street });
      while (cur.board.length < to.board.length) {
        const street = STREET_OF_BOARD[cur.board.length === 0 ? 3 : cur.board.length + 1];
        cur = dealStreet(cur, street, to.board, showdown ? to : null);
        frames.push({ view: cur, delay: PACE.runout });
      }
    }
    frames.push({ view: to, delay: frames.length ? PACE.result : 0 });
    return frames;
  }

  // The betting round closed: the next street is dealt after a moment.
  frames.push({ view: to, delay: to.street !== cur.street ? PACE.street : 0 });
  return frames;
}

/**
 * Shows `target` through the frames that lead to it. `settled` is true once the screen has caught up, which
 * is when bots may act and the next hand may be dealt. `onFrame` sees every step (sounds).
 */
export function useStagedHand(target: HandView | null, onFrame?: (prev: HandView | null, next: HandView | null) => void) {
  const [shown, setShown] = useState<HandView | null>(target);
  const shownRef = useRef<HandView | null>(target);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    const show = (v: HandView | null) => {
      onFrameRef.current?.(shownRef.current, v);
      shownRef.current = v;
      setShown(v);
    };
    if (!target) {
      show(null);
      return;
    }
    const frames = stage(shownRef.current, target);
    let i = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = () => {
      while (i < frames.length && frames[i].delay === 0) show(frames[i++].view);
      if (i < frames.length) {
        timer = setTimeout(() => {
          show(frames[i++].view);
          next();
        }, frames[i].delay);
      }
    };
    next();
    return () => clearTimeout(timer);
  }, [target]);

  return { shown, settled: shown === target };
}
