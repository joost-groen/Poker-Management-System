import type { RequestHandler } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Role } from '../../shared/types.ts';
import { HttpError } from './http.ts';

// The group code gives normal access; the admin PIN gives everything (and also works as group access).
// Both travel as `Authorization: Bearer <code>`.
export const GROUP_PIN = process.env.APP_PIN ?? '';
export const ADMIN_PIN = process.env.ADMIN_PIN ?? '';

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
// Distinct wrong codes per IP. A phone repeating one outdated code counts once, so a PIN change can't lock out
// a whole group behind the same Wi-Fi; guessing needs many different codes and is stopped.
const failures = new Map<string, { codes: Set<string>; since: number }>();

declare module 'express-serve-static-core' {
  interface Request {
    role?: Role;
  }
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function limited(ip: string): boolean {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.since > WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return f.codes.size >= MAX_FAILURES;
}

function fail(ip: string, token: string) {
  const code = createHash('sha256').update(token).digest('hex');
  const f = failures.get(ip);
  if (f && Date.now() - f.since <= WINDOW_MS) f.codes.add(code);
  else failures.set(ip, { codes: new Set([code]), since: Date.now() });
}

/** After 10 different wrong codes from one IP within 15 minutes, that IP has to wait. */
export const authenticate: RequestHandler = (req, _res, next) => {
  if (req.path === '/meta') return next();
  const ip = req.ip ?? '';
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');

  if (limited(ip)) throw new HttpError(429, 'too_many_attempts', 'Too many wrong codes, try again later');

  if (ADMIN_PIN && token && same(token, ADMIN_PIN)) req.role = 'admin';
  else if (!GROUP_PIN || same(token, GROUP_PIN)) req.role = 'member';
  else {
    fail(ip, token);
    throw new HttpError(401, 'wrong_pin', 'Wrong access code');
  }
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.role !== 'admin') throw new HttpError(403, 'admin_required', 'Admin PIN required');
  next();
};
