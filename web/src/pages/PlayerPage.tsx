import { useMemo, useState, type FormEvent } from 'react';
import type { Player, PlayerDetail, PlayerGame } from '../../../shared/types.ts';
import { api, errorText, useAdmin } from '../api.ts';
import { BalanceChart } from '../components/BalanceChart.tsx';
import { BarChart, type Bar } from '../components/BarChart.tsx';
import { Info } from '../components/Info.tsx';
import { Pencil } from '../components/Icons.tsx';
import { ErrorLine, Header, Loading, TabBar } from '../components/Layout.tsx';
import { eur, fullDay, percent, signed, tone } from '../format.ts';
import { useT, type Dict } from '../i18n.ts';
import { avgPlace, avgRebuys, histogram, roi, streaks, volatility, winRate } from '../insights.ts';
import { useApi } from '../useApi.ts';
import { Stat } from './Games.tsx';

/** Results histogram as bars; the readout starts on the most common range. */
function resultBars(games: PlayerGame[], t: Dict): Bar[] {
  return histogram(games).map((b) => ({
    key: `${b.lo}`,
    label: b.lo === b.hi ? t.player.breakEven : t.player.range(signed(b.lo), signed(b.hi)),
    value: b.count,
    tone: b.hi <= 0 && b.lo < 0 ? 'neg' : b.lo >= 0 && b.hi > 0 ? 'pos' : '',
  }));
}

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
  const games = data?.games ?? [];
  const bars = useMemo(() => resultBars(games, t), [games, t]);
  const run = streaks(games);

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

            {games.length > 0 && (
              <div className="card stats stats-2">
                <Stat label={t.player.winRate} value={percent(winRate(games))}
                  info={<Info label={t.player.aboutWinRate}>{t.player.infoWinRate}</Info>} />
                <Stat label={t.player.roi} value={percent(roi(games), true)}
                  info={<Info label={t.player.aboutRoi}>{t.player.infoRoi}</Info>} />
                <Stat label={t.player.rebuys} value={avgRebuys(games).toLocaleString(t.locale, { maximumFractionDigits: 1 })} />
                <Stat label={t.player.avgPlace} value={avgPlace(games).toLocaleString(t.locale, { maximumFractionDigits: 1 })} />
                <Stat label={t.player.attendance} value={`${data.attendance.played}/${data.attendance.total}`}
                  info={<Info label={t.player.aboutAttendance}>{t.player.infoAttendance}</Info>} />
                <Stat label={t.player.swing} value={games.length > 1 ? `±${eur(volatility(games))}` : '–'}
                  info={<Info label={t.player.aboutSwing}>{t.player.infoSwing}</Info>} />
              </div>
            )}

            {games.length > 0 && (
              <section>
                <h2 className="label">{t.player.form}</h2>
                <div className="form">
                  {games.slice(0, 5).reverse().map((g) => (
                    <a key={g.gameId} className={`form-chip num ${tone(g.result)}`} href={`#/game/${g.gameId}`}
                      aria-label={`${fullDay(g.startedAt)} ${signed(g.result)}`}>
                      {signed(g.result)}
                    </a>
                  ))}
                </div>
              </section>
            )}

            {games.length > 0 && (
              <section>
                <h2 className="label">{t.player.streaks}</h2>
                <div className="card stats">
                  <Stat label={t.player.current} value={run.current > 0 ? `+${run.current}` : run.current < 0 ? `−${-run.current}` : '0'}
                    tone={run.current > 0 ? 'pos' : run.current < 0 ? 'neg' : ''}
                    info={<Info label={t.player.aboutCurrent}>{t.player.infoCurrent}</Info>} />
                  <Stat label={t.player.winStreak} value={String(run.wins)} />
                  <Stat label={t.player.lossStreak} value={String(run.losses)} />
                </div>
              </section>
            )}

            {data.games.length > 0 && (
              <section>
                <h2 className="label">
                  {t.player.balanceChart}
                  <Info label={t.player.aboutBalance}>{t.player.infoBalance}</Info>
                </h2>
                <BalanceChart games={data.games} />
              </section>
            )}

            {games.length > 1 && (
              <section>
                <h2 className="label">
                  {t.player.results}
                  <Info label={t.player.aboutResults}>{t.player.infoResults}</Info>
                </h2>
                <BarChart bars={bars} format={String} label={t.player.results} valueLabel={t.common.games}
                  initial={bars.reduce((best, b, i) => (b.value > bars[best].value ? i : best), 0)} />
              </section>
            )}

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
                            {` · ${t.player.placeOf(g.place, g.field)}`}
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
