import type { AdminAccount, Account } from '../../../shared/online.ts';
import { getAccount, hashNewPassword } from './auth.ts';
import { odb, otx } from './db.ts';
import { OnlineError } from './http.ts';

// What an admin account can do to other accounts. An admin can't demote, block or delete themselves,
// so there is always at least one admin left once there was one.

interface Row {
  id: number;
  username: string;
  avatar: string;
  admin: number;
  blocked: number;
  created_at: string;
  tables: number;
  hands: number;
}

const list = odb.prepare(`
  SELECT a.id, a.username, a.avatar, a.admin, a.blocked, a.created_at,
    (SELECT COUNT(DISTINCT l.table_id) FROM ledger l WHERE l.account_id = a.id) AS tables,
    (SELECT COUNT(*) FROM hand_players hp WHERE hp.account_id = a.id) AS hands
  FROM accounts a WHERE a.bot IS NULL ORDER BY a.admin DESC, a.username COLLATE NOCASE`);

export function listAccounts(): AdminAccount[] {
  return (list.all() as unknown as Row[]).map((r) => ({
    id: r.id, username: r.username, avatar: r.avatar, admin: r.admin === 1, blocked: r.blocked === 1,
    createdAt: r.created_at, tables: r.tables, hands: r.hands,
  }));
}

function notSelf(actor: Account, id: number) {
  if (actor.id === id) throw new OnlineError(409, 'not_on_yourself', 'Not on your own account');
}

export interface AccountChange {
  admin?: unknown;
  blocked?: unknown;
  /** A new password; signs the account out everywhere. */
  password?: unknown;
}

export function updateAccount(actor: Account, id: number, body: AccountChange): AdminAccount {
  getAccount(id);
  otx(() => {
    if (typeof body.admin === 'boolean') {
      notSelf(actor, id);
      odb.prepare('UPDATE accounts SET admin = ? WHERE id = ?').run(body.admin ? 1 : 0, id);
    }
    if (typeof body.blocked === 'boolean') {
      notSelf(actor, id);
      odb.prepare('UPDATE accounts SET blocked = ? WHERE id = ?').run(body.blocked ? 1 : 0, id);
      if (body.blocked) odb.prepare('DELETE FROM sessions WHERE account_id = ?').run(id);
    }
    if (body.password !== undefined) {
      odb.prepare('UPDATE accounts SET password = ? WHERE id = ?').run(hashNewPassword(body.password), id);
      odb.prepare('DELETE FROM sessions WHERE account_id = ?').run(id);
    }
  });
  return listAccounts().find((a) => a.id === id)!;
}

/** Only accounts that never sat at or hosted a table; anyone with history is blocked instead, so results still add up. */
export function deleteAccount(actor: Account, id: number) {
  getAccount(id);
  notSelf(actor, id);
  const used = odb.prepare(`
    SELECT 1 FROM ledger WHERE account_id = ?1 UNION SELECT 1 FROM hand_players WHERE account_id = ?1
    UNION SELECT 1 FROM tables WHERE host_id = ?1 UNION SELECT 1 FROM seats WHERE account_id = ?1`).get(id);
  if (used) throw new OnlineError(409, 'account_has_history', 'This account has played; block it instead');
  otx(() => {
    odb.prepare('DELETE FROM sessions WHERE account_id = ?').run(id);
    odb.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  });
}
