import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newDeck, parseCards, type Card } from '../../shared/poker/cards.ts';
import { equity } from '../../shared/poker/equity.ts';
import { describe, evaluate } from '../../shared/poker/evaluate.ts';
import { act, legalActions, PokerError, potTotal, startHand, type HandState } from '../../shared/poker/holdem.ts';
import { viewFor } from '../../shared/poker/view.ts';

const rank = (s: string) => evaluate(parseCards(s));
const rng = (n: number) => Math.floor(Math.random() * n);

function hand(stacks: number[], sb = 5, bb = 10): HandState {
  return startHand({
    players: stacks.map((stack, i) => ({ id: 'ABCDEFGHI'[i], name: 'ABCDEFGHI'[i], seat: i, stack })),
    previousButton: null, sb, bb, rng, handNo: 1,
  });
}

/** Fixes hole cards and the board to come (flop, turn, river), keeping the deck consistent. */
function rig(s: HandState, holes: string[], board: string) {
  const used = new Set<Card>();
  s.players.forEach((p, i) => {
    p.cards = parseCards(holes[i]);
    p.cards.forEach((c) => used.add(c));
  });
  const [f1, f2, f3, turn, river] = parseCards(board);
  [f1, f2, f3, turn, river].forEach((c) => used.add(c));
  const rest = newDeck().filter((c) => !used.has(c));
  const burn = () => rest.pop()!;
  // Cards are popped from the end: burn, flop, burn, turn, burn, river.
  const tail = [river, burn(), turn, burn(), f3, f2, f1, burn()];
  s.deck = [...rest, ...tail];
}

test('hand ranking: categories, kickers, wheel and ties', () => {
  const order = [
    'Ah Kd 9c 7s 3h 2d 4c', // high card
    '9h 9d Ac 7s 3h 2d 4c', // pair
    '9h 9d 7c 7s 3h 2d Kc', // two pair
    '9h 9d 9c 7s 3h 2d Kc', // trips
    'Ah 2d 3c 4s 5h 9d Kc', // wheel
    '6h 2d 3c 4s 5h 9d Kc', // six-high straight
    'Ah Kh 2h 7h 9h 9d 9c', // flush
    'Kh Kd Kc 2s 2h 9d 9c', // full house
    'Kh Kd Kc Ks 2h 9d 9c', // quads
    'As Ks Qs Js Ts 2d 3c', // royal flush
  ].map(rank);
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], `hand ${i} beats hand ${i - 1}`);

  assert.ok(rank('Ah Ad Kc 7s 3h 2d 4c') > rank('Ah Ad Qc 7s 3h 2d 4c'), 'kicker decides');
  assert.equal(rank('Ah Kd 9c 7s 3h 2d 4c'), rank('As Kc 9d 7h 3c 2s 4d'), 'same ranks tie');
  assert.equal(rank('2h 3h As Ks Qs Js Ts'), rank('4d 5d As Ks Qs Js Ts'), 'board plays');
  assert.deepEqual(describe(rank('Ah 2d 3c 4s 5h 9d Kc')), { category: 'straight', ranks: [3] });
  assert.deepEqual(describe(rank('7h 7d 2c 2s Kh Kd 3c')), { category: 'twoPair', ranks: [11, 5, 1] });
});

test('side pots with three all-ins of different sizes', () => {
  // A on the button acts first, B small blind, C big blind.
  let s = hand([100, 300, 600]);
  rig(s, ['Ah Ad', 'Kh Kd', 'Qh Qd'], '2c 7s 9d 3h 4s');
  s = act(s, 'A', { type: 'raise', to: 100 });
  s = act(s, 'B', { type: 'raise', to: 300 });
  s = act(s, 'C', { type: 'call' });
  const r = s.result!;
  assert.ok(r.showdown);
  assert.equal(s.board.length, 5);
  assert.deepEqual(r.pots.map((p) => [p.amount, p.eligible.join(''), p.winners.join('')]), [[300, 'ABC', 'A'], [400, 'BC', 'B']]);
  assert.deepEqual(r.net, { A: 200, B: 100, C: -300 });
  assert.deepEqual(s.players.map((p) => p.stack), [300, 400, 300]);
  assert.equal(s.players.reduce((sum, p) => sum + p.stack, 0), 1000, 'no chips created or lost');
});

test('split pot when the board plays', () => {
  let s = hand([500, 500]);
  rig(s, ['2h 3d', '4c 5d'], 'As Ks Qs Js Ts');
  s = act(s, 'A', { type: 'call' });
  while (!s.result) s = act(s, s.toAct!, { type: 'check' });
  assert.deepEqual(s.result.pots[0].winners.sort(), ['A', 'B']);
  assert.deepEqual(s.result!.net, { A: 0, B: 0 });
});

test('minimum raise and a short all-in that does not reopen the betting', () => {
  let s = hand([1000, 1000, 40], 5, 10);
  assert.throws(() => act(s, 'A', { type: 'raise', to: 15 }), (e: unknown) => e instanceof PokerError && e.code === 'illegal_action');
  s = act(s, 'A', { type: 'raise', to: 30 });
  assert.equal(legalActions(s, 1)!.raise!.min, 50, 'the next raise is at least as big as the last one');
  s = act(s, 'B', { type: 'call' });
  assert.deepEqual(legalActions(s, 2)!.raise, { min: 40, max: 40 }, 'all-in below a full raise is still allowed');
  s = act(s, 'C', { type: 'raise', to: 40 });
  const a = legalActions(s, 0)!;
  assert.equal(a.call, 10);
  assert.equal(a.raise, null, 'players who already acted may only call or fold');
  assert.throws(() => act(s, 'B', { type: 'call' }), (e: unknown) => e instanceof PokerError && e.code === 'not_your_turn');
});

test('heads-up: the button posts the small blind, acts first before the flop and last after it', () => {
  let s = hand([500, 500]);
  assert.equal(s.button, 0);
  assert.equal(s.sbIndex, 0);
  assert.equal(s.bbIndex, 1);
  assert.equal(s.toAct, 0);
  s = act(s, 'A', { type: 'call' });
  assert.equal(s.toAct, 1, 'big blind has the option');
  assert.equal(legalActions(s, 1)!.check, true);
  s = act(s, 'B', { type: 'check' });
  assert.equal(s.street, 'flop');
  assert.equal(s.toAct, 1, 'big blind acts first after the flop');
});

test('the button moves to the next seat with chips', () => {
  const players = [0, 2, 5].map((seat) => ({ id: String(seat), name: String(seat), seat, stack: 100 }));
  const first = startHand({ players, previousButton: null, sb: 1, bb: 2, rng, handNo: 1 });
  const second = startHand({ players, previousButton: first.players[first.button].seat, sb: 1, bb: 2, rng, handNo: 2 });
  const third = startHand({ players, previousButton: 5, sb: 1, bb: 2, rng, handNo: 3 });
  assert.deepEqual([first, second, third].map((h) => h.players[h.button].seat), [0, 2, 0]);
});

test('a player view never contains other hole cards or the deck before showdown', () => {
  let s = hand([500, 500, 500]);
  const check = () => {
    for (const p of s.players) {
      const v = viewFor(s, p.id);
      assert.equal('deck' in v, false);
      for (const q of v.players) {
        if (q.id === p.id) assert.deepEqual(q.cards, p.cards);
        else if (!s.result?.shown[q.id]) assert.equal(q.cards, null);
      }
      assert.ok(!JSON.stringify(v).includes('"deck"'));
    }
    const spectator = viewFor(s, null);
    if (!s.result) assert.ok(spectator.players.every((q) => q.cards === null));
  };
  check();
  s = act(s, 'A', { type: 'call' });
  check();
  s = act(s, 'B', { type: 'call' });
  s = act(s, 'C', { type: 'check' });
  check();
  while (!s.result) s = act(s, s.toAct!, { type: 'check' });
  check();
  assert.ok(Object.keys(s.result!.shown).length === 3, 'everyone still in shows at showdown');
});

test('equity: aces against one random hand win about 85%', () => {
  const e = equity(parseCards('Ah Ad'), [], 1, 4000);
  assert.ok(e.equity > 0.81 && e.equity < 0.89, `got ${e.equity}`);
});

test('evaluator: the best of seven equals the best five-card subset', () => {
  for (let k = 0; k < 3000; k++) {
    const deck = newDeck();
    const seven = Array.from({ length: 7 }, () => deck.splice(rng(deck.length), 1)[0]);
    let best = -1;
    for (let a = 0; a < 7; a++) {
      for (let b = a + 1; b < 7; b++) best = Math.max(best, evaluate(seven.filter((_, i) => i !== a && i !== b)));
    }
    assert.equal(evaluate(seven), best, seven.join(' '));
  }
});

test('random legal play: chips are conserved and every hand ends', () => {
  for (let h = 0; h < 2000; h++) {
    const n = 2 + rng(8);
    const stacks = Array.from({ length: n }, () => 1 + rng(400));
    let s = hand(stacks, 2, 4);
    const total = stacks.reduce((a, b) => a + b, 0);
    for (let steps = 0; !s.result; steps++) {
      assert.ok(steps < 500, 'hand does not end');
      const legal = legalActions(s, s.toAct!)!;
      const roll = rng(10);
      const a = legal.raise && roll < 3
        ? { type: 'raise' as const, to: legal.raise.min + rng(legal.raise.max - legal.raise.min + 1) }
        : roll < 5 && !legal.check ? { type: 'fold' as const } : { type: 'call' as const };
      s = act(s, s.toAct!, a);
      assert.equal(s.players.reduce((sum, p) => sum + p.stack + p.committed, 0) - (s.result ? potTotal(s) : 0), total);
    }
    const r = s.result!;
    assert.equal(s.players.reduce((sum, p) => sum + p.stack, 0), total, 'stacks after the hand');
    assert.equal(Object.values(r.net).reduce((a, b) => a + b, 0), 0, 'nets add up to zero');
    assert.equal(r.pots.reduce((sum, p) => sum + p.amount, 0), potTotal(s), 'pots hold every chip put in');
    for (const pot of r.pots) assert.ok(pot.winners.every((id) => pot.eligible.includes(id)));
  }
});
