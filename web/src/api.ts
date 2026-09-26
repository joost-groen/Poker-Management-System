// Thin client for the Poker Bank REST API. The web build talks to its own origin; the iPhone app
// talks to the server address entered on the Connect screen (or baked in with VITE_API_URL).
import { useSyncExternalStore } from 'react';
import type { ApiErrorBody, ErrorCode } from '../../shared/types.ts';
import { eur } from './format.ts';
import { dict } from './i18n.ts';

const SERVER_KEY = 'poker-bank-server';
const PIN_KEY = 'poker-bank-pin';
const ADMIN_KEY = 'poker-bank-admin';

export class ApiError extends Error {
  status: number;
  code: ErrorCode | 'unreachable';
  params: Record<string, string | number>;
  constructor(status: number, code: ApiError['code'], message: string, params: ApiError['params'] = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.params = params;
  }
}

/** Any caught error as text in the current language. */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const translate = dict().errors[err.code] as ((p: ApiError['params'], money: typeof eur) => string) | undefined;
    if (translate) return translate(err.params, eur);
  }
  return err instanceof Error ? err.message : String(err);
}

/** Running inside the Capacitor iOS shell rather than a browser. */
export const isNative = Boolean((window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());

// Storage access itself can throw (private mode, blocked site data), so it happens inside the try.
function read(key: string, session = false): string {
  try {
    return (session ? sessionStorage : localStorage).getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string, session = false) {
  try {
    const store = session ? sessionStorage : localStorage;
    if (value) store.setItem(key, value);
    else store.removeItem(key);
  } catch {
    /* storage unavailable: keep it in memory */
  }
}

function normalize(url: string): string {
  const s = url.trim().replace(/\/+$/, '');
  if (!s) return '';
  return /^https?:\/\//.test(s) ? s : `https://${s}`;
}

let server = normalize(read(SERVER_KEY) || import.meta.env.VITE_API_URL || '');
let pin = read(PIN_KEY);
// The admin PIN lives only for this browser session: closing the app locks admin mode again.
let adminPin = read(ADMIN_KEY, true);
const disconnectListeners = new Set<(voluntary: boolean) => void>();
const adminListeners = new Set<() => void>();
// Once the server has answered, a dropped request is a hiccup (bad Wi-Fi), not a wrong address.
let reached = false;

export function getServer() {
  return server;
}

export function getPin() {
  return pin;
}

export function setServer(value: string) {
  server = normalize(value);
  reached = false;
  write(SERVER_KEY, server);
}

export function setPin(value: string) {
  pin = value;
  write(PIN_KEY, value);
}

export function isAdmin() {
  return adminPin !== '';
}

function setAdminPin(value: string) {
  adminPin = value;
  write(ADMIN_KEY, value, true);
  adminListeners.forEach((fn) => fn());
}

export function useAdmin(): boolean {
  return useSyncExternalStore((fn) => {
    adminListeners.add(fn);
    return () => void adminListeners.delete(fn);
  }, isAdmin);
}

/** Checks the admin PIN with the server; only a confirmed PIN switches admin mode on. */
export async function unlockAdmin(value: string) {
  const res = await request<{ role: string }>('/session', 'GET', undefined, value);
  if (res.role !== 'admin') throw new ApiError(401, 'wrong_pin', 'Wrong code');
  setAdminPin(value);
}

export function lockAdmin() {
  setAdminPin('');
}

/** The app needs the Connect screen: no server known yet (native only). */
export function needsServer() {
  return isNative && !server;
}

/** Opens the Connect screen (Settings → change server or access code). */
export function showConnect() {
  disconnectListeners.forEach((fn) => fn(true));
}

/** Called when the server rejects the access code or can't be reached from the app. */
export function onDisconnected(fn: (voluntary: boolean) => void) {
  disconnectListeners.add(fn);
  return () => void disconnectListeners.delete(fn);
}

async function request<T>(path: string, method: string, body: unknown, token: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${server}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    if (isNative && !reached) disconnectListeners.forEach((fn) => fn(false));
    throw new ApiError(0, 'unreachable', 'Server not reachable');
  }
  reached = true;
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = data as ApiErrorBody | null;
    throw new ApiError(res.status, err?.code ?? 'server_error', err?.error ?? res.statusText, err?.params);
  }
  return data as T;
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  try {
    return await request<T>(path, method, body, adminPin || pin);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      // An outdated admin PIN falls back to normal access; a wrong group code asks for a new one.
      if (adminPin) {
        lockAdmin();
        return api<T>(path, method, body);
      }
      disconnectListeners.forEach((fn) => fn(false));
    }
    throw err;
  }
}
