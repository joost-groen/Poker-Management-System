import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, startHand } from '../../shared/poker/holdem.ts';
import { boardMs, dealMs, leadMs, PACE, replayMs, runoutStreets, viewFor } from '../../shared/poker/view.ts';
import { stage } from '../../web/src/online/stage.ts';

const rng = (n: number) => Math.floor(Math.random() * n);
const start = () => startHand({
  players: ['A', 'B', 'C'].map((id, seat) => ({ id, name: id, seat, stack: 1000 })),
  previousButton: null, sb: 5, bb: 10, rng, handNo: 1,
});

test('replay: a call that closes the betting shows the call, then deals the flop and turns it up', () => {
  let s = start();
  s = act(s, 'A', { type: 'call' });
  s = act(s, 'B', { type: 'call' });
  const before = viewFor(s, 'A');
  s = act(s, 'C', { type: 'check' });
  const after = viewFor(s, 'A');
  const frames = stage(before, after);
  assert.deepEqual(frames.map((f) => [f.view.street, f.view.board.length, f.delay]), [['preflop', 0, 0], ['flop', 3, PACE.street], ['flop', 3, boardMs(3)]]);
  assert.equal(frames[0].view.legal, null, 'no buttons while the table catches up');
  assert.equal(frames[1].view.toAct, null, 'nobody acts while the flop turns up');
  assert.equal(frames[0].view.actions.at(-1)?.type, 'check');
  assert.equal(frames.at(-1)!.view, after);
  // The server gives the first player on the flop the same time before their clock (or a bot) starts.
  assert.equal(leadMs(s), PACE.street + boardMs(3));
});

test('replay: actions on a new street wait until its cards are turned up', () => {
  let s = start();
  s = act(s, 'A', { type: 'call' });
  s = act(s, 'B', { type: 'call' });
  const before = viewFor(s, 'A');
  s = act(s, 'C', { type: 'check' });
  s = act(s, s.toAct!, { type: 'check' });
  const frames = stage(before, viewFor(s, 'A'));
  assert.deepEqual(frames.map((f) => f.delay), [0, PACE.street, boardMs(3), 0]);
});

test('replay: an all-in runs the board out street by street with the hands turned up', () => {
  let s = start();
  s = act(s, 'A', { type: 'raise', to: 1000 });
  s = act(s, 'B', { type: 'call' });
  const before = viewFor(s, 'A');
  s = act(s, 'C', { type: 'call' });
  const after = viewFor(s, 'A');
  const frames = stage(before, after);
  assert.deepEqual(frames.map((f) => f.view.board.length), [0, 0, 3, 4, 5, 5]);
  assert.ok(frames.slice(1, -1).every((f) => f.view.players.every((p) => p.cards !== null)), 'hands are face up during the runout');
  assert.ok(frames.slice(0, -1).every((f) => f.view.result === null), 'the winner comes last');
  assert.equal(frames.at(-1)!.view, after);
  assert.equal(runoutStreets(s), 3);
  assert.equal(replayMs(s), 3 * PACE.runout + boardMs(3) + boardMs(4) + boardMs(5) + PACE.result + PACE.street);
  assert.deepEqual([boardMs(3), boardMs(4), boardMs(5)], [3000, 1000, 2000]);
  assert.equal(frames.reduce((sum, f) => sum + f.delay, 0), replayMs(s), 'the server waits exactly as long as the screen');
  // Chips never appear or vanish between frames.
  for (const f of frames.slice(0, -1)) assert.equal(f.view.players.reduce((sum, p) => sum + p.stack + p.committed, 0), 3000);
});

test('replay: a new hand is dealt round the table before anyone acts; one under way is shown at once', () => {
  const a = viewFor(start(), 'A');
  const hand = { ...start(), handNo: 2 };
  const b = viewFor(hand, 'A');
  const frames = stage(a, b);
  assert.deepEqual(frames.map((f) => f.delay), [0, dealMs(3)]);
  assert.equal(frames[0].view.toAct, null);
  assert.equal(frames[1].view, b);
  assert.equal(leadMs(hand), dealMs(3));
  const later = viewFor(act(start(), 'A', { type: 'call' }), 'A');
  assert.deepEqual(stage(null, later), [{ view: later, delay: 0 }]);
});
