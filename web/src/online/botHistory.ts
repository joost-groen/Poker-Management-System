import type { BotLevel } from '../../../shared/poker/bots.ts';
import type { Leak } from '../../../shared/poker/coach.ts';
import type { HandRecord } from '../../../shared/poker/history.ts';
import type { ReviewedFeedback } from './components/CoachPanel.tsx';

// The latest bot hands on this device, for the history and as examples for the leaks on the profile.
const KEY = 'poker-online-bot-hands';
const KEEP = 60;

export interface BotHand {
  id: number;
  at: string;
  level: BotLevel;
  mode: 'practice' | 'learn';
  record: HandRecord;
  /** Learn mode: the coach's verdict on each decision. */
  feedback: ReviewedFeedback[];
}

export function readBotHands(): BotHand[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as BotHand[];
  } catch {
    return [];
  }
}

export function saveBotHand(hand: Omit<BotHand, 'id' | 'at'>) {
  const list = readBotHands();
  const next: BotHand = { ...hand, id: (list[0]?.id ?? 0) + 1, at: new Date().toISOString() };
  try {
    localStorage.setItem(KEY, JSON.stringify([next, ...list].slice(0, KEEP)));
  } catch {
    /* storage full or blocked: the history is a convenience */
  }
}

/** Learn-mode hands where a leak showed up, newest first. */
export function handsWithLeak(leak: Leak): BotHand[] {
  return readBotHands().filter((h) => h.feedback.some((f) => f.leak === leak));
}
