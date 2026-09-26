import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ApiErrorBody, Meta } from '../../shared/types.ts';
import { ADMIN_PIN, GROUP_PIN, authenticate } from './auth.ts';
import { scheduleBackups } from './backup.ts';
import { HttpError } from './http.ts';
import { api } from './routes.ts';

const PORT = Number(process.env.PORT ?? 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';
const WEB_DIR = fileURLToPath(new URL('../../dist', import.meta.url));

// Native apps (Capacitor etc.) call the API from another origin; auth is a bearer token, not cookies.
const cors: RequestHandler = (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return void res.status(204).end();
  next();
};

const errors: ErrorRequestHandler = (err, _req, res, _next) => {
  const send = (status: number, body: ApiErrorBody) => void res.status(status).json(body);
  if (err instanceof HttpError) return send(err.status, { error: err.message, code: err.code, params: err.params });
  if (err?.type === 'entity.parse.failed') return send(400, { error: 'Invalid JSON', code: 'invalid_json' });
  console.error(err);
  send(500, { error: 'Server error', code: 'server_error' });
};

const app = express();
app.disable('x-powered-by');
// Behind Caddy (Docker network) the client IP comes from X-Forwarded-For; needed for the PIN rate limit.
app.set('trust proxy', 'loopback, uniquelocal');
app.use(express.json({ limit: '64kb' }));
app.use('/api', cors, authenticate);
app.get('/api/meta', (_req, res) => void res.json({ auth: Boolean(GROUP_PIN), admin: Boolean(ADMIN_PIN) } satisfies Meta));
app.use('/api', api);
app.use('/api', (_req, res) => void res.status(404).json({ error: 'Not found', code: 'not_found' } satisfies ApiErrorBody));
if (existsSync(WEB_DIR)) {
  app.use(express.static(WEB_DIR, {
    setHeaders: (res, path) => {
      // Hashed assets can be cached forever; the shell must revalidate so deploys show up.
      res.setHeader('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  }));
}
app.use(errors);

app.listen(PORT, () => console.log(`Poker Bank on http://localhost:${PORT}`));
scheduleBackups();
