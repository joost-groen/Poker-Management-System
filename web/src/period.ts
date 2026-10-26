import { useSyncExternalStore } from 'react';

/** The time filter shared by Ranking and Stats. */
export type Period = 'all' | 'month';

const KEY = 'poker-bank-period';

function initial(): Period {
  try {
    return localStorage.getItem(KEY) === 'month' ? 'month' : 'all';
  } catch {
    return 'all';
  }
}

let period: Period = initial();
const listeners = new Set<() => void>();

export function setPeriod(next: Period) {
  period = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* per-device convenience only */
  }
  listeners.forEach((fn) => fn());
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export function usePeriod(): Period {
  return useSyncExternalStore(subscribe, () => period);
}

/** `?from=` with the start of the local month, so a game played at 00:30 on the 1st counts for that month. */
export function periodQuery(p: Period): string {
  if (p === 'all') return '';
  const now = new Date();
  return `?from=${encodeURIComponent(new Date(now.getFullYear(), now.getMonth(), 1).toISOString())}`;
}
