import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, startHand, type HandState } from '../../shared/poker/holdem.ts';
import { handFlags, recordOf, redact, replayViews } from '../../shared/poker/history.ts';
import { rangeEquity, readRange, strength } from '../../shared/poker/ranges.ts';
import { equity } from '../../shared/poker/equity.ts';
import { parseCards } from '../../shared/poker/cards.ts';
import { viewFor } from '../../shared/poker/view.ts';
import { stage } from '../../web/src/online/stage.ts';

const rng = (n: number) => Math.floor(Math.random() * n);

/** Four players, button A: B posts the small blind, C the big blind, D is first to act. */
function hand(): HandState {
  return startHand({ players: ['A', 'B', 'C', 'D'].map((id, seat) => ({ id, name: id, seat, stack: 1000 })), previousButton: 3, sb: 5, bb: 10, rng, handNo: 7 });
}

function played(): HandState {
  let s = hand();
  s = act(s, 'D', { type: 'raise', to: 30 }); // open
  s = act(s, 'A', { type: 'raise', to: 90 }); // 3-bet
  s = act(s, 'B', { type: 'fold' });
  s = act(s, 'C', { type: 'fold' });
  s = act(s, 'D', { type: 'call' });
  while (!s.result) s = act(s, s.toAct!, { type: 'check' });
  return s;
}

test('record: replaying it ends exactly where the hand ended, with every chip accounted for', () => {
  const s = played();
  const r = recordOf(s);
  assert.equal(r.players.find((p) => p.id === 'D')!.stack, 1000);
  const { start, end } = replayViews(r, 'D');
  const frames = stage(start, end);
  assert.equal(frames.at(-1)!.view, end);
  const total = 4000;
  for (const f of frames.slice(0, -1)) assert.equal(f.view.players.reduce((sum, p) => sum + p.stack + p.committed, 0), total);
  assert.deepEqual(end.players.map((p) => p.stack), s.players.map((p) => p.stack));
  assert.equal(end.pot, 180 + 5 + 10);
});

test('record: other players’ hole cards stay hidden unless shown at showdown', () => {
  const s = played();
  const r = redact(recordOf(s), 'B');
  assert.equal(r.players.find((p) => p.id === 'B')!.hole.length, 2, 'own cards');
  assert.equal(r.players.find((p) => p.id === 'C')!.hole.length, 0, 'folded, never shown');
  assert.equal(r.players.find((p) => p.id === 'A')!.hole.length, 2, 'shown at showdown');
  const spectator = redact(recordOf(s), null);
  assert.equal(spectator.players.find((p) => p.id === 'B')!.hole.length, 0);
});

test('flags: VPIP, PFR, 3-bet chances, flops and showdowns', () => {
  const f = handFlags(recordOf(played()));
  assert.deepEqual(f.D, { vpip: true, pfr: true, threeBetChance: false, threeBet: false, sawFlop: true, wtsd: true, wsd: f.D.wsd });
  assert.equal(f.A.threeBetChance && f.A.threeBet && f.A.pfr, true);
  assert.equal(f.B.threeBetChance, false, 'the small blind first acted facing two raises');
  assert.equal(f.B.vpip || f.C.vpip, false, 'posting a blind is not voluntary');
  assert.equal(f.C.sawFlop, false);
  assert.ok(f.A.wsd || f.D.wsd, 'someone won the showdown');
});

test('ranges: an early raise is a narrow range, and equity against it is lower than against random cards', () => {
  let s = startHand({ players: ['A', 'B', 'C', 'D', 'E', 'F'].map((id, seat) => ({ id, name: id, seat, stack: 1000 })), previousButton: 5, sb: 5, bb: 10, rng, handNo: 1 });
  // Button A, blinds B and C: D is under the gun at a six-handed table.
  s = act(s, 'D', { type: 'raise', to: 30 });
  const range = readRange(viewFor(s, 'E'), 3);
  assert.ok(range.group <= 4, `group ${range.group}`);
  const hole = parseCards('Kh Jd');
  const vsRange = rangeEquity(hole, [], [range], 3000).equity;
  const vsAny = equity(hole, [], 1, 3000).equity;
  assert.ok(vsRange < vsAny - 0.1, `${vsRange} vs ${vsAny}`);
});

test('ranges: hand strength steps', () => {
  const board = parseCards('Kd 8s 3c');
  assert.equal(strength(parseCards('Ah Kh'), board), 3, 'top pair');
  assert.equal(strength(parseCards('8h 7h'), board), 2, 'middle pair');
  assert.equal(strength(parseCards('Kh 8h'), board), 4, 'two pair');
  assert.equal(strength(parseCards('Qd Jd'), parseCards('Kd 8d 3c')), 1, 'flush draw');
  assert.equal(strength(parseCards('2h 4h'), board), 0, 'nothing');
});
