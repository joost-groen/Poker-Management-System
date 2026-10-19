import { useCallback, useEffect, useState } from 'react';
import type { ChatMessage, LiveTableView } from '../../../shared/online.ts';
import { followTable, oapi, onlineErrorText } from './api.ts';

/** GET from the online API. A null path waits. */
export function useOnline<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (path === null) return;
    try {
      setData(await oapi<T>(path));
      setError(null);
    } catch (e) {
      setError(onlineErrorText(e));
    }
  }, [path]);

  useEffect(() => {
    setData(null);
    reload();
  }, [reload]);

  return { data, setData, error, setError, reload };
}

/** The live view of a table; `setView` takes the view returned by an action right away. */
export function useTableStream(code: string | null) {
  const [view, setView] = useState<LiveTableView | null>(null);
  const [connected, setConnected] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Server time minus device time, for the action clock.
  const [offset, setOffset] = useState(0);
  const [chat, setChat] = useState<ChatMessage[]>([]);

  useEffect(() => {
    if (!code) return;
    setChat([]);
    return followTable(
      code,
      (v) => {
        setView(v);
        setOffset(v.serverTime - Date.now());
      },
      setConnected,
      (e) => setError(onlineErrorText(e)),
      // A reconnect sends the recent messages again; ids keep them unique.
      (m) => setChat((list) => (list.some((x) => x.id === m.id) ? list : [...list, m].slice(-60))),
    );
  }, [code]);

  return { view, setView, connected, error, offset, chat };
}
