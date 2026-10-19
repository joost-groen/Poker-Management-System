import { useState } from 'react';
import type { OnlineRankingRow } from '../../../../shared/online.ts';
import { Info } from '../../components/Info.tsx';
import { signed, tone } from '../../format.ts';
import { OError, OHeader, OLoading, OnlineNav } from '../components/Nav.tsx';
import { percent } from '../format.ts';
import { useOT } from '../i18n.ts';
import { useOnline } from '../useOnline.ts';
import { useRequireAccount } from './Auth.tsx';

export function Leaderboard() {
  const t = useOT();
  const account = useRequireAccount('/online/leaderboard');
  const { data, error } = useOnline<OnlineRankingRow[]>(account ? '/stats' : null);
  const [week, setWeek] = useState(false);
  const rows = (data ?? []).filter((r) => !week || r.week !== 0).sort((a, b) => (week ? b.week - a.week : b.net - a.net));

  return (
    <>
      <main className="o-page narrow">
        <OHeader title={t.stats.title}>
          <Info label={t.stats.aboutVpip}>{t.stats.onlyCash} {t.stats.infoVpip}</Info>
        </OHeader>
        <div className="o-seg">
          <button type="button" aria-pressed={!week} onClick={() => setWeek(false)}>{t.stats.allTime}</button>
          <button type="button" aria-pressed={week} onClick={() => setWeek(true)}>{t.stats.week}</button>
        </div>
        <OError error={error} />
        {!data && !error && <OLoading />}
        {data && rows.length === 0 && <p className="o-note">{t.stats.empty}</p>}
        {rows.length > 0 && (
          <ol className="o-list">
            {rows.map((r, i) => {
              const value = week ? r.week : r.net;
              return (
                <li key={r.accountId}>
                  <a className="o-item" href={`#/online/player/${r.accountId}`}>
                    <span className="o-muted o-num" style={{ width: 18 }}>{i + 1}</span>
                    <span className="o-avatar">{r.avatar}</span>
                    <span className="grow">
                      <span className="title">{r.username}{r.accountId === account?.id ? ` · ${t.common.you}` : ''}</span>
                      <span className="o-muted o-small">{r.tables} {t.common.tables} · {r.hands} {t.common.hands} · {t.stats.vpip} {percent(r.vpip)} · {t.stats.pfr} {percent(r.pfr)}</span>
                    </span>
                    <span className={`o-num ${{ pos: 'o-pos', neg: 'o-neg', '': '' }[tone(value)]}`}>{signed(value)}</span>
                  </a>
                </li>
              );
            })}
          </ol>
        )}
      </main>
      <OnlineNav active="leaderboard" />
    </>
  );
}
