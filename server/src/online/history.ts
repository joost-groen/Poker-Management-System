import type { HistoryHand, StakesMode } from '../../../shared/online.ts';
import { isRecord, redact } from '../../../shared/poker/history.ts';
import { getAccount } from './auth.ts';
import { odb } from './db.ts';
import { OnlineError } from './http.ts';

// Finished hands at live tables. Hole cards leave the server only for their owner or when shown at showdown.

interface Row {
  id: number;
  code: string;
  name: string;
  mode: StakesMode;
  max_seats: number;
  created_at: string;
  data: string;
}

const PAGE = 30;
const SELECT = `SELECT h.id, t.code, t.name, t.mode, t.max_seats, h.created_at, h.data FROM hands h JOIN tables t ON t.id = h.table_id`;
const byTable = odb.prepare(`${SELECT} WHERE t.code = ? AND h.id < ? ORDER BY h.id DESC LIMIT ${PAGE}`);
const byAccount = odb.prepare(`${SELECT} JOIN hand_players hp ON hp.hand_id = h.id WHERE hp.account_id = ? AND h.id < ? ORDER BY h.id DESC LIMIT ${PAGE}`);

function toHistory(rows: Row[], viewerId: number): HistoryHand[] {
  const avatars = new Map<string, string>();
  const avatar = (id: string) => {
    if (!avatars.has(id)) avatars.set(id, getAccount(Number(id)).avatar);
    return avatars.get(id)!;
  };
  return rows.flatMap((r) => {
    const record: unknown = JSON.parse(r.data);
    if (!isRecord(record)) return [];
    return [{
      id: r.id, code: r.code, tableName: r.name, mode: r.mode, maxSeats: r.max_seats, at: r.created_at,
      record: redact(record, String(viewerId)),
      avatars: Object.fromEntries(record.players.map((p) => [p.id, avatar(p.id)])),
    }];
  });
}

/** `before`: a hand id, for the next page. */
export function tableHands(code: string, viewerId: number, before = Number.MAX_SAFE_INTEGER): HistoryHand[] {
  if (!odb.prepare('SELECT 1 FROM tables WHERE code = ?').get(code.toUpperCase())) throw new OnlineError(404, 'table_not_found', 'Table not found');
  return toHistory(byTable.all(code.toUpperCase(), before) as unknown as Row[], viewerId);
}

export function accountHands(accountId: number, before = Number.MAX_SAFE_INTEGER): HistoryHand[] {
  return toHistory(byAccount.all(accountId, before) as unknown as Row[], accountId);
}
