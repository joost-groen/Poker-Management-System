// Offline shell for the home-screen app. The API is never cached: game data always comes live from the server.
const CACHE = 'poker-bank-v1';
const SHELL = ['/', '/manifest.webmanifest', '/apple-touch-icon.png', '/icon-192.png'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const SHELL_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function put(request, response) {
  const cache = await caches.open(CACHE);
  await cache.put(request, response);
}

// The page itself: network first so new deploys show up, the cached copy when the network is slow or gone.
async function shell(request) {
  const network = fetch(request).then((res) => {
    if (res.ok) put('/', res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, SHELL_TIMEOUT_MS));
  const first = await Promise.race([network.catch(() => null), timeout]);
  if (first) return first;
  return (await caches.match('/')) ?? network;
}

// Hashed assets, icons and fonts never change under the same URL: cache first.
async function asset(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (request.mode === 'navigate') return event.respondWith(shell(request));
  if (url.origin === self.location.origin && !url.pathname.startsWith('/api/')) return event.respondWith(asset(request));
  if (FONT_HOSTS.includes(url.hostname)) return event.respondWith(asset(request));
});
