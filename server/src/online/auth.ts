import type { RequestHandler } from 'express';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { AVATARS, type Account, type SessionResponse } from '../../../shared/online.ts';
import { BOT_STYLE, type BotLevel } from '../../../shared/poker/bots.ts';
import { odb } from './db.ts';
import { OnlineError } from './http.ts';

// Personal accounts for online play, on top of the group code that already guards the whole API.
// The session token travels as `X-Online-Session`, so it never collides with the group code's Authorization header.

const SESSION_DAYS = 180;
/** Needed to create an account. Unset: nobody can register. */
const INVITE_CODE = process.env.ONLINE_INVITE_CODE ?? '';
/** Needed to register as an administrator. Unset: admins can only be appointed by another admin. */
const ADMIN_CODE = process.env.ONLINE_ADMIN_CODE ?? '';
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; since: number }>();

declare module 'express-serve-static-core' {
  interface Request {
    account?: Account;
    sessionHash?: string;
  }
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`;
}

// Unknown usernames still pay for one scrypt run, so timing doesn't reveal which names exist.
const DUMMY = hashPassword(randomBytes(16).toString('hex'));

function same(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

function checkPassword(password: string, stored: string): boolean {
  const [, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, Buffer.from(salt, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

export function username(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!/^[\p{L}\p{N}_.-]{3,20}$/u.test(s)) throw new OnlineError(400, 'username_invalid', 'Username: 3–20 letters, digits, _ . -');
  return s;
}

export function password(value: unknown): string {
  const s = typeof value === 'string' ? value : '';
  if (s.length < 6 || s.length > 200) throw new OnlineError(400, 'password_short', 'Password needs at least 6 characters');
  return s;
}

export function avatar(value: unknown): string {
  if (typeof value !== 'string' || !AVATARS.includes(value)) throw new OnlineError(400, 'avatar_invalid', 'Pick an avatar');
  return value;
}

function createSession(account: Account): SessionResponse {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  odb.prepare('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), account.id, expires);
  return { token, account };
}

export function hashNewPassword(value: unknown): string {
  return hashPassword(password(value));
}

const accountRow = (a: { id: number; username: string; avatar: string; admin: number; bot?: string | null }): Account => ({
  id: a.id, username: a.username, avatar: a.avatar, admin: a.admin === 1, ...(a.bot ? { bot: a.bot as BotLevel } : {}),
});

export function getAccount(id: number): Account {
  const a = odb.prepare('SELECT id, username, avatar, admin, bot FROM accounts WHERE id = ?').get(id) as Parameters<typeof accountRow>[0] | undefined;
  if (!a) throw new OnlineError(404, 'account_not_found', 'Player not found');
  return accountRow(a);
}

export interface RegisterInput {
  username?: unknown;
  password?: unknown;
  avatar?: unknown;
  /** The invite code, or the admin code when `admin` is true. */
  code?: unknown;
  admin?: unknown;
}

/** Needs the invite code; with `admin` the admin code instead. Wrong codes count as failed logins for the IP. */
export function register(body: RegisterInput, ip = ''): SessionResponse {
  if (limited(ip)) throw new OnlineError(429, 'too_many_attempts', 'Too many failed attempts, try again later');
  const admin = body.admin === true;
  const expected = admin ? ADMIN_CODE : INVITE_CODE;
  if (!expected) throw new OnlineError(403, 'registration_closed', admin ? 'Admin registration is closed' : 'Registration is closed');
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!same(code, expected)) {
    fail(ip);
    throw new OnlineError(403, admin ? 'admin_code_invalid' : 'invite_invalid', admin ? 'Wrong admin code' : 'Wrong invite code');
  }
  const name = username(body.username);
  const pw = password(body.password);
  const av = avatar(body.avatar);
  const taken = odb.prepare('SELECT 1 FROM accounts WHERE username = ?').get(name);
  if (taken) throw new OnlineError(409, 'username_taken', `${name} is taken`, { name });
  const id = Number(odb.prepare('INSERT INTO accounts (username, password, avatar, admin) VALUES (?, ?, ?, ?)').run(name, hashPassword(pw), av, admin ? 1 : 0).lastInsertRowid);
  return createSession(getAccount(id));
}

function fail(ip: string) {
  const f = failures.get(ip);
  if (f && Date.now() - f.since <= WINDOW_MS) f.count++;
  else failures.set(ip, { count: 1, since: Date.now() });
}

function limited(ip: string): boolean {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.since > WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return f.count >= MAX_FAILURES;
}

/** After 10 failed logins from one IP within 15 minutes, that IP has to wait. */
export function login(body: { username?: unknown; password?: unknown }, ip: string): SessionResponse {
  if (limited(ip)) throw new OnlineError(429, 'too_many_attempts', 'Too many failed logins, try again later');
  const name = typeof body.username === 'string' ? body.username.trim() : '';
  const pw = typeof body.password === 'string' ? body.password : '';
  const row = odb.prepare('SELECT id, password, blocked FROM accounts WHERE username = ? AND bot IS NULL').get(name) as { id: number; password: string; blocked: number } | undefined;
  const ok = checkPassword(pw, row?.password ?? DUMMY) && row !== undefined;
  if (!ok) {
    fail(ip);
    throw new OnlineError(401, 'wrong_login', 'Wrong username or password');
  }
  if (row.blocked) throw new OnlineError(403, 'account_blocked', 'This account is blocked');
  return createSession(getAccount(row.id));
}

export function logout(sessionHash: string) {
  odb.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sessionHash);
}

export function setAvatar(id: number, value: unknown): Account {
  odb.prepare('UPDATE accounts SET avatar = ? WHERE id = ?').run(avatar(value), id);
  return getAccount(id);
}

const sessionStmt = odb.prepare(`
  SELECT a.id, a.username, a.avatar, a.admin FROM sessions s JOIN accounts a ON a.id = s.account_id
  WHERE s.token_hash = ? AND a.blocked = 0 AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`);

/** The signed-in account for a session token; blocked accounts have none. */
export function sessionAccount(token: string): Account | null {
  if (!token) return null;
  const row = sessionStmt.get(hashToken(token)) as Parameters<typeof accountRow>[0] | undefined;
  return row ? accountRow(row) : null;
}

export const requireAccount: RequestHandler = (req, _res, next) => {
  const token = req.get('x-online-session') ?? '';
  const account = sessionAccount(token);
  if (!account) throw new OnlineError(401, 'session_required', 'Please sign in');
  req.account = account;
  req.sessionHash = hashToken(token);
  next();
};

export const requireOnlineAdmin: RequestHandler = (req, _res, next) => {
  if (!req.account?.admin) throw new OnlineError(403, 'admin_required', 'Only admins can do that');
  next();
};

/**
 * The bot account for `level` number `index` (0 = the level's first name), created on first use. Its username has
 * characters people can't register with, and it has no usable password, so nobody can sign in as a bot.
 */
export function botAccount(level: BotLevel, index: number): Account {
  const style = BOT_STYLE[level];
  const round = Math.floor(index / style.names.length);
  const name = `${style.names[index % style.names.length]}${round ? ` ${round + 1}` : ''} (Bot)`;
  const row = odb.prepare('SELECT id FROM accounts WHERE username = ? AND bot = ?').get(name, level) as { id: number } | undefined;
  if (row) return getAccount(row.id);
  const id = Number(odb.prepare('INSERT INTO accounts (username, password, avatar, bot) VALUES (?, ?, ?, ?)')
    .run(name, `bot$${randomBytes(16).toString('hex')}$`, style.avatars[index % style.avatars.length], level).lastInsertRowid);
  return getAccount(id);
}
