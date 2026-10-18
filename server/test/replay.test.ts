import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, startHand } from '../../shared/poker/holdem.ts';
import { PACE, replayMs, runoutStreets, viewFor } from '../../shared/poker/view.ts';
import { stage } from '../../web/src/online/stage.ts';

const rng = (n: number) => Math.floor(Math.random() * n);
const start = () => startHand({
  players: ['A', 'B', 'C'].map((id, seat) => ({ id, name: id, seat, stack: 1000 })),
  previousButton: null, sb: 5, bb: 10, rng, handNo: 1,
});

test('replay: a call that closes the betting shows the call, then deals the flop', () => {
  let s = start();
  s = act(s, 'A', { type: 'call' });
  s = act(s, 'B', { type: 'call' });
  const before = viewFor(s, 'A');
  s = act(s, 'C', { type: 'check' });
  const frames = stage(before, viewFor(s, 'A'));
  assert.deepEqual(frames.map((f) => [f.view.street, f.view.board.length, f.delay]), [['preflop', 0, 0], ['flop', 3, PACE.street]]);
  assert.equal(frames[0].view.legal, null, 'no buttons while the table catches up');
  assert.equal(frames[0].view.actions.at(-1)?.type, 'check');
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
  assert.equal(replayMs(s), 3 * PACE.runout + PACE.result + PACE.street);
  // Chips never appear or vanish between frames.
  for (const f of frames.slice(0, -1)) assert.equal(f.view.players.reduce((sum, p) => sum + p.stack + p.committed, 0), 3000);
});

test('replay: a new hand or an out-of-sync view is shown at once', () => {
  const a = viewFor(start(), 'A');
  const b = viewFor({ ...start(), handNo: 2 }, 'A');
  assert.deepEqual(stage(a, b), [{ view: b, delay: 0 }]);
  assert.deepEqual(stage(null, a), [{ view: a, delay: 0 }]);
});
