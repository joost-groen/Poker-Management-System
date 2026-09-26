// API shapes shared by server and clients. All money values are integer cents.

export type GameStatus = 'live' | 'closed';

export interface Player {
  id: number;
  name: string;
  /** Hidden from lists, new games and the ranking; past games keep them. Only admins see these. */
  archived?: boolean;
}

export interface GamePlayer {
  playerId: number;
  name: string;
  buyins: number;
  cashouts: number;
  /** (buyins - cashouts) * buyIn — what the player owes before their final stack is counted. */
  debt: number;
  finalStack: number | null;
  /** finalStack - debt: positive = receives, negative = pays. Null while live. */
  result: number | null;
}

export interface Transfer {
  from: number;
  fromName: string;
  to: number;
  toName: string;
  amount: number;
}

export interface GameEvent {
  id: number;
  type: 'buyin' | 'cashout';
  playerId: number;
  name: string;
}

/** Full action log entry. `initial` = the opening buy-in. */
export interface LogEvent extends GameEvent {
  initial: boolean;
  createdAt: string;
}

export interface Game {
  id: number;
  buyIn: number;
  status: GameStatus;
  startedAt: string;
  closedAt: string | null;
  players: GamePlayer[];
  totals: { in: number; out: number; onTable: number };
  transfers: Transfer[];
  /** Most recent undoable event (not the opening buy-ins). */
  lastEvent: GameEvent | null;
}

export interface GameSummary {
  id: number;
  buyIn: number;
  status: GameStatus;
  startedAt: string;
  playerCount: number;
  buyins: number;
  onTable: number;
  topName: string | null;
  topResult: number | null;
}

export interface RankingRow {
  playerId: number;
  name: string;
  games: number;
  net: number;
  avg: number;
  wins: number;
  best: number;
  worst: number;
}

export interface Ranking {
  years: string[];
  rows: RankingRow[];
}

export interface PlayerGame {
  gameId: number;
  startedAt: string;
  buyIn: number;
  buyins: number;
  cashouts: number;
  result: number;
}

export interface PlayerDetail extends Player {
  stats: RankingRow | null;
  games: PlayerGame[];
}

export interface Meta {
  /** The group access code is required. */
  auth: boolean;
  /** An admin PIN is configured on the server. */
  admin: boolean;
}

export type Role = 'member' | 'admin';

/** Stable error codes; clients translate these. Params are sent alongside as `params`. */
export type ErrorCode =
  | 'invalid'
  | 'invalid_json'
  | 'invalid_date'
  | 'name_length'
  | 'player_exists'
  | 'player_not_found'
  | 'unknown_player'
  | 'game_not_found'
  | 'game_closed'
  | 'game_live'
  | 'min_players'
  | 'not_in_game'
  | 'already_in_game'
  | 'no_debt'
  | 'nothing_to_undo'
  | 'event_not_found'
  | 'stacks_incomplete'
  | 'stacks_mismatch'
  | 'wrong_pin'
  | 'admin_required'
  | 'too_many_attempts'
  | 'not_found'
  | 'server_error';

export interface ApiErrorBody {
  error: string;
  code: ErrorCode;
  params?: Record<string, string | number>;
}
