import type { OnlinePlayerDetail, OnlineRankingRow, ResultLine, TableResult } from '../../../shared/online.ts';
import { settle } from '../settle.ts';
import { getAccount } from './auth.ts';
import { odb } from './db.ts';
import { OnlineError } from './http.ts';

// Only closed cash tables count. Fun tables are listed with their chip results but never ranked.

interface LineRow {
  tableId: number;
  code: string;
  name: string;
  closedAt: string;
  accountId: number;
  username: string;
  avatar: string;
  boughtIn: number;
  cashedOut: number;
}

const LINES = `
  SELECT t.id AS tableId, t.code, t.name, t.closed_at AS closedAt, a.id AS accountId, a.username, a.avatar,
         SUM(CASE WHEN l.type = 'buyin' THEN l.amount ELSE 0 END) AS boughtIn,
         SUM(CASE WHEN l.type = 'cashout' THEN l.amount ELSE 0 END) AS cashedOut
  FROM tables t
  JOIN ledger l ON l.table_id = t.id
  JOIN accounts a ON a.id = l.account_id`;

const cashLines = odb.prepare(`${LINES} WHERE t.status = 'closed' AND t.mode = 'cash' GROUP BY t.id, a.id ORDER BY t.closed_at DESC, t.id DESC`);
const tableLines = odb.prepare(`${LINES} WHERE t.id = ? GROUP BY a.id ORDER BY a.username COLLATE NOCASE`);
const handStats = odb.prepare(`
  SELECT hp.account_id AS accountId, COUNT(*) AS hands, SUM(hp.vpip) AS vpip
  FROM hand_players hp JOIN hands h ON h.id = hp.hand_id JOIN tables t ON t.id = h.table_id
  WHERE t.status = 'closed' AND t.mode = 'cash'
  GROUP BY hp.account_id`);

export function onlineRanking(): OnlineRankingRow[] {
  const lines = cashLines.all() as unknown as LineRow[];
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const top = new Map<number, number>();
  for (const l of lines) top.set(l.tableId, Math.max(top.get(l.tableId) ?? 0, l.cashedOut - l.boughtIn));

  const rows = new Map<number, OnlineRankingRow>();
  for (const l of lines) {
    const result = l.cashedOut - l.boughtIn;
    const row = rows.get(l.accountId) ?? {
      accountId: l.accountId, username: l.username, avatar: l.avatar, tables: 0, hands: 0, net: 0, week: 0, vpip: 0, wins: 0,
      best: Number.NEGATIVE_INFINITY,
    };
    row.tables++;
    row.net += result;
    if (l.closedAt >= weekAgo) row.week += result;
    if (result > 0 && result === top.get(l.tableId)) row.wins++;
    row.best = Math.max(row.best, result);
    rows.set(l.accountId, row);
  }
  for (const h of handStats.all() as { accountId: number; hands: number; vpip: number }[]) {
    const row = rows.get(h.accountId);
    if (!row) continue;
    row.hands = h.hands;
    row.vpip = h.hands ? h.vpip / h.hands : 0;
  }
  return [...rows.values()].sort((a, b) => b.net - a.net || a.username.localeCompare(b.username));
}

export function onlinePlayer(accountId: number): OnlinePlayerDetail {
  const account = getAccount(accountId);
  const tables = (cashLines.all() as unknown as LineRow[])
    .filter((l) => l.accountId === accountId)
    .map((l) => ({ code: l.code, name: l.name, closedAt: l.closedAt, result: l.cashedOut - l.boughtIn }));
  return { account, stats: onlineRanking().find((r) => r.accountId === accountId) ?? null, tables };
}

export function tableResult(code: string): TableResult | null {
  const t = odb.prepare('SELECT id, status, mode FROM tables WHERE code = ?').get(code.toUpperCase()) as
    | { id: number; status: string; mode: string }
    | undefined;
  if (!t) throw new OnlineError(404, 'table_not_found', 'Table not found');
  if (t.status !== 'closed') return null;
  const lines: ResultLine[] = (tableLines.all(t.id) as unknown as LineRow[]).map((l) => ({
    accountId: l.accountId, username: l.username, avatar: l.avatar, boughtIn: l.boughtIn, cashedOut: l.cashedOut,
    result: l.cashedOut - l.boughtIn,
  }));
  const hands = (odb.prepare('SELECT COUNT(*) AS n FROM hands WHERE table_id = ?').get(t.id) as { n: number }).n;
  const transfers = t.mode === 'cash' ? settle(lines.map((l) => ({ id: l.accountId, name: l.username, balance: l.result }))) : [];
  return { hands, lines: lines.sort((a, b) => b.result - a.result), transfers };
}
