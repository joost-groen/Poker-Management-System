import { useState } from 'react';
import type { Ranking as RankingT } from '../../../shared/types.ts';
import { Info } from '../components/Info.tsx';
import { ErrorLine, Header, Loading, TabBar } from '../components/Layout.tsx';
import { signed, tone } from '../format.ts';
import { useT } from '../i18n.ts';
import { useApi } from '../useApi.ts';

export function Ranking() {
  const t = useT();
  const [year, setYear] = useState('');
  const { data, error } = useApi<RankingT>(`/ranking${year ? `?year=${year}` : ''}`);
  const years = data?.years ?? [];

  return (
    <>
      <main className="page">
        <Header title={t.ranking.title} />

        {(years.length > 0 || year) && (
          <div className="segmented" role="group" aria-label={t.ranking.period}>
            {['', ...years.slice(0, 3)].map((y) => (
              <button key={y || 'all'} type="button" aria-pressed={year === y} onClick={() => setYear(y)}>
                {y || t.ranking.allTime}
              </button>
            ))}
          </div>
        )}

        <ErrorLine error={error} />
        {!data && !error && <Loading />}
        {data && data.rows.length === 0 && <p className="muted center pad">{t.ranking.empty}</p>}

        {data && data.rows.length > 0 && (
          <section>
            <div className="table-head">
              <span className="col-rank">#</span>
              <span className="grow">{t.common.player}</span>
              <span className="col-xs">{t.common.games}</span>
              <span className="col-xs desktop-cell">{t.player.wins}</span>
              <span className="col-md desktop-cell">{t.player.best}</span>
              <span className="col-md desktop-cell">{t.player.worst}</span>
              <span className="col-sm">
                {t.ranking.avg}
                <Info label={t.ranking.aboutAvg}>{t.ranking.infoAvg}</Info>
              </span>
              <span className="col-md">
                {t.ranking.net}
                <Info label={t.ranking.aboutNet}>{t.ranking.infoNet}</Info>
              </span>
            </div>
            <ol className="list">
              {data.rows.map((r, i) => (
                <li key={r.playerId}>
                  <a className="rank-row" href={`#/player/${r.playerId}`}>
                    <span className="col-rank num muted">{i + 1}</span>
                    <span className="grow strong ellipsis">{r.name}</span>
                    <span className="col-xs num muted">{r.games}</span>
                    <span className="col-xs num muted desktop-cell">{r.wins}</span>
                    <span className="col-md num muted desktop-cell">{signed(r.best)}</span>
                    <span className="col-md num muted desktop-cell">{signed(r.worst)}</span>
                    <span className="col-sm num muted">{signed(r.avg)}</span>
                    <span className={`col-md num strong ${tone(r.net)}`}>{signed(r.net)}</span>
                  </a>
                </li>
              ))}
            </ol>
          </section>
        )}
      </main>
      <TabBar active="ranking" />
    </>
  );
}
