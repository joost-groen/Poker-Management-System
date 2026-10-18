import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { Account, LiveTableView } from '../../shared/online.ts';
import { PokerError } from '../../shared/poker/holdem.ts';

// Poker Bank's database path points at a file that must never appear: the online module may not open it.
const dir = mkdtempSync(join(tmpdir(), 'online-test-'));
process.env.DB_FILE = join(dir, 'poker.db');
process.env.ONLINE_DB_FILE = join(dir, 'online.db');
process.env.ONLINE_NEXT_HAND_MS = '5';
process.env.ONLINE_ACTION_MS = '60';
process.env.ONLINE_REPLAY_SCALE = '0';

const { odb } = await import('../src/online/db.ts');
const auth = await import('../src/online/auth.ts');
const tables = await import('../src/online/tables.ts');
const { onlineRanking, tableResult } = await import('../src/online/stats.ts');

after(() => rmSync(dir, { recursive: true, force: true }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | null | undefined | false, ms = 2000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('Timed out');
    await sleep(2);
  }
}

const account = (name: string): Account => auth.register({ username: name, password: 'secret12', avatar: '🦊' }).account;
const [anna, ben, cleo] = ['anna', 'ben', 'cleo'].map(account);
const runningHand = (code: string, who: Account) => {
  const v = tables.tableView(code, who.id);
  return v.hand && !v.hand.result ? v : null;
};
const toActId = (v: LiveTableView) => Number(v.hand!.players[v.hand!.toAct!].id);
const byId = (id: number) => [anna, ben, cleo].find((a) => a.id === id)!;

test('accounts: register, log in, duplicate names and wrong passwords', () => {
  assert.throws(() => account('Anna'), /taken/);
  assert.throws(() => auth.register({ username: 'x', password: 'secret12', avatar: '🦊' }), /Username/);
  assert.throws(() => auth.register({ username: 'dora', password: '123', avatar: '🦊' }), /Password/);
  assert.throws(() => auth.register({ username: 'dora', password: 'secret12', avatar: 'X' }), /avatar/);
  const s = auth.login({ username: 'ANNA', password: 'secret12' }, '1.1.1.1');
  assert.equal(s.account.id, anna.id);
  assert.ok(s.token.length > 30);
  assert.throws(() => auth.login({ username: 'anna', password: 'nope' }, '1.1.1.1'), /Wrong username/);
  const stored = odb.prepare('SELECT password FROM accounts WHERE id = ?').get(anna.id) as { password: string };
  assert.ok(stored.password.startsWith('scrypt$') && !stored.password.includes('secret12'));
});

test('a cash table from first hand to settlement', async () => {
  const t = tables.createTable(anna, { name: 'Friday', mode: 'cash', sb: 25, bb: 50, buyIn: 2000, maxSeats: 6 });
  assert.throws(() => tables.start(t.code, anna), /2 players/);
  tables.join(t.code, anna);
  tables.join(t.code, ben, 3);
  assert.throws(() => tables.join(t.code, ben), /already/);
  assert.throws(() => tables.start(t.code, ben), /host/);
  tables.start(t.code, anna);

  const v = await until(() => runningHand(t.code, anna));
  const actor = byId(toActId(v));
  const other = actor.id === anna.id ? ben : anna;
  assert.throws(() => tables.action(t.code, other, { type: 'fold' }), (e: unknown) => e instanceof PokerError && e.code === 'not_your_turn');
  assert.throws(() => tables.rebuy(t.code, actor), /finish/);

  // The host ends the table during the hand: it closes as soon as the hand is over.
  const closing = tables.close(t.code, anna);
  assert.equal(closing.closing, true);
  tables.action(t.code, actor, { type: 'fold' });

  const result = tableResult(t.code)!;
  assert.ok(result, 'table is closed');
  assert.equal(result.hands, 1);
  assert.equal(result.lines.reduce((s, l) => s + l.result, 0), 0, 'money is conserved');
  const loser = result.lines.find((l) => l.accountId === actor.id)!;
  assert.equal(loser.result, -25, 'folding the small blind loses it');
  assert.deepEqual(result.transfers.map((x) => [x.from, x.to, x.amount]), [[actor.id, other.id, 25]]);
  assert.throws(() => tables.join(t.code, cleo), /closed/);

  const rows = onlineRanking();
  assert.equal(rows.find((r) => r.accountId === other.id)!.net, 25);
  assert.equal(rows.find((r) => r.accountId === actor.id)!.hands, 1);
});

test('fun tables are listed but never counted', async () => {
  const before = JSON.stringify(onlineRanking());
  const t = tables.createTable(ben, { name: 'Just for fun', mode: 'fun', sb: 10, bb: 20, buyIn: 1000, maxSeats: 2 });
  tables.join(t.code, ben);
  tables.join(t.code, cleo);
  assert.throws(() => tables.join(t.code, anna), /full/);
  tables.start(t.code, ben);
  const v = await until(() => runningHand(t.code, ben));
  tables.close(t.code, ben);
  tables.action(t.code, byId(toActId(v)), { type: 'fold' });
  const result = tableResult(t.code)!;
  assert.equal(result.transfers.length, 0);
  assert.equal(JSON.stringify(onlineRanking()), before);
  assert.ok(tables.listTables(cleo.id).some((x) => x.code === t.code && x.mine));
});

test('a restart in the middle of a hand voids it and keeps the stacks from before', async () => {
  const t = tables.createTable(anna, { name: 'Restart', mode: 'cash', sb: 25, bb: 50, buyIn: 2000, maxSeats: 4 });
  tables.join(t.code, anna);
  tables.join(t.code, ben);
  tables.start(t.code, anna);
  const v = await until(() => runningHand(t.code, anna));
  tables.action(t.code, byId(toActId(v)), { type: 'raise', to: 500 });
  assert.notDeepEqual(tables.tableView(t.code, anna.id).seats.filter(Boolean).map((s) => s!.stack), [2000, 2000]);

  tables.dropMemory();
  const after = tables.tableView(t.code, anna.id);
  assert.equal(after.hand, null, 'the running hand is gone');
  assert.deepEqual(after.seats.filter(Boolean).map((s) => s!.stack), [2000, 2000]);
  tables.dropMemory();
});

test('the action clock checks or folds for absent players and sits them out', async () => {
  const t = tables.createTable(cleo, { name: 'Clock', mode: 'fun', sb: 10, bb: 20, buyIn: 1000, maxSeats: 2 });
  tables.join(t.code, cleo);
  tables.join(t.code, anna);
  tables.start(t.code, cleo);
  const v = await until(() => runningHand(t.code, cleo));
  const first = toActId(v);
  // Nobody acts: after two timeouts in a row a player is sat out.
  const out = await until(() => tables.tableView(t.code, cleo.id).seats.find((s) => s?.sittingOut), 3000);
  assert.ok(out);
  assert.ok([cleo.id, anna.id].includes(first));
  tables.dropMemory();
});

test('leaving during a hand folds it, even when checking would be free', async () => {
  const t = tables.createTable(anna, { name: 'Leave', mode: 'fun', sb: 10, bb: 20, buyIn: 1000, maxSeats: 2 });
  tables.join(t.code, anna);
  tables.join(t.code, ben);
  tables.start(t.code, anna);
  const v = await until(() => runningHand(t.code, anna));
  // Heads-up the small blind acts first; the big blind leaves before it is their turn.
  const sb = byId(toActId(v));
  const bb = sb.id === anna.id ? ben : anna;
  tables.leave(t.code, bb);
  const after = tables.action(t.code, sb, { type: 'call' });
  const hand = after.hand!;
  assert.ok(hand.result, 'the hand ends at once');
  assert.ok(hand.players.find((p) => p.id === String(bb.id))!.folded, 'the leaving player folded instead of checking');
  assert.equal(hand.result!.net[String(sb.id)], 20);
  assert.equal(after.seats.some((s) => s?.account.id === bb.id), false, 'and is cashed out');
  tables.dropMemory();
});

test('isolation: Poker Bank’s database is never opened or created', () => {
  assert.equal(existsSync(process.env.DB_FILE!), false);
  const names = (odb.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name);
  for (const bank of ['players', 'games', 'game_players', 'events']) assert.ok(!names.includes(bank), `${bank} is not in online.db`);
  assert.ok(names.includes('accounts') && names.includes('ledger'));
});
