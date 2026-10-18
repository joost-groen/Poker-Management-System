import type { ErrorRequestHandler } from 'express';
import type { OnlineErrorBody, OnlineErrorCode } from '../../../shared/online.ts';
import { PokerError } from '../../../shared/poker/holdem.ts';

export class OnlineError extends Error {
  status: number;
  code: OnlineErrorCode;
  params: Record<string, string | number>;
  constructor(status: number, code: OnlineErrorCode, message: string, params: Record<string, string | number> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.params = params;
  }
}

/** Handles the online section's own errors; anything else goes on to the app's error handler. */
export const onlineErrors: ErrorRequestHandler = (err, _req, res, next) => {
  const send = (status: number, body: OnlineErrorBody) => void res.status(status).json(body);
  if (err instanceof OnlineError) return send(err.status, { error: err.message, code: err.code, params: err.params });
  if (err instanceof PokerError) return send(409, { error: err.message, code: err.code });
  next(err);
};

export function int(value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw new OnlineError(400, 'invalid', `Invalid ${field}`, { field });
  }
  return n;
}

export function text(value: unknown, field: string, max: number): string {
  const s = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!s || s.length > max) throw new OnlineError(400, 'invalid', `Invalid ${field}`, { field });
  return s;
}
