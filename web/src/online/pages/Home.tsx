import { useMemo } from 'react';
import type { OnlinePlayerDetail, OnlineRankingRow, TableSummary } from '../../../../shared/online.ts';
import { BOT_LEVELS } from '../../../../shared/poker/bots.ts';
import { Info } from '../../components/Info.tsx';
import { Back } from '../../components/Icons.tsx';
import { eur, signed, tone } from '../../format.ts';
import { useAccount } from '../api.ts';
import { readBotStats } from '../botStats.ts';
import { OnlineNav } from '../components/Nav.tsx';
import { Sparkline } from '../components/Sparkline.tsx';
import { amount, signedBb } from '../format.ts';
import { useOT } from '../i18n.ts';
import { useOnline } from '../useOnline.ts';
import { loginPath } from './Auth.tsx';

const toneClass = (n: number) => ({ pos: 'o-pos', neg: 'o-neg', '': '' })[tone(n)];

export function Home() {
  const t = useOT();
  const account = useAccount();
  const me = useOnline<OnlinePlayerDetail>(account ? `/stats/${account.id}` : null);
  const ranking = useOnline<OnlineRankingRow[]>(account ? '/stats' : null);
  const tables = useOnline<TableSummary[]>(account ? '/tables' : null);
  const bots = useMemo(readBotStats, []);

  const net = me.data?.stats?.net ?? 0;
  const balances = useMemo(() => {
    let sum = 0;
    return [...(me.data?.tables ?? [])].reverse().map((x) => (sum += x.result));
  }, [me.data]);
  const week = (ranking.data ?? []).filter((r) => r.week !== 0).sort((a, b) => b.week - a.week).slice(0, 5);
  const mine = (tables.data ?? []).filter((x) => x.status === 'open' && x.mine);

  return (
    <>
      <main className="o-page">
        <header className="o-head">
          <a className="icon-btn" href="#/" aria-label={t.nav.backToBank}><Back /></a>
          <h1>{t.home.title}</h1>
          {account && <a className="o-avatar" href="#/online/me" aria-label={t.nav.profile}>{account.avatar}</a>}
        </header>

        <div className="o-home">
          <section className="o-hero wide">
            {account ? (
              <>
                <span className="o-label">
                  {t.home.onlineNet}
                  <Info label={t.home.onlineNet}>{t.home.infoNet}</Info>
                </span>
                <span className={`o-hero-value ${toneClass(net)}`}>{net === 0 ? eur(0) : signed(net)}</span>
                {balances.length > 1 && <Sparkline values={balances} label={t.profile.chart} />}
              </>
            ) : (
              <span className="o-hero-value" style={{ fontSize: 'clamp(36px, 10vw, 56px)' }}>{t.home.tagline}</span>
            )}
          </section>

          <nav className="o-modes wide" aria-label={t.nav.sections}>
            <a className="o-mode mint" href="#/online/practice">
              <span className="o-emoji" aria-hidden="true">🃏</span>
              <strong>{t.home.practice}</strong>
              <span>{t.home.practiceSub}</span>
            </a>
            <a className="o-mode lilac" href="#/online/learn">
              <span className="o-emoji" aria-hidden="true">🎓</span>
              <strong>{t.home.learn}</strong>
              <span>{t.home.learnSub}</span>
            </a>
            <a className="o-mode peach" href={account ? '#/online/tables' : `#${loginPath('/online/tables')}`}>
              <span className="o-emoji" aria-hidden="true">🥂</span>
              <strong>{t.home.friends}</strong>
              <span>{account ? t.home.friendsSub : t.home.signInForFriends}</span>
            </a>
          </nav>

          {mine.length > 0 && (
            <section className="o-section wide">
              <h2 className="o-label">{t.home.yourTables}</h2>
              {mine.map((x) => (
                <a key={x.code} className="o-card link" href={`#/online/t/${x.code}`}>
                  <span className="o-row o-between">
                    <strong>{x.name}</strong>
                    <span className="o-badge live">{t.lobby.seated(x.seated, x.maxSeats)}</span>
                  </span>
                  <span className="o-muted o-small">{t.home.backToTable} · {amount(x.mode, x.sb)}/{amount(x.mode, x.bb)}</span>
                </a>
              ))}
            </section>
          )}

          {account && (
            <section className="o-section">
              <h2 className="o-label">{t.home.week}</h2>
              <div className="o-card">
                {week.length === 0 ? (
                  <p className="o-muted o-small">{t.home.noWeek}</p>
                ) : (
                  <ol className="o-list">
                    {week.map((r, i) => (
                      <li key={r.accountId}>
                        <a className="o-item" href={`#/online/player/${r.accountId}`}>
                          <span className="o-muted o-num" style={{ width: 16 }}>{i + 1}</span>
                          <span className="o-avatar">{r.avatar}</span>
                          <span className="grow title">{r.username}</span>
                          <span className={`o-num ${toneClass(r.week)}`}>{signed(r.week)}</span>
                        </a>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </section>
          )}

          <section className="o-section">
            <h2 className="o-label">{t.home.botRecord}</h2>
            <div className="o-card">
              <ul className="o-list">
                {BOT_LEVELS.map((l) => {
                  const r = bots.levels[l];
                  return (
                    <li key={l} className="o-item">
                      <span className="grow title">{t.bots.levels[l]}</span>
                      <span className={`o-num ${r ? toneClass(r.netBb) : 'o-muted'}`}>
                        {r ? t.bots.record(r.hands, signedBb(r.netBb)) : t.bots.noRecord}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        </div>
      </main>
      <OnlineNav active="home" />
    </>
  );
}
