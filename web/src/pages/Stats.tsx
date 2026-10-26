import { useMemo } from 'react';
import type { StatsGame, StatsOverview, StatsRecord } from '../../../shared/types.ts';
import { BarChart, type Bar } from '../components/BarChart.tsx';
import { Info } from '../components/Info.tsx';
import { ErrorLine, Header, Loading, TabBar } from '../components/Layout.tsx';
import { PeriodSwitch } from '../components/PeriodSwitch.tsx';
import { RaceChart } from '../components/RaceChart.tsx';
import { day, eur, fullDay, month, signed, tone } from '../format.ts';
import { useT, type Dict } from '../i18n.ts';
import { periodQuery, usePeriod, type Period } from '../period.ts';
import { useApi } from '../useApi.ts';
import { Stat } from './Games.tsx';

/** All time: one bar per calendar month (empty months included, so the axis is honest). This month: per game. */
function volumeBars(games: StatsGame[], period: Period, t: Dict): Bar[] {
  if (period === 'month') {
    return games.map((g) => ({ key: String(g.gameId), label: day(g.startedAt), value: g.pot, detail: t.stats.playersN(g.players) }));
  }
  if (!games.length) return [];
  const key = (d: Date) => d.getFullYear() * 12 + d.getMonth();
  const first = key(new Date(games[0].startedAt));
  const months = Array.from({ length: key(new Date(games.at(-1)!.startedAt)) - first + 1 }, (_, i) => {
    const d = new Date(Math.floor((first + i) / 12), (first + i) % 12, 1);
    return { key: String(first + i), label: month(d), value: 0, games: 0 };
  });
  for (const g of games) {
    const m = months[key(new Date(g.startedAt)) - first];
    m.value += g.pot;
    m.games++;
  }
  return months.map(({ games: n, ...m }) => ({ ...m, detail: t.stats.gamesN(n) }));
}

function recordValue(r: StatsRecord, t: Dict): string {
  switch (r.kind) {
    case 'biggestWin':
    case 'biggestLoss':
      return signed(r.value);
    case 'biggestPot':
      return eur(r.value);
    case 'mostRebuys':
      return t.stats.rebuysN(r.value);
    case 'longestGame':
      return t.stats.duration(r.value);
    case 'mostWins':
      return String(r.value);
    case 'winStreak':
    case 'lossStreak':
      return t.stats.inARow(r.value);
  }
}

export function Stats() {
  const t = useT();
  const period = usePeriod();
  const { data, error } = useApi<StatsOverview>(`/stats${periodQuery(period)}`);
  const bars = useMemo(() => (data ? volumeBars(data.games, period, t) : []), [data, period, t]);
  const total = data?.games.length ?? 0;

  return (
    <>
      <main className="page">
        <Header title={t.stats.title} />
        <PeriodSwitch />

        <ErrorLine error={error} />
        {!data && !error && <Loading />}
        {data && total === 0 && <p className="muted center pad">{t.stats.empty}</p>}

        {data && total > 0 && (
          <>
            <div className="card stats stats-2">
              <Stat label={t.common.games} value={String(total)} />
              <Stat label={t.stats.volume} value={eur(data.volume)}
                info={<Info label={t.stats.aboutVolume}>{t.stats.infoVolume}</Info>} />
              <Stat label={t.stats.won} value={eur(data.won)}
                info={<Info label={t.stats.aboutWon}>{t.stats.infoWon}</Info>} />
              <Stat label={t.stats.avgPot} value={eur(data.avgPot)} />
              <Stat label={t.stats.avgPlayers} value={data.avgPlayers.toLocaleString(t.locale)} />
              <Stat label={t.stats.avgLength} value={data.avgMinutes === null ? '–' : t.stats.duration(data.avgMinutes)}
                info={<Info label={t.stats.aboutLength}>{t.stats.infoLength}</Info>} />
            </div>

            <div className="stats-grid">
              <section>
                <h2 className="label">{period === 'month' ? t.stats.perGame : t.stats.perMonth}</h2>
                <BarChart bars={bars} format={eur} label={period === 'month' ? t.stats.perGame : t.stats.perMonth} valueLabel={t.stats.volume} />
              </section>

              {data.race.length > 0 && (
                <section>
                  <h2 className="label">
                    {t.stats.race}
                    <Info label={t.stats.aboutRace}>{t.stats.infoRace}</Info>
                  </h2>
                  <RaceChart
                    key={period}
                    series={data.race.map((r) => ({ id: r.playerId, name: r.name, balance: r.balance }))}
                    dates={data.games.map((g) => g.startedAt)}
                    label={t.stats.race}
                    startLabel={t.stats.start}
                    gameLabel={t.player.gameN}
                  />
                </section>
              )}

              {data.attendance.length > 0 && (
                <section>
                  <h2 className="label">{t.stats.attendance}</h2>
                  <ul className="list">
                    {data.attendance.map((a) => (
                      <li key={a.playerId}>
                        <a className="list-row" href={`#/player/${a.playerId}`}>
                          <span className="grow min0">
                            <span className="strong block ellipsis">{a.name}</span>
                            <span className="meter" aria-hidden="true"><span style={{ width: `${(a.games / total) * 100}%` }} /></span>
                          </span>
                          <span className="num muted">{a.games}/{total}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {data.records.length > 0 && (
                <section>
                  <h2 className="label">{t.stats.records}</h2>
                  <ul className="list">
                    {data.records.map((r) => (
                      <li key={r.kind}>
                        <a className="list-row" href={r.gameId ? `#/game/${r.gameId}` : `#/player/${r.playerId}`}>
                          <span className="grow min0">
                            <span className="strong block">{t.stats.record[r.kind]}</span>
                            <span className="muted small block ellipsis">
                              {[r.name, r.startedAt && fullDay(r.startedAt)].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          <span className={`num strong ${r.kind === 'biggestWin' || r.kind === 'biggestLoss' ? tone(r.value) : ''}`}>
                            {recordValue(r, t)}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </>
        )}
      </main>
      <TabBar active="stats" />
    </>
  );
}
