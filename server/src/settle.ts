import type { Transfer } from '../../shared/types.ts';

interface Balance {
  id: number;
  name: string;
  /** Positive = receives, negative = pays. */
  balance: number;
}

/** Greedy settlement: largest payer pays largest receiver until everyone is square. */
export function settle(lines: Balance[]): Transfer[] {
  const byAmount = (a: Balance, b: Balance) => b.balance - a.balance || a.name.localeCompare(b.name);
  const receivers = lines.filter((l) => l.balance > 0).map((l) => ({ ...l })).sort(byAmount);
  const payers = lines.filter((l) => l.balance < 0).map((l) => ({ ...l, balance: -l.balance })).sort(byAmount);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < payers.length && j < receivers.length) {
    const p = payers[i];
    const r = receivers[j];
    const amount = Math.min(p.balance, r.balance);
    transfers.push({ from: p.id, fromName: p.name, to: r.id, toName: r.name, amount });
    p.balance -= amount;
    r.balance -= amount;
    if (p.balance === 0) i++;
    if (r.balance === 0) j++;
  }
  return transfers;
}
