import { useState, type FormEvent } from 'react';
import type { Player, PlayerDetail } from '../../../shared/types.ts';
import { api, errorText, useAdmin } from '../api.ts';
import { Info } from '../components/Info.tsx';
import { Pencil } from '../components/Icons.tsx';
import { ErrorLine, Header, Loading, TabBar } from '../components/Layout.tsx';
import { eur, fullDay, signed, tone } from '../format.ts';
import { useT } from '../i18n.ts';
import { useApi } from '../useApi.ts';
import { Stat } from './Games.tsx';

export function PlayerPage({ id }: { id: number }) {
  const t = useT();
  const admin = useAdmin();
  const { data, setData, error, setError } = useApi<PlayerDetail>(`/players/${id}`);
  const [editing, setEditing] = useState<string | null>(null);

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const p = await api<Player>(`/players/${id}`, 'PATCH', { name: editing });
      setData((d) => d && { ...d, name: p.name });
      setEditing(null);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const s = data?.stats;

  return (
    <>
      <main className="page">
        {editing === null ? (
          <Header title={data?.name ?? t.player.fallbackTitle} back="/ranking">
            {data?.archived && <span className="badge muted-badge">{t.player.archived}</span>}
            {data && admin && (
              <button className="icon-btn" type="button" aria-label={t.player.rename} onClick={() => setEditing(data.name)}>
                <Pencil />
              </button>
            )}
          </Header>
        ) : (
          <form className="header" onSubmit={rename}>
            <input className="input grow" aria-label={t.player.name} maxLength={40} autoFocus value={editing}
              onChange={(e) => setEditing(e.target.value)} />
            <button className="pill-btn" type="submit">{t.common.save}</button>
            <button className="secondary small-btn" type="button" onClick={() => setEditing(null)}>{t.common.cancel}</button>
          </form>
        )}

        <ErrorLine error={error} />
        {!data && !error && <Loading />}

        {data && (
          <>
            <div className="card stats stats-2">
              <Stat label={t.player.net} value={s ? signed(s.net) : '–'} />
              <Stat label={t.common.games} value={String(s?.games ?? 0)} />
              <Stat label={t.player.average} value={s ? signed(s.avg) : '–'} />
              <Stat label={t.player.wins} value={String(s?.wins ?? 0)}
                info={<Info label={t.player.aboutWins}>{t.player.infoWins}</Info>} />
              <Stat label={t.player.best} value={s ? signed(s.best) : '–'} />
              <Stat label={t.player.worst} value={s ? signed(s.worst) : '–'} />
            </div>

            {data.games.length > 0 && (
              <section>
                <h2 className="label">{t.common.games}</h2>
                <ul className="list">
                  {data.games.map((g) => (
                    <li key={g.gameId}>
                      <a className="list-row" href={`#/game/${g.gameId}`}>
                        <span className="grow">
                          <span className="strong">{fullDay(g.startedAt)}</span>
                          <span className="muted small block">
                            {eur(g.buyIn)} · {t.common.buyins(g.buyins)}
                            {g.cashouts > 0 && ` · ${t.player.outs(g.cashouts)}`}
                          </span>
                        </span>
                        <span className={`num strong ${tone(g.result)}`}>{signed(g.result)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
      <TabBar active="ranking" />
    </>
  );
}
