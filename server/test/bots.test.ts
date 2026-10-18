import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCards } from '../../shared/poker/cards.ts';
import { BOT_LEVELS, decide, type BotLevel } from '../../shared/poker/bots.ts';
import { advise, review } from '../../shared/poker/coach.ts';
import { act, startHand, type HandState } from '../../shared/poker/holdem.ts';
import { viewFor } from '../../shared/poker/view.ts';

const rng = (n: number) => Math.floor(Math.random() * n);

/** Plays `hands` hands with fresh 100 BB stacks; `act` throws on any illegal move. Returns each seat's net in BB. */
function play(levels: BotLevel[], hands: number): number[] {
  const net = levels.map(() => 0);
  let button: number | null = null;
  for (let h = 0; h < hands; h++) {
    let s = startHand({
      players: levels.map((_, i) => ({ id: String(i), name: String(i), seat: i, stack: 2000 })),
      previousButton: button, sb: 10, bb: 20, rng, handNo: h,
    });
    button = s.players[s.button].seat;
    while (!s.result) {
      const p = s.players[s.toAct!];
      s = act(s, s.toAct!, decide(viewFor(s, p.id), levels[Number(p.id)]).action);
    }
    levels.forEach((_, i) => (net[i] += s.result!.net[String(i)] / 20));
  }
  return net;
}

test('every bot level only makes legal moves, at full and short tables', () => {
  for (const level of BOT_LEVELS) {
    play([level, level], 150);
    play([level, 'beginner', 'regular', 'shark', level, level], 80);
  }
});

test('the Shark beats the Beginner heads-up', () => {
  const [shark, beginner] = play(['shark', 'beginner'], 1500);
  assert.ok(shark > 0, `shark ${shark} BB`);
  assert.equal(Math.round(shark + beginner), 0);
});

function spot(holes: string[], stacks = holes.map(() => 2000)): HandState {
  const s = startHand({ players: stacks.map((stack, i) => ({ id: String(i), name: String(i), seat: i, stack })), previousButton: null, sb: 10, bb: 20, rng, handNo: 1 });
  s.players.forEach((p, i) => (p.cards = parseCards(holes[i])));
  return s;
}

test('coach: folds trash, raises aces, and calls a free fold a mistake', () => {
  // Six players: index 3 (after the big blind) is first to act, early position.
  const trash = spot(['Ah Kh', 'Qd Qc', 'Js Ts', '7c 2d', '9h 9s', '5c 4c']);
  const fold = advise(viewFor(trash, '3'));
  assert.equal(fold.position, 'early');
  assert.equal(fold.suggestion.type, 'fold');
  assert.equal(review(fold, { type: 'call' }, false).code, 'looseEntry');

  const aces = spot(['Kd Qd', 'Js Ts', '9h 9s', 'Ah As', '5c 4c', '8d 8c']);
  const raise = advise(viewFor(aces, '3'));
  assert.equal(raise.suggestion.type, 'raise');
  assert.equal(review(raise, { type: 'fold' }, false).code, 'tightFold');

  // Big blind with the option: folding is never right when checking is free.
  let limped = spot(['Kd Qd', 'Js Ts', '7c 2d']);
  limped = act(limped, 0, { type: 'call' });
  limped = act(limped, 1, { type: 'call' });
  const bb = advise(viewFor(limped, '2'));
  assert.equal(bb.suggestion.type, 'check');
  assert.equal(review(bb, { type: 'fold' }, true).code, 'freeFold');
});
