import type { BotLevel } from '../../../shared/poker/bots.ts';
import type { Leak } from '../../../shared/poker/coach.ts';

// Bot games never reach the server; their record lives on this device only.
const KEY = 'poker-online-bots';

export interface BotRecord {
  hands: number;
  /** Net result in big blinds. */
  netBb: number;
}

export interface BotStats {
  levels: Partial<Record<BotLevel, BotRecord>>;
  leaks: Partial<Record<Leak, number>>;
}

export function readBotStats(): BotStats {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<BotStats>) : {};
    return { levels: parsed.levels ?? {}, leaks: parsed.leaks ?? {} };
  } catch {
    return { levels: {}, leaks: {} };
  }
}

export function recordBotHand(level: BotLevel, netBb: number, leaks: Leak[]) {
  const s = readBotStats();
  const r = s.levels[level] ?? { hands: 0, netBb: 0 };
  s.levels[level] = { hands: r.hands + 1, netBb: Math.round((r.netBb + netBb) * 10) / 10 };
  for (const l of leaks) s.leaks[l] = (s.leaks[l] ?? 0) + 1;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: the record is a convenience */
  }
}
