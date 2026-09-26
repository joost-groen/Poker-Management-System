import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Game, GameSummary, LogEvent, Ranking } from '../../../shared/types.ts';
import { Info } from '../components/Info.tsx';
import { Close, Expand } from '../components/Icons.tsx';
import { ErrorLine } from '../components/Layout.tsx';
import { StepChart, type Point } from '../components/StepChart.tsx';
import { eur, fullDay, signed, time, tone } from '../format.ts';
import { dict, useT } from '../i18n.ts';
import { useApi } from '../useApi.ts';

const POLL_MS = 4000;
const IDLE_MS = 3000;
const RECENT = 8;

/** Keeps the display on while TV mode is open (where the browser supports it). */
function useWakeLock() {
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } };
    if (!nav.wakeLock) return;
    let lock: { release: () => Promise<void> } | null = null;
    const request = () => {
      if (document.visibilityState === 'visible') nav.wakeLock!.request('screen').then((l) => (lock = l), () => {});
    };
    request();
    document.addEventListener('visibilitychange', request);
    return () => {
      document.removeEventListener('visibilitychange', request);
      lock?.release().catch(() => {});
    };
  }, []);
}

/** True after a few seconds without mouse movement: controls fade and the cursor hides. */
function useIdle() {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), IDLE_MS);
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), IDLE_MS);
    };
    window.addEventListener('pointermove', wake);
    window.addEventListener('keydown', wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);
  return idle;
}

function useNow(everyMs: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function duration(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`;
}

/** Replays a short highlight when `value` changes (not on first render), so changes catch the eye across a room. */
function Flash({ value, className, children }: { value: number; className: string; children: ReactNode }) {
  const prev = useRef(value);
  const [changes, setChanges] = useState(0);
  useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    setChanges((n) => n + 1);
  }, [value]);
  return <span key={changes} className={`${className} ${changes ? 'flash' : ''}`}>{children}</span>;
}

/** Chips on the table after every logged action, starting with the opening buy-ins. */
function series(log: LogEvent[], buyIn: number): Point[] {
  const points: Point[] = [];
  let v = 0;
  for (const e of log) {
    v += e.type === 'buyin' ? buyIn : -buyIn;
    const t = new Date(e.createdAt).getTime();
    if (points.length && points[points.length - 1].t === t) points[points.length - 1].v = v;
    else points.push({ t, v });
  }
  return points;
}

/** Full-screen view for a TV: the current game (or a chosen one), refreshing itself. */
export function Tv({ id }: { id: number | null }) {
  const t = useT();
  const idle = useIdle();
  const now = useNow(15000);
  useWakeLock();

  const games = useApi<GameSummary[]>(id ? null : '/games', POLL_MS * 3);
  // Without an id: the running game, else the most recent one.
  const gameId = id ?? games.data?.find((g) => g.status === 'live')?.id ?? games.data?.[0]?.id ?? null;
  const game = useApi<Game>(gameId ? `/games/${gameId}` : null, POLL_MS);
  const log = useApi<LogEvent[]>(gameId ? `/games/${gameId}/log` : null, POLL_MS);
  const ranking = useApi<Ranking>('/ranking', POLL_MS * 15);

  const g = game.data;
  const points = useMemo(() => (g && log.data ? series(log.data, g.buyIn) : []), [g, log.data]);

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const clock = new Date(now).toLocaleTimeString(dict().locale, { hour: '2-digit', minute: '2-digit' });
  const empty = games.data?.length === 0 && !id;

  return (
    <main className={`tv ${idle ? 'idle' : ''}`}>
      <header className="tv-head">
        <span className="tv-brand">Poker Bank</span>
        {g && (
          <>
            <span className={g.status === 'live' ? 'live-dot' : 'muted'}>{g.status === 'live' ? t.tv.live : t.tv.final}</span>
            <span>{fullDay(g.startedAt)}</span>
            <span className="tag num">{eur(g.buyIn)}</span>
            {g.status === 'live' && <span className="muted">{t.tv.playing(duration(now - new Date(g.startedAt).getTime()))}</span>}
          </>
        )}
        <span className="grow" />
        <span className="num tv-clock">{clock}</span>
        <div className="tv-controls">
          <Info label={t.tv.aboutTv}>{t.tv.infoTv}</Info>
          <button className="icon-btn" type="button" aria-label={t.tv.fullscreen} onClick={fullscreen}><Expand /></button>
          <a className="icon-btn" href={gameId ? `#/game/${gameId}` : '#/'} aria-label={t.tv.exit}><Close /></a>
        </div>
      </header>

      <ErrorLine error={games.error ?? game.error} />
      {empty && <p className="tv-empty muted">{t.tv.noGames}</p>}

      {g && (
        <div className="tv-body">
          <section className="tv-players">
            <div className="tv-row tv-row-head muted">
              <span className="grow">{t.common.player}</span>
              {g.status === 'live' ? (
                <span className="tv-num">{t.common.debt}</span>
              ) : (
                <>
                  <span className="tv-num">{t.game.stack}</span>
                  <span className="tv-num">{t.common.result}</span>
                </>
              )}
            </div>
            {(g.status === 'live' ? g.players : [...g.players].sort((a, b) => (b.result ?? 0) - (a.result ?? 0))).map((p) => (
              <div key={p.playerId} className="tv-row">
                <span className="grow min0">
                  <span className="tv-name">
                    {p.name}
                    {g.status === 'live' && p.debt === 0 && <span className="badge">{t.game.profit}</span>}
                  </span>
                  <span className="muted tv-meta">
                    {t.common.buyins(p.buyins)}
                    {p.cashouts > 0 && ` · ${t.game.out(eur(p.cashouts * g.buyIn))}`}
                  </span>
                </span>
                {g.status === 'live' ? (
                  <Flash value={p.debt} className="tv-num num tv-big">{eur(p.debt)}</Flash>
                ) : (
                  <>
                    <span className="tv-num num muted">{eur(p.finalStack ?? 0)}</span>
                    <span className={`tv-num num tv-big ${tone(p.result ?? 0)}`}>{signed(p.result ?? 0)}</span>
                  </>
                )}
              </div>
            ))}
          </section>

          <aside className="tv-side">
            <div className="tv-totals">
              <div>
                <span className="muted">{t.common.onTable}</span>
                <Flash value={g.totals.onTable} className="num tv-hero">{eur(g.totals.onTable)}</Flash>
              </div>
              <div className="tv-sub">
                <span><span className="muted">{t.game.boughtIn}</span> <span className="num">{eur(g.totals.in)}</span></span>
                <span><span className="muted">{t.game.cashedOut}</span> <span className="num">{eur(g.totals.out)}</span></span>
              </div>
            </div>

            {g.status === 'live' ? (
              <section className="tv-recent">
                <h2 className="label">{t.tv.recent}</h2>
                <ul className="plain tv-feed">
                  {(log.data ?? []).slice(-RECENT).reverse().map((e) => (
                    <li key={e.id}>
                      <span className="num muted">{time(e.createdAt)}</span>
                      <span className="grow">{e.name}</span>
                      <span className="num">{e.type === 'buyin' ? `+${eur(g.buyIn)}` : `−${eur(g.buyIn)}`}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <section className="tv-recent">
                <h2 className="label">{t.game.transfers}</h2>
                <ul className="plain tv-feed">
                  {g.transfers.map((tr, i) => (
                    <li key={i}>
                      <span className="grow">{tr.fromName} → {tr.toName}</span>
                      <span className="num">{eur(tr.amount)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

          </aside>

          <div className="tv-chart">
            <StepChart
              points={points}
              end={g.status === 'live' ? now : new Date(g.closedAt ?? g.startedAt).getTime()}
              format={eur}
              formatTime={(ms) => time(new Date(ms).toISOString())}
              label={t.tv.chart}
              tableLabel={t.tv.chartTable}
              timeLabel={t.tv.time}
              valueLabel={t.common.onTable}
            />
          </div>

          {ranking.data && ranking.data.rows.length > 0 && (
            <section className="tv-top">
              <h2 className="label">{t.tv.top}</h2>
              <ol className="plain tv-feed">
                {ranking.data.rows.slice(0, 5).map((r, i) => (
                  <li key={r.playerId}>
                    <span className="num muted">{i + 1}</span>
                    <span className="grow">{r.name}</span>
                    <span className={`num ${tone(r.net)}`}>{signed(r.net)}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
