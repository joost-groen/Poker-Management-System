import { useSyncExternalStore } from 'react';

// Hash routing keeps the app a static bundle that works from any host or a native webview.
export type Route =
  | { name: 'games' }
  | { name: 'new' }
  | { name: 'game'; id: number }
  | { name: 'settle'; id: number }
  | { name: 'ranking' }
  | { name: 'settings' }
  | { name: 'tv'; id: number | null }
  | { name: 'player'; id: number };

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const id = Number(parts[1]);
  switch (parts[0]) {
    case 'new':
      return { name: 'new' };
    case 'ranking':
      return { name: 'ranking' };
    case 'settings':
      return { name: 'settings' };
    case 'tv':
      return { name: 'tv', id: id || null };
    case 'game':
      if (id) return parts[2] === 'settle' ? { name: 'settle', id } : { name: 'game', id };
      break;
    case 'player':
      if (id) return { name: 'player', id };
  }
  return { name: 'games' };
}

const subscribe = (fn: () => void) => {
  window.addEventListener('hashchange', fn);
  return () => window.removeEventListener('hashchange', fn);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  return parse(hash);
}

export function go(path: string, replace = false) {
  if (replace) location.replace(`#${path}`);
  else location.hash = path;
}
