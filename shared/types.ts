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
  /** First buy-in: when play really started (unlike startedAt, admins can't move it to another day). */
  firstAt: string | null;
  /** First buy-in to close; null while live. */
  minutes: number | null;
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
  minutes: number | null;
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
  rows: RankingRow[];
}

export interface PlayerGame {
  gameId: number;
  startedAt: string;
  buyIn: number;
  buyins: number;
  cashouts: number;
  result: number;
  /** Finish position in that game (1 = best result; ties share a place). */
  place: number;
  /** Players in that game. */
  field: number;
}

export interface PlayerDetail extends Player {
  stats: RankingRow | null;
  games: PlayerGame[];
  /** Games played vs. closed group games since the player's first one. */
  attendance: { played: number; total: number };
}

/** One closed game in the Stats overview. */
export interface StatsGame {
  gameId: number;
  startedAt: string;
  players: number;
  /** All buy-ins × buy-in: the money that went into the game. */
  pot: number;
  /** First entry to close; null when unknown or implausibly long (left open for over a day). */
  minutes: number | null;
}

export type RecordKind =
  | 'biggestWin'
  | 'biggestLoss'
  | 'biggestPot'
  | 'mostRebuys'
  | 'longestGame'
  | 'mostWins'
  | 'winStreak'
  | 'lossStreak';

export interface StatsRecord {
  kind: RecordKind;
  value: number;
  playerId?: number;
  name?: string;
  gameId?: number;
  startedAt?: string;
}

export interface StatsOverview {
  /** Oldest first. */
  games: StatsGame[];
  /** Distinct players. */
  players: number;
  /** Σ pots. */
  volume: number;
  /** Σ positive results: the money that changed hands. */
  won: number;
  avgPot: number;
  avgPlayers: number;
  avgMinutes: number | null;
  /** Games played per active player, most first. */
  attendance: { playerId: number; name: string; games: number }[];
  /** Running balance per group game (index 0 = before the first game) of the top players by net. */
  race: { playerId: number; name: string; balance: number[] }[];
  records: StatsRecord[];
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
