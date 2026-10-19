import { useMemo, useState } from 'react';
import { AVATARS, type Account, type HistoryHand, type OnlinePlayerDetail } from '../../../../shared/online.ts';
import type { Leak } from '../../../../shared/poker/coach.ts';
import { Info } from '../../components/Info.tsx';
import { day, eur, signed, tone } from '../../format.ts';
import { go } from '../../router.ts';
import { oapi, onlineErrorText, setAccount, setSession } from '../api.ts';
import { readBotStats } from '../botStats.ts';
import { LeakList } from '../components/CoachPanel.tsx';
import { HistoryList } from '../components/HandReplay.tsx';
import { OError, OHeader, OLoading, OnlineNav, Sheet } from '../components/Nav.tsx';
import { Sparkline } from '../components/Sparkline.tsx';
import { amount, percent } from '../format.ts';
import { useOT } from '../i18n.ts';
import { useOnline } from '../useOnline.ts';
import { useRequireAccount } from './Auth.tsx';
import { BotHistory } from './Bots.tsx';

const toneClass = (n: number) => ({ pos: 'o-pos', neg: 'o-neg', '': '' })[tone(n)];

/** Your own profile (avatar, sign out, leaks) or another player's stats. */
export function Profile({ id }: { id?: number }) {
  const t = useOT();
  const account = useRequireAccount(id ? `/online/player/${id}` : '/online/me');
  const own = !id || id === account?.id;
  const accountId = id ?? account?.id;
  const { data, error } = useOnline<OnlinePlayerDetail>(account && accountId ? `/stats/${accountId}` : null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [leak, setLeak] = useState<Leak | null>(null);
  const [handsOf, setHandsOf] = useState<'online' | 'bots'>('online');
  const hands = useOnline<HistoryHand[]>(own && account ? '/me/hands' : null);
  const leaks = useMemo(() => readBotStats().leaks, []);
  const balances = useMemo(() => {
    let sum = 0;
    return [...(data?.tables ?? [])].reverse().map((x) => (sum += x.result));
  }, [data]);

  const pickAvatar = async (avatar: string) => {
    setBusy(true);
    try {
      setAccount(await oapi<Account>('/me', 'PATCH', { avatar }));
      setSaveError(null);
    } catch (err) {
      setSaveError(onlineErrorText(err));
    } finally {
      setBusy(false);
    }
  };
  const signOut = async () => {
    await oapi('/logout', 'POST').catch(() => {});
    setSession(null);
    go('/online');
  };

  const shown = own ? account : data?.account;
  const stats = data?.stats;

  return (
    <>
      <main className="o-page narrow">
        <OHeader title={shown?.username ?? t.profile.title} back={own ? undefined : '/online/leaderboard'}>
          {shown && <span className="o-avatar lg" aria-hidden="true">{shown.avatar}</span>}
        </OHeader>
        <OError error={error} />
        {!data && !error && <OLoading />}

        {data && (
          <section className="o-hero">
            <span className="o-label">{t.home.onlineNet}</span>
            <span className={`o-hero-value ${toneClass(stats?.net ?? 0)}`}>{stats ? signed(stats.net) : eur(0)}</span>
            {balances.length > 1 && <Sparkline values={balances} label={t.profile.chart} />}
          </section>
        )}

        {stats && (
          <div className="o-stats">
            <div className="o-stat"><span>{t.common.tables}</span><span>{stats.tables}</span></div>
            <div className="o-stat"><span>{t.common.hands}</span><span>{stats.hands}</span></div>
            <div className="o-stat"><span>{t.stats.vpip}<Info label={t.stats.aboutVpip}>{t.stats.infoVpip}</Info></span><span>{percent(stats.vpip)}</span></div>
            <div className="o-stat"><span>{t.stats.pfr}<Info label={t.stats.pfr}>{t.stats.infoPfr}</Info></span><span>{percent(stats.pfr)}</span></div>
            <div className="o-stat"><span>{t.stats.threeBet}<Info label={t.stats.threeBet}>{t.stats.infoThreeBet}</Info></span><span>{percent(stats.threeBet)}</span></div>
            <div className="o-stat"><span>{t.stats.wtsd}<Info label={t.stats.wtsd}>{t.stats.infoWtsd}</Info></span><span>{percent(stats.wtsd)}</span></div>
            <div className="o-stat"><span>{t.stats.wsd}<Info label={t.stats.wsd}>{t.stats.infoWsd}</Info></span><span>{percent(stats.wsd)}</span></div>
            <div className="o-stat"><span>{t.profile.wins}</span><span>{stats.wins}</span></div>
            <div className="o-stat"><span>{t.profile.best}</span><span className={toneClass(stats.best)}>{signed(stats.best)}</span></div>
            <div className="o-stat"><span>{t.home.week}</span><span className={toneClass(stats.week)}>{signed(stats.week)}</span></div>
          </div>
        )}

        {data && (
          <section className="o-section">
            <h2 className="o-label">{t.profile.history}</h2>
            {data.tables.length === 0 ? (
              <p className="o-note">{t.profile.noTables}</p>
            ) : (
              <ul className="o-list">
                {data.tables.map((x) => (
                  <li key={x.code}>
                    <a className="o-item" href={`#/online/t/${x.code}`}>
                      <span className="grow">
                        <span className="title">{x.name}</span>
                        <span className="o-muted o-small">{day(x.closedAt)}</span>
                      </span>
                      <span className={`o-num ${toneClass(x.result)}`}>{signed(x.result)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {own && account && (
          <>
            <section className="o-section">
              <h2 className="o-label">{t.history.title}</h2>
              <div className="o-seg">
                <button type="button" aria-pressed={handsOf === 'online'} onClick={() => setHandsOf('online')}>{t.history.tables}</button>
                <button type="button" aria-pressed={handsOf === 'bots'} onClick={() => setHandsOf('bots')}>{t.history.bots}</button>
              </div>
              {handsOf === 'bots' ? <BotHistory /> : !hands.data ? <OLoading /> : (
                <HistoryList
                  viewerId={String(account.id)}
                  empty={t.history.emptyOnline}
                  items={hands.data.map((h) => ({
                    key: h.id, record: h.record, title: h.tableName, at: h.at, maxSeats: h.maxSeats, avatars: h.avatars,
                    format: (n: number) => amount(h.mode, n),
                  }))}
                />
              )}
            </section>
            <section className="o-section">
              <h2 className="o-label">{t.profile.leaks}</h2>
              <div className="o-card"><LeakList leaks={leaks} onPick={setLeak} /></div>
            </section>
            {leak && (
              <Sheet title={t.coach.leaks[leak]} onClose={() => setLeak(null)}>
                <BotHistory leak={leak} />
              </Sheet>
            )}
            <section className="o-section">
              <h2 className="o-label">{t.profile.avatar}</h2>
              <div className="o-avatars" role="group" aria-label={t.profile.avatar}>
                {AVATARS.map((a) => (
                  <button key={a} type="button" disabled={busy} aria-pressed={account.avatar === a} onClick={() => pickAvatar(a)}>{a}</button>
                ))}
              </div>
              <OError error={saveError} />
            </section>
            <button type="button" className="o-btn ghost block" onClick={signOut}>{t.profile.signOut}</button>
          </>
        )}
      </main>
      <OnlineNav active={own ? 'profile' : 'leaderboard'} />
    </>
  );
}
