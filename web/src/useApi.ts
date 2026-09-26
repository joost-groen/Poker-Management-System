import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from './api.ts';

/** GET a resource; `pollMs` keeps shared screens (a live game on several phones) in sync. A null path waits. */
export function useApi<T>(path: string | null, pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (path === null) return;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [path]);

  useEffect(() => {
    setData(null);
    reload();
    if (!pollMs) return;
    const tick = () => document.visibilityState === 'visible' && reload();
    const t = setInterval(tick, pollMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [reload, pollMs]);

  return { data, setData, error, setError, reload };
}
