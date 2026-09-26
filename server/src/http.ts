import type { ErrorCode } from '../../shared/types.ts';

/** An API error: `code` is stable for clients (they translate it), `message` is English for humans. */
export class HttpError extends Error {
  status: number;
  code: ErrorCode;
  params: Record<string, string | number>;
  constructor(status: number, code: ErrorCode, message: string, params: Record<string, string | number> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.params = params;
  }
}

export function int(value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, 'invalid', `Invalid ${field}`, { field });
  }
  return n;
}

export function name(value: unknown): string {
  const s = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!s || s.length > 40) throw new HttpError(400, 'name_length', 'Name must be 1–40 characters');
  return s;
}

/** "YYYY-MM-DD" that is a real calendar date. */
export function date(value: unknown): string {
  const s = typeof value === 'string' ? value : '';
  const d = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new HttpError(400, 'invalid_date', 'Invalid date');
  }
  return s;
}
