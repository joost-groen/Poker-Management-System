import { useEffect, useState, type FormEvent } from 'react';
import type { Meta } from '../../shared/types.ts';
import { api, errorText, getPin, getServer, isNative, needsServer, onDisconnected, setPin, setServer } from './api.ts';
import { Info } from './components/Info.tsx';
import { ErrorLine } from './components/Layout.tsx';
import { useT } from './i18n.ts';
import { Game } from './pages/Game.tsx';
import { Games } from './pages/Games.tsx';
import { NewGame } from './pages/NewGame.tsx';
import { PlayerPage } from './pages/PlayerPage.tsx';
import { Ranking } from './pages/Ranking.tsx';
import { Settings } from './pages/Settings.tsx';
import { Settle } from './pages/Settle.tsx';
import { Tv } from './pages/Tv.tsx';
import { useRoute } from './router.ts';

export function App() {
  // 'required': no server or a rejected code; 'optional': opened from Settings, so it can be cancelled.
  const [connect, setConnect] = useState<'required' | 'optional' | null>(needsServer() ? 'required' : null);
  const route = useRoute();

  useEffect(() => onDisconnected((voluntary) => setConnect(voluntary ? 'optional' : 'required')), []);
  useEffect(() => {
    // Probe once: a server with an access code rejects us until one is entered.
    if (!needsServer()) api<Meta>('/meta').then((m) => m.auth && api('/players').catch(() => {})).catch(() => {});
  }, []);

  if (connect) return <Connect cancellable={connect === 'optional'} onDone={() => setConnect(null)} />;

  switch (route.name) {
    case 'new':
      return <NewGame />;
    case 'game':
      return <Game key={route.id} id={route.id} />;
    case 'settle':
      return <Settle key={route.id} id={route.id} />;
    case 'ranking':
      return <Ranking />;
    case 'settings':
      return <Settings />;
    case 'tv':
      return <Tv key={route.id ?? 'current'} id={route.id} />;
    case 'player':
      return <PlayerPage key={route.id} id={route.id} />;
    default:
      return <Games />;
  }
}

function Connect({ cancellable, onDone }: { cancellable: boolean; onDone: () => void }) {
  const t = useT();
  const [address, setAddress] = useState(getServer());
  const [code, setCode] = useState(getPin());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (isNative) setServer(address);
    setPin(code);
    try {
      const meta = await api<Meta>('/meta');
      if (meta.auth) await api('/players');
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <main className="page login">
      <h1>Poker Bank</h1>
      <form className="stack" onSubmit={submit}>
        {isNative && (
          <>
            <label className="label" htmlFor="server">
              {t.connect.server}
              <Info label={t.connect.aboutServer}>{t.connect.infoServer}</Info>
            </label>
            <input id="server" className="input" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off"
              placeholder="poker.example.com" value={address} onChange={(e) => setAddress(e.target.value)} />
          </>
        )}
        <label className="label" htmlFor="code">
          {t.connect.accessCode}
          <Info label={t.connect.aboutAccessCode}>{t.connect.infoAccessCode}</Info>
        </label>
        <input id="code" className="input" type="password" autoComplete="current-password"
          value={code} onChange={(e) => setCode(e.target.value)} />
        <ErrorLine error={error} />
        <button className="primary" type="submit" disabled={busy || (isNative && !address.trim())}>{t.connect.connect}</button>
        {cancellable && <button className="secondary" type="button" onClick={onDone}>{t.common.cancel}</button>}
      </form>
    </main>
  );
}
