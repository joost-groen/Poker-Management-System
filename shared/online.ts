// API shapes of the online poker section (/api/online). Separate from Poker Bank's types on purpose.
import type { BotLevel } from './poker/bots.ts';
import type { HandRecord } from './poker/history.ts';
import type { HandView } from './poker/view.ts';
import type { Transfer } from './types.ts';

/** 'cash': real money, amounts in cents, counts in the online stats. 'fun': play chips, never counted. */
export type StakesMode = 'cash' | 'fun';
export type TableStatus = 'open' | 'closed';

export const AVATARS = [
  '😎', '🤠', '🦊', '🐸', '🐙', '🦄', '🐯', '🐼', '👻', '🤖', '🧙', '🦁', '🐧', '🐳', '🌵', '🍀', '🔥', '🎩', '👑', '🍕',
];

export interface Account {
  id: number;
  username: string;
  avatar: string;
  /** Registered with the admin code, or made admin by another admin: manages accounts, tables and Poker Bank. */
  admin: boolean;
  /** A computer player at fun tables, with its level. Bot accounts can't sign in. */
  bot?: BotLevel;
}

/** An account as the admin page lists it. */
export interface AdminAccount extends Account {
  blocked: boolean;
  createdAt: string;
  /** Live tables played at (any buy-in) and hands dealt in; accounts with history can be blocked but not deleted. */
  tables: number;
  hands: number;
}

export interface SessionResponse {
  token: string;
  account: Account;
}

export interface TableSummary {
  code: string;
  name: string;
  mode: StakesMode;
  sb: number;
  bb: number;
  buyIn: number;
  maxSeats: number;
  seated: number;
  host: Account;
  status: TableStatus;
  started: boolean;
  createdAt: string;
  closedAt: string | null;
  /** The asking account has a seat (open tables) or played here (closed tables). */
  mine: boolean;
}

export interface SeatView {
  seat: number;
  account: Account;
  stack: number;
  sittingOut: boolean;
  /** Leaves (cashing out) when the current hand ends. */
  leaving: boolean;
  /** In at this table now: every buy-in and rebuy, minus what was cashed out by standing up earlier. */
  boughtIn: number;
  /** Has the table open right now. */
  connected: boolean;
}

export interface LiveTableView extends Omit<TableSummary, 'seated' | 'mine' | 'host'> {
  hostId: number;
  /** The host ends the table once the running hand is over. */
  closing: boolean;
  seats: (SeatView | null)[];
  /** The current or last hand, as the viewer may see it. */
  hand: HandView | null;
  /** The viewer's seat number. */
  you: number | null;
  /** When the player to act runs out of time (server clock, ms). */
  deadline: number | null;
  serverTime: number;
}

export interface ResultLine {
  accountId: number;
  username: string;
  avatar: string;
  boughtIn: number;
  cashedOut: number;
  /** Cashed out minus bought in. */
  result: number;
}

export interface TableResult {
  hands: number;
  lines: ResultLine[];
  /** Who pays whom; cash tables only. */
  transfers: Transfer[];
}

export interface TableDetail extends TableSummary {
  /** Final results once the table is closed. */
  result: TableResult | null;
}

export interface OnlineRankingRow {
  accountId: number;
  username: string;
  avatar: string;
  tables: number;
  hands: number;
  net: number;
  /** Net over the last 7 days. */
  week: number;
  /** Share of hands where the player put money in voluntarily before the flop (0..1). */
  vpip: number;
  /** Share of hands raised before the flop. */
  pfr: number;
  /** Re-raises when facing one raise before the flop, per chance. */
  threeBet: number;
  /** Went to showdown, per flop seen. */
  wtsd: number;
  /** Won at showdown, per showdown. */
  wsd: number;
  wins: number;
  best: number;
}

export interface OnlineTableLine {
  code: string;
  name: string;
  closedAt: string;
  result: number;
}

export interface OnlinePlayerDetail {
  account: Account;
  stats: OnlineRankingRow | null;
  /** Closed cash tables, newest first. */
  tables: OnlineTableLine[];
}

export type OnlineErrorCode =
  | 'invalid'
  | 'username_invalid'
  | 'username_taken'
  | 'password_short'
  | 'avatar_invalid'
  | 'wrong_login'
  | 'session_required'
  | 'too_many_attempts'
  | 'account_not_found'
  | 'table_not_found'
  | 'table_closed'
  | 'table_full'
  | 'seat_taken'
  | 'already_seated'
  | 'not_seated'
  | 'not_host'
  | 'hand_running'
  | 'rebuy_not_allowed'
  | 'not_enough_players'
  | 'not_your_turn'
  | 'illegal_action'
  | 'hand_over'
  | 'chat_too_fast'
  | 'registration_closed'
  | 'invite_invalid'
  | 'admin_code_invalid'
  | 'account_blocked'
  | 'admin_required'
  | 'account_has_history'
  | 'not_on_yourself'
  | 'bots_fun_only'
  | 'bot_leaving'
  | 'server_error';

export interface OnlineErrorBody {
  error: string;
  code: OnlineErrorCode;
  params?: Record<string, string | number>;
}

/** A finished hand at a live table, with the hole cards the viewer may see. */
export interface HistoryHand {
  id: number;
  code: string;
  tableName: string;
  mode: StakesMode;
  maxSeats: number;
  at: string;
  record: HandRecord;
  /** Avatars of the players in the hand, by player id. */
  avatars: Record<string, string>;
}

/** Quick reactions at a live table. */
export const REACTIONS = ['👍', '😂', '😮', '😬', '🔥', '🙏', '🍀', '🐟', '🦈', '💸'] as const;

/** Longest voice message (ms) and its largest size as a data URL. */
export const VOICE_MAX_MS = 15_000;
export const VOICE_MAX_CHARS = 360_000;

export interface ChatMessage {
  id: number;
  accountId: number;
  username: string;
  avatar: string;
  /** Seat of the sender when sent, so the felt can show the bubble there. */
  seat: number | null;
  kind: 'text' | 'reaction' | 'voice';
  text?: string;
  /** Voice: a data:audio/... URL, dropped from older messages to save memory. */
  audio?: string;
  ms?: number;
  /** Server time (ms). */
  at: number;
}
