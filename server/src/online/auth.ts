import type { RequestHandler } from 'express';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { AVATARS, type Account, type SessionResponse } from '../../../shared/online.ts';
import { odb } from './db.ts';
import { OnlineError } from './http.ts';

// Personal accounts for online play, on top of the group code that already guards the whole API.
// The session token travels as `X-Online-Session`, so it never collides with the group code's Authorization header.

const SESSION_DAYS = 180;
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

function password(value: unknown): string {
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

export function getAccount(id: number): Account {
  const a = odb.prepare('SELECT id, username, avatar FROM accounts WHERE id = ?').get(id) as Account | undefined;
  if (!a) throw new OnlineError(404, 'account_not_found', 'Player not found');
  return { ...a };
}

export function register(body: { username?: unknown; password?: unknown; avatar?: unknown }): SessionResponse {
  const name = username(body.username);
  const pw = password(body.password);
  const av = avatar(body.avatar);
  const taken = odb.prepare('SELECT 1 FROM accounts WHERE username = ?').get(name);
  if (taken) throw new OnlineError(409, 'username_taken', `${name} is taken`, { name });
  const id = Number(odb.prepare('INSERT INTO accounts (username, password, avatar) VALUES (?, ?, ?)').run(name, hashPassword(pw), av).lastInsertRowid);
  return createSession(getAccount(id));
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
  const row = odb.prepare('SELECT id, password FROM accounts WHERE username = ?').get(name) as { id: number; password: string } | undefined;
  const ok = checkPassword(pw, row?.password ?? DUMMY) && row !== undefined;
  if (!ok) {
    const f = failures.get(ip);
    if (f && Date.now() - f.since <= WINDOW_MS) f.count++;
    else failures.set(ip, { count: 1, since: Date.now() });
    throw new OnlineError(401, 'wrong_login', 'Wrong username or password');
  }
  return createSession(getAccount(row.id));
}

export function logout(sessionHash: string) {
  odb.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sessionHash);
}

export function setAvatar(id: number, value: unknown): Account {
  odb.prepare('UPDATE accounts SET avatar = ? WHERE id = ?').run(avatar(value), id);
  return getAccount(id);
}

export const requireAccount: RequestHandler = (req, _res, next) => {
  const token = req.get('x-online-session') ?? '';
  const hash = hashToken(token);
  const row = token
    ? (odb.prepare(`
        SELECT a.id, a.username, a.avatar FROM sessions s JOIN accounts a ON a.id = s.account_id
        WHERE s.token_hash = ? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).get(hash) as Account | undefined)
    : undefined;
  if (!row) throw new OnlineError(401, 'session_required', 'Please sign in');
  req.account = { ...row };
  req.sessionHash = hash;
  next();
};
