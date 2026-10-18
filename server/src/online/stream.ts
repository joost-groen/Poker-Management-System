import type { RequestHandler } from 'express';
import { subscribe } from './tables.ts';

const HEARTBEAT_MS = 15_000;

/**
 * Server-Sent Events: every change of the table is pushed as that viewer's own view (their cards only).
 * Clients read it with fetch, because EventSource can't send the session header.
 */
export const tableStream: RequestHandler = (req, res) => {
  const account = req.account!;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    // no-transform and identity keep proxies (Traefik's compress middleware) from buffering the stream.
    'Cache-Control': 'no-cache, no-transform',
    'Content-Encoding': 'identity',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  const unsubscribe = subscribe(String(req.params.code), account.id, (view) => {
    res.write(`data: ${JSON.stringify(view)}\n\n`);
  });
  const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(beat);
    unsubscribe();
  });
};
