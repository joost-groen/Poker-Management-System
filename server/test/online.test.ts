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
process.env.ONLINE_INVITE_CODE = 'friends-only';
process.env.ONLINE_ADMIN_CODE = 'boss-code';
process.env.APP_PIN = 'group-pin';
process.env.ONLINE_BOT_SCALE = '0';

const { odb } = await import('../src/online/db.ts');
const auth = await import('../src/online/auth.ts');
const tables = await import('../src/online/tables.ts');
const { onlineRanking, tableResult } = await import('../src/online/stats.ts');
const history = await import('../src/online/history.ts');
const admin = await import('../src/online/admin.ts');

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

const account = (name: string): Account => auth.register({ username: name, password: 'secret12', avatar: '🦊', code: 'friends-only' }).account;
const [anna, ben, cleo] = ['anna', 'ben', 'cleo'].map(account);
const runningHand = (code: string, who: Account) => {
  const v = tables.tableView(code, who.id);
  return v.hand && !v.hand.result ? v : null;
};
const toActId = (v: LiveTableView) => Number(v.hand!.players[v.hand!.toAct!].id);
const byId = (id: number) => [anna, ben, cleo].find((a) => a.id === id)!;

test('accounts: register, log in, duplicate names and wrong passwords', () => {
  assert.throws(() => account('Anna'), /taken/);
  assert.throws(() => auth.register({ username: 'x', password: 'secret12', avatar: '🦊', code: 'friends-only' }), /Username/);
  assert.throws(() => auth.register({ username: 'dora', password: '123', avatar: '🦊', code: 'friends-only' }), /Password/);
  assert.throws(() => auth.register({ username: 'dora', password: 'secret12', avatar: 'X', code: 'friends-only' }), /avatar/);
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

test('hand history: each player sees their own cards, never the others’ unshown ones', async () => {
  const t = tables.createTable(anna, { name: 'History', mode: 'fun', sb: 10, bb: 20, buyIn: 1000, maxSeats: 2 });
  tables.join(t.code, anna);
  tables.join(t.code, ben);
  tables.start(t.code, anna);
  const v = await until(() => runningHand(t.code, anna));
  tables.action(t.code, byId(toActId(v)), { type: 'fold' });
  const forAnna = history.tableHands(t.code, anna.id);
  assert.equal(forAnna.length, 1);
  const r = forAnna[0].record;
  assert.equal(r.players.find((p) => p.id === String(anna.id))!.hole.length, 2);
  assert.equal(r.players.find((p) => p.id === String(ben.id))!.hole.length, 0);
  assert.equal(forAnna[0].avatars[String(ben.id)], '🦊');
  assert.equal(history.accountHands(ben.id)[0].record.players.find((p) => p.id === String(ben.id))!.hole.length, 2);
  assert.equal(history.accountHands(account('newcomer').id).length, 0);
  tables.dropMemory();
});

test('chat: text, reactions and voice reach every listener; spam and junk are refused', () => {
  const t = tables.createTable(anna, { name: 'Chat', mode: 'fun', sb: 10, bb: 20, buyIn: 1000, maxSeats: 4 });
  tables.join(t.code, anna);
  const got: string[] = [];
  const stop = tables.subscribe(t.code, ben.id, () => {}, (m) => got.push(`${m.kind}:${m.text ?? m.ms}`));
  tables.postChat(t.code, anna, { kind: 'text', text: '  hello   there ' });
  tables.postChat(t.code, anna, { kind: 'reaction', text: '🔥' });
  tables.postChat(t.code, anna, { kind: 'voice', audio: 'data:audio/webm;codecs=opus;base64,AAAA', ms: 1200 });
  assert.deepEqual(got, ['text:hello there', 'reaction:🔥', 'voice:1200']);
  assert.throws(() => tables.postChat(t.code, anna, { kind: 'reaction', text: '<b>' }), /Invalid reaction/);
  assert.throws(() => tables.postChat(t.code, anna, { kind: 'voice', audio: 'javascript:alert(1)', ms: 1000 }), /Invalid voice/);
  assert.throws(() => tables.postChat(t.code, anna, { kind: 'text', text: 'x'.repeat(201) }), /Invalid message/);
  tables.postChat(t.code, anna, { kind: 'text', text: '4' });
  tables.postChat(t.code, anna, { kind: 'text', text: '5' });
  tables.postChat(t.code, anna, { kind: 'text', text: '6' });
  assert.throws(() => tables.postChat(t.code, anna, { kind: 'text', text: '7' }), /Slow down/);
  // A new listener gets the recent messages first.
  const late: number[] = [];
  const stop2 = tables.subscribe(t.code, cleo.id, () => {}, (m) => late.push(m.id));
  assert.equal(late.length, 6);
  stop();
  stop2();
  tables.dropMemory();
});

test('registration: the invite code is required, the admin code makes an admin', () => {
  const base = { password: 'secret12', avatar: '🦊' };
  assert.throws(() => auth.register({ ...base, username: 'nocode' }, '7.7.7.7'), /Wrong invite code/);
  assert.throws(() => auth.register({ ...base, username: 'wrongcode', code: 'nope' }, '7.7.7.7'), /Wrong invite code/);
  assert.throws(() => auth.register({ ...base, username: 'fakeboss', code: 'friends-only', admin: true }, '7.7.7.7'), /Wrong admin code/);
  assert.equal(auth.register({ ...base, username: 'player1', code: ' friends-only ' }).account.admin, false);
  const boss = auth.register({ ...base, username: 'boss', code: 'boss-code', admin: true });
  assert.equal(boss.account.admin, true);
  assert.equal(auth.sessionAccount(boss.token)?.admin, true);
  // Wrong codes count like wrong passwords: after 10 from one IP, even the right code waits.
  for (let i = 0; i < 7; i++) assert.throws(() => auth.register({ ...base, username: `try${i}`, code: 'x' }, '7.7.7.7'));
  assert.throws(() => auth.register({ ...base, username: 'late', code: 'friends-only' }, '7.7.7.7'), /Too many/);
});

test('admin: block, unblock, passwords, admin rights, and deleting only accounts without history', () => {
  const boss = auth.login({ username: 'boss', password: 'secret12' }, '2.2.2.2').account;
  const victim = auth.register({ username: 'victim', password: 'secret12', avatar: '🦊', code: 'friends-only' });
  assert.ok(admin.listAccounts().some((a) => a.id === victim.account.id && !a.blocked));

  admin.updateAccount(boss, victim.account.id, { blocked: true });
  assert.equal(auth.sessionAccount(victim.token), null, 'blocking signs them out');
  assert.throws(() => auth.login({ username: 'victim', password: 'secret12' }, '2.2.2.2'), /blocked/);
  admin.updateAccount(boss, victim.account.id, { blocked: false, password: 'newpass1' });
  assert.throws(() => auth.login({ username: 'victim', password: 'secret12' }, '2.2.2.2'), /Wrong/);
  const again = auth.login({ username: 'victim', password: 'newpass1' }, '2.2.2.2');

  assert.equal(admin.updateAccount(boss, victim.account.id, { admin: true }).admin, true);
  assert.equal(auth.sessionAccount(again.token)?.admin, true);
  assert.throws(() => admin.updateAccount(boss, boss.id, { admin: false }), /own account/);
  assert.throws(() => admin.updateAccount(boss, boss.id, { blocked: true }), /own account/);

  assert.throws(() => admin.deleteAccount(boss, anna.id), /has played/);
  admin.deleteAccount(boss, victim.account.id);
  assert.ok(!admin.listAccounts().some((a) => a.id === victim.account.id));
});

test('admin: runs any table, and can stand a player up', async () => {
  const boss = auth.login({ username: 'boss', password: 'secret12' }, '2.2.2.2').account;
  const t = tables.createTable(anna, { name: 'Admin', mode: 'fun', sb: 10, bb: 20, buyIn: 1000, maxSeats: 3 });
  tables.join(t.code, anna);
  tables.join(t.code, ben);
  assert.throws(() => tables.start(t.code, cleo), /host/);
  tables.start(t.code, boss);
  await until(() => runningHand(t.code, anna));
  assert.throws(() => tables.kick(t.code, cleo, ben.id), /admins/);
  tables.kick(t.code, boss, ben.id);
  await until(() => !tables.tableView(t.code, anna.id).seats.some((s) => s?.account.id === ben.id));
  const closed = tables.close(t.code, boss);
  assert.equal(closed.status, 'closed');
  tables.dropMemory();
});

test('a Play admin is a Poker Bank admin too; other accounts stay members', async () => {
  const bank = await import('../src/auth.ts');
  bank.allowAdminSessions((token) => Boolean(auth.sessionAccount(token)?.admin));
  const roleWith = (session: string) => {
    const req = { path: '/games', ip: '9.9.9.9', headers: { authorization: 'Bearer group-pin' }, get: (h: string) => (h === 'x-online-session' ? session : undefined) } as never;
    let role: string | undefined;
    bank.authenticate(req, {} as never, () => (role = (req as { role?: string }).role));
    return role;
  };
  const boss = auth.login({ username: 'boss', password: 'secret12' }, '3.3.3.3');
  const player = auth.login({ username: 'anna', password: 'secret12' }, '3.3.3.3');
  assert.equal(roleWith(boss.token), 'admin');
  assert.equal(roleWith(player.token), 'member');
  assert.equal(roleWith(''), 'member');
});

test('standing up and sitting down again counts as one buy-in; a rebuy adds one', () => {
  const t = tables.createTable(anna, { name: 'Again', mode: 'cash', sb: 10, bb: 20, buyIn: 1000, maxSeats: 3 });
  tables.join(t.code, anna);
  tables.leave(t.code, anna);
  const seat = (v: LiveTableView) => v.seats.find((s) => s?.account.id === anna.id)!;
  const back = tables.join(t.code, anna);
  assert.equal(seat(back).boughtIn, 1000, 'buy-in minus the cash-out');
  tables.dropMemory();
  // After a restart the amount is read back from the ledger the same way.
  assert.equal(seat(tables.tableView(t.code, anna.id)).boughtIn, 1000);
  tables.dropMemory();
});

test('sitting in, rebuying or joining between hands never postpones the next deal', async () => {
  const t = tables.createTable(anna, { name: 'Spam', mode: 'fun', sb: 10, bb: 20, buyIn: 1000, maxSeats: 3 });
  tables.join(t.code, anna);
  tables.join(t.code, ben);
  tables.start(t.code, anna);
  const v = await until(() => runningHand(t.code, anna));
  const first = v.hand!.handNo;
  tables.action(t.code, byId(toActId(v)), { type: 'fold' });
  // Clicking "sit in" every 2 ms used to restart the 5 ms countdown each time, so no hand was dealt until it stopped.
  const end = Date.now() + 60;
  let dealtWhileClicking = false;
  while (Date.now() < end) {
    tables.sit(t.code, ben, false);
    if ((tables.tableView(t.code, anna.id).hand?.handNo ?? 0) > first) dealtWhileClicking = true;
    await sleep(2);
  }
  assert.ok(dealtWhileClicking, 'the next hand was dealt on time');
  tables.dropMemory();
});

test('bots: only at fun tables and only by the host; they fill the free seats and can’t sign in', () => {
  const cash = tables.createTable(anna, { name: 'Cash', mode: 'cash', sb: 10, bb: 20, buyIn: 1000, maxSeats: 4 });
  tables.join(cash.code, anna);
  assert.throws(() => tables.fillBots(cash.code, anna, { level: 'regular' }), /fun tables/);
  const fun = tables.createTable(anna, { name: 'Bots', mode: 'fun', sb: 10, bb: 20, buyIn: 1000, maxSeats: 4 });
  tables.join(fun.code, anna);
  assert.throws(() => tables.fillBots(fun.code, ben, { level: 'regular' }), /host/);
  assert.throws(() => tables.fillBots(fun.code, anna, { level: 'godlike' }), /level/);
  const v = tables.fillBots(fun.code, anna, { level: 'casual' });
  const bots = v.seats.filter((x) => x?.account.bot);
  assert.equal(bots.length, 3);
  assert.ok(bots.every((b) => b!.account.bot === 'casual' && b!.account.username.endsWith('(Bot)') && b!.connected && b!.stack === 1000));
  assert.ok(!admin.listAccounts().some((a) => a.username.endsWith('(Bot)')), 'bots are not in the admin list');
  assert.throws(() => auth.login({ username: bots[0]!.account.username, password: '' }, '4.4.4.4'), /Wrong/);
  tables.dropMemory();
});

test('bots: play their turns, keep every chip, and never play on without a person', async () => {
  const t = tables.createTable(anna, { name: 'Bot game', mode: 'fun', sb: 10, bb: 20, buyIn: 1000, maxSeats: 4 });
  tables.join(t.code, anna);
  tables.fillBots(t.code, anna, { level: 'shark' });
  tables.start(t.code, anna);
  // Anna calls or checks whenever it is her turn and rebuys when she's broke (bots alone wait for her); the bots do the rest.
  let hands = 0;
  for (let last = 0; hands < 6; ) {
    const v = await until(() => {
      const x = tables.tableView(t.code, anna.id);
      return x.hand && (x.hand.legal || (x.hand.result && x.hand.handNo !== last)) ? x : null;
    }, 4000);
    if (v.hand!.legal) tables.action(t.code, anna, { type: v.hand!.legal.check ? 'check' : 'call' });
    else {
      last = v.hand!.handNo;
      hands++;
      if (v.seats.find((x) => x?.account.id === anna.id)!.stack === 0) tables.rebuy(t.code, anna);
      const total = v.seats.reduce((sum, x) => sum + (x?.stack ?? 0), 0);
      const inPlay = v.seats.reduce((sum, x) => sum + (x?.boughtIn ?? 0), 0);
      assert.equal(total, inPlay, `hand ${last}: chips on the table = chips bought in`);
    }
  }
  // Anna sits out: the bots wait instead of playing each other.
  tables.sit(t.code, anna, true);
  const before = tables.tableView(t.code, anna.id).hand!.handNo;
  await until(() => tables.tableView(t.code, anna.id).hand?.result);
  await sleep(60);
  assert.ok(tables.tableView(t.code, anna.id).hand!.handNo <= before + 1, 'no new hands with only bots');
  tables.dropMemory();
});

test('bots: a friend joining a full table takes an idle bot’s seat; the host can remove bots', () => {
  const t = tables.createTable(anna, { name: 'Full', mode: 'fun', sb: 10, bb: 20, buyIn: 1000, maxSeats: 3 });
  tables.join(t.code, anna);
  tables.fillBots(t.code, anna, { level: 'beginner' });
  const v = tables.join(t.code, ben);
  assert.equal(v.seats.filter((x) => x?.account.bot).length, 1, 'one bot made room');
  const bot = v.seats.find((x) => x?.account.bot)!;
  assert.throws(() => tables.removeBot(t.code, ben, bot.account.id), /host/);
  assert.equal(tables.removeBot(t.code, anna, bot.account.id).seats.filter((x) => x?.account.bot).length, 0);
  tables.dropMemory();
});

test('isolation: Poker Bank’s database is never opened or created', () => {
  assert.equal(existsSync(process.env.DB_FILE!), false);
  const names = (odb.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name);
  for (const bank of ['players', 'games', 'game_players', 'events']) assert.ok(!names.includes(bank), `${bank} is not in online.db`);
  assert.ok(names.includes('accounts') && names.includes('ledger'));
});
