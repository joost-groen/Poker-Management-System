// Client for /api/online. Uses Poker Bank's server address and group code, plus its own session token.
import { useSyncExternalStore } from 'react';
import type { Account, LiveTableView, OnlineErrorBody, OnlineErrorCode, SessionResponse } from '../../../shared/online.ts';
import { getPin, getServer } from '../api.ts';
import { odict } from './i18n.ts';

const SESSION_KEY = 'poker-online-session';

type ErrorKey = OnlineErrorCode | 'wrong_pin' | 'unreachable';

export class OnlineApiError extends Error {
  status: number;
  code: ErrorKey;
  params: Record<string, string | number>;
  constructor(status: number, code: ErrorKey, message: string, params: Record<string, string | number> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.params = params;
  }
}

export function onlineErrorText(err: unknown): string {
  if (err instanceof OnlineApiError) {
    const translate = odict().errors[err.code] as ((p: OnlineApiError['params']) => string) | undefined;
    if (translate) return translate(err.params);
  }
  return err instanceof Error ? err.message : String(err);
}

function readSession(): SessionResponse | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionResponse) : null;
  } catch {
    return null;
  }
}

let session = readSession();
const listeners = new Set<() => void>();

export function setSession(next: SessionResponse | null) {
  session = next;
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable: keep it in memory */
  }
  listeners.forEach((fn) => fn());
}

export function setAccount(account: Account) {
  if (session) setSession({ ...session, account });
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export function useAccount(): Account | null {
  return useSyncExternalStore(subscribe, () => session)?.account ?? null;
}

function headers(json: boolean): Record<string, string> {
  const pin = getPin();
  return {
    ...(json && { 'Content-Type': 'application/json' }),
    ...(pin && { Authorization: `Bearer ${pin}` }),
    ...(session && { 'X-Online-Session': session.token }),
  };
}

const url = (path: string) => `${getServer()}/api/online${path}`;

async function fail(res: Response): Promise<never> {
  const err = (await res.json().catch(() => null)) as OnlineErrorBody | null;
  // A rejected session (expired, signed out elsewhere) just means signing in again.
  if (res.status === 401 && err?.code === 'session_required') setSession(null);
  throw new OnlineApiError(res.status, (err?.code as ErrorKey) ?? 'server_error', err?.error ?? res.statusText, err?.params);
}

export async function oapi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url(path), {
      method,
      headers: headers(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new OnlineApiError(0, 'unreachable', 'Server not reachable');
  }
  if (!res.ok) await fail(res);
  return (res.status === 204 ? null : await res.json()) as T;
}

const RETRY_MS = 1500;

/**
 * Follows a table's event stream, reconnecting after drops (bad Wi-Fi, server restart).
 * Returns a function that stops it.
 */
export function followTable(
  code: string,
  onView: (view: LiveTableView) => void,
  onStatus: (connected: boolean) => void,
  onError: (err: unknown) => void,
): () => void {
  let stopped = false;
  let ctrl: AbortController | null = null;

  const run = async () => {
    while (!stopped) {
      ctrl = new AbortController();
      try {
        const res = await fetch(url(`/tables/${encodeURIComponent(code)}/stream`), { headers: headers(false), signal: ctrl.signal, cache: 'no-store' });
        if (!res.ok) await fail(res);
        onStatus(true);
        const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = event.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
            if (data) onView(JSON.parse(data) as LiveTableView);
          }
        }
      } catch (err) {
        if (stopped) return;
        if (err instanceof OnlineApiError && err.status >= 400 && err.status < 500) {
          onError(err);
          return;
        }
      }
      if (stopped) return;
      onStatus(false);
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  };
  run();
  return () => {
    stopped = true;
    ctrl?.abort();
  };
}
