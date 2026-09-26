import { useEffect, useState, type FormEvent } from 'react';
import type { Game, Player } from '../../../shared/types.ts';
import { api, errorText } from '../api.ts';
import { Info } from '../components/Info.tsx';
import { Plus } from '../components/Icons.tsx';
import { ErrorLine, Header, Loading } from '../components/Layout.tsx';
import { eur, parseEur } from '../format.ts';
import { useT } from '../i18n.ts';
import { go } from '../router.ts';
import { useApi } from '../useApi.ts';

const PRESETS = [500, 1000, 2000, 5000];
const LAST_KEY = 'poker-bank-last-setup';

function loadLast(): { buyIn: number; players: number[] } {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? '') ?? { buyIn: 2000, players: [] };
  } catch {
    return { buyIn: 2000, players: [] };
  }
}

export function NewGame() {
  const t = useT();
  const last = loadLast();
  const players = useApi<Player[]>('/players');
  const [buyIn, setBuyIn] = useState(last.buyIn);
  const [custom, setCustom] = useState(PRESETS.includes(last.buyIn) ? '' : String(last.buyIn / 100));
  const [selected, setSelected] = useState<Set<number>>(new Set(last.players));
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Drop remembered players that no longer exist.
  useEffect(() => {
    if (players.data) setSelected((s) => new Set(players.data!.map((p) => p.id).filter((id) => s.has(id))));
  }, [players.data]);

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addPlayer = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const p = await api<Player>('/players', 'POST', { name: newName });
      players.setData([...(players.data ?? []), p].sort((a, b) => a.name.localeCompare(b.name)));
      setSelected((s) => new Set(s).add(p.id));
      setNewName('');
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const onCustom = (v: string) => {
    setCustom(v);
    const cents = parseEur(v);
    if (cents) setBuyIn(cents);
  };

  const start = async () => {
    setBusy(true);
    try {
      const ids = [...selected];
      const g = await api<Game>('/games', 'POST', { buyIn, playerIds: ids });
      try {
        localStorage.setItem(LAST_KEY, JSON.stringify({ buyIn, players: ids }));
      } catch {
        /* convenience only */
      }
      go(`/game/${g.id}`, true);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const customValid = custom === '' || (parseEur(custom) ?? 0) > 0;

  return (
    <main className="page with-footer">
      <Header title={t.newGame.title} back="/" />

      <section className="stack">
        <h2 className="label">
          {t.common.buyIn}
          <Info label={t.newGame.infoBuyInLabel}>{t.newGame.infoBuyIn}</Info>
        </h2>
        <div className="presets">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className="choice num"
              aria-pressed={buyIn === p && custom === ''}
              onClick={() => {
                setBuyIn(p);
                setCustom('');
              }}
            >
              {eur(p)}
            </button>
          ))}
        </div>
        <input
          className={`input num ${customValid ? '' : 'invalid'}`}
          inputMode="decimal"
          placeholder={t.newGame.otherAmount}
          aria-label={t.newGame.otherAmountLabel}
          value={custom}
          onChange={(e) => onCustom(e.target.value)}
        />
      </section>

      <section className="stack">
        <div className="row between">
          <h2 className="label">{t.common.players}</h2>
          <span className="muted small">{t.newGame.selected(selected.size)}</span>
        </div>
        {!players.data && <Loading />}
        <ul className="list columns">
          {players.data?.map((p) => (
            <li key={p.id}>
              <label className="check-row">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                <span>{p.name}</span>
              </label>
            </li>
          ))}
        </ul>
        <form className="row gap" onSubmit={addPlayer}>
          <input
            className="input grow"
            placeholder={t.newGame.addPlayer}
            aria-label={t.newGame.newPlayerName}
            maxLength={40}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="square-btn" type="submit" aria-label={t.newGame.addPlayer} disabled={!newName.trim()}>
            <Plus />
          </button>
        </form>
      </section>

      <ErrorLine error={error ?? players.error} />

      <footer className="footer">
        <button className="primary grow" type="button" disabled={busy || selected.size < 2 || !customValid} onClick={start}>
          {t.newGame.start(selected.size, eur(buyIn))}
        </button>
      </footer>
    </main>
  );
}
