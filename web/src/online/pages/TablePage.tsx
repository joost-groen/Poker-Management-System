import { useEffect, useState } from 'react';
import type { LiveTableView, TableDetail } from '../../../../shared/online.ts';
import type { Action } from '../../../../shared/poker/holdem.ts';
import { describe, evaluate } from '../../../../shared/poker/evaluate.ts';
import { Info } from '../../components/Info.tsx';
import { Arrow } from '../../components/Icons.tsx';
import { day } from '../../format.ts';
import { oapi, onlineErrorText } from '../api.ts';
import { ActionBar } from '../components/ActionBar.tsx';
import { OError, OHeader, OLoading, SoundToggle } from '../components/Nav.tsx';
import { PlayingCard } from '../components/PlayingCard.tsx';
import { dealDelay, TableFelt, type SeatInfo } from '../components/TableFelt.tsx';
import { amount, signedAmount } from '../format.ts';
import { handName, useOT } from '../i18n.ts';
import { soundsFor } from '../sound.ts';
import { useStagedHand } from '../stage.ts';
import { useOnline, useTableStream } from '../useOnline.ts';
import { useRequireAccount } from './Auth.tsx';
import { ModeBadge } from './Lobby.tsx';

/** Matches the server's action clock (ONLINE_ACTION_MS default). */
const ACTION_MS = 30_000;

export function TablePage({ code }: { code: string }) {
  const account = useRequireAccount(`/online/t/${code}`);
  const detail = useOnline<TableDetail>(account ? `/tables/${code}` : null);
  if (detail.error) {
    return (
      <main className="o-page bare narrow">
        <OHeader title={code} back="/online/tables" />
        <OError error={detail.error} />
      </main>
    );
  }
  if (!detail.data || !account) return <main className="o-page bare"><OLoading /></main>;
  if (detail.data.status === 'closed') return <TableResultView detail={detail.data} />;
  return <LiveTable code={code} onClosed={detail.reload} />;
}

function LiveTable({ code, onClosed }: { code: string; onClosed: () => void }) {
  const t = useOT();
  const { view, setView, connected, error: streamError, offset } = useTableStream(code);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [, tick] = useState(0);
  const meId = view && view.you !== null ? String(view.seats[view.you]?.account.id) : null;
  // Every update is replayed step by step, with sound; the buttons appear once the screen has caught up.
  const { shown: hand, settled } = useStagedHand(view?.hand ?? null, (prev, next) => soundsFor(prev, next, meId));

  useEffect(() => {
    if (view?.status === 'closed') onClosed();
  }, [view?.status, onClosed]);
  useEffect(() => {
    if (!view?.deadline) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [view?.deadline]);

  if (!view) return <main className="o-page bare"><OHeader title={code} back="/online/tables" /><OError error={streamError} /><OLoading /></main>;

  const fmt = (n: number) => amount(view.mode, n);
  const post = async (path: string, body: object = {}) => {
    setBusy(true);
    try {
      setView(await oapi<LiveTableView>(`/tables/${code}/${path}`, 'POST', body));
      setError(null);
    } catch (err) {
      setError(onlineErrorText(err));
    } finally {
      setBusy(false);
    }
  };
  const confirmPost = (text: string, path: string) => {
    if (window.confirm(text)) post(path);
  };

  const me = view.you !== null ? view.seats[view.you] : null;
  const host = view.hostId === me?.account.id;
  const running = Boolean(hand && !hand.result);
  const dealtIn = running && hand!.you !== null;
  const myCards = hand && hand.you !== null ? hand.players[hand.you].cards : null;
  const myFolded = hand && hand.you !== null ? hand.players[hand.you].folded : false;
  const myHand = myCards && hand!.board.length ? describe(evaluate([...myCards, ...hand!.board])) : null;
  const seated = view.seats.filter(Boolean).length;
  const acting = running && hand!.toAct !== null ? hand!.players[hand!.toAct!].seat : null;
  const clock = view.deadline && acting !== null ? { seat: acting, end: view.deadline - offset, total: ACTION_MS } : null;
  const secondsLeft = clock ? Math.max(0, Math.ceil((clock.end - Date.now()) / 1000)) : null;

  const seats: (SeatInfo | null)[] = view.seats.map((s) => s && {
    name: s.account.username,
    avatar: s.account.avatar,
    stack: s.stack,
    status: s.leaving ? t.table.leaving : s.sittingOut ? t.table.sittingOut : !s.connected ? t.table.away : null,
  });

  const share = async () => {
    const url = `${location.origin}${location.pathname}#/online/t/${view.code}`;
    const text = t.live.shareText(view.name, view.code);
    try {
      if (navigator.share) await navigator.share({ title: view.name, text, url });
      else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        setNote(t.live.copied);
      }
    } catch {
      /* cancelled */
    }
  };

  return (
    <main className="o-page bare">
      <OHeader title={view.name} back="/online/tables">
        <SoundToggle />
        <button type="button" className="o-btn ghost small" onClick={share}>{t.live.share}</button>
      </OHeader>
      <div className="o-row o-small" style={{ flexWrap: 'wrap', marginTop: -10 }}>
        <ModeBadge mode={view.mode} />
        <Info label={t.live.aboutMode}>{view.mode === 'cash' ? t.live.infoCash : t.live.infoFun}</Info>
        <span className="o-muted">{fmt(view.sb)}/{fmt(view.bb)} · {t.common.buyIn} {fmt(view.buyIn)}</span>
        <span className="o-badge o-num" aria-label={t.live.code}>{view.code}</span>
      </div>

      <div className="o-game">
        <TableFelt
          maxSeats={view.maxSeats}
          seats={seats}
          hand={hand}
          youSeat={view.you}
          format={fmt}
          clock={clock}
          onTakeSeat={view.you === null && !view.closing ? (seat) => post('join', { seat }) : undefined}
          idle={view.started ? t.table.waiting : t.live.startHint}
        />

        <div className="o-hand">
          {myCards && (
            <span className="o-cards">
              {[...myCards].sort((a, b) => b - a).map((c, i) => (
                <PlayingCard key={`${hand!.handNo}-${i}`} card={c} size="lg" dim={myFolded} delay={dealDelay(hand!, hand!.you!, i)} />
              ))}
            </span>
          )}
          {myHand && !myFolded && <span className="o-hand-name">{handName(t, myHand)}</span>}
        </div>

        <aside className="o-side">
          {!connected && <p className="o-note">{t.live.reconnecting}</p>}
          {view.closing && <p className="o-note">{t.live.closing}</p>}
          {note && <p className="o-note" role="status">{note}</p>}
          <OError error={error ?? streamError} />
          <section className="o-card">
            <ul className="o-list">
              {view.seats.filter((s) => s !== null).map((s) => (
                <li key={s.seat} className="o-item">
                  <span className="o-avatar">{s.account.avatar}</span>
                  <span className="grow">
                    <span className="title">{s.account.username}{s.account.id === view.hostId ? ` · ${t.live.host}` : ''}</span>
                    <span className="o-muted o-small">{t.live.boughtIn} {fmt(s.boughtIn)}</span>
                  </span>
                  <span className="o-num">{fmt(s.stack)}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <div className="o-actions">
          {hand?.legal && settled ? (
            <>
              <p className="o-wait" style={{ minHeight: 0 }}>{t.table.yourTurn}{secondsLeft !== null && ` · ${t.table.seconds(secondsLeft)}`}</p>
              <ActionBar view={hand} format={fmt} onAct={(a: Action) => post('action', a)} busy={busy} />
            </>
          ) : (
            <div className="o-toolbar">
              {view.you === null && !view.closing && (
                <button type="button" className="o-btn block" disabled={busy || seated >= view.maxSeats} onClick={() => post('join')}>{t.live.join(fmt(view.buyIn))}</button>
              )}
              {host && !view.started && (
                <button type="button" className="o-btn block" disabled={busy || seated < 2} onClick={() => post('start')}>{t.live.start}<Arrow /></button>
              )}
              {me && !dealtIn && me.stack < view.buyIn && (
                <button type="button" className="o-btn ghost" disabled={busy} onClick={() => post('rebuy')}>{t.live.rebuy(fmt(view.buyIn))}</button>
              )}
              {me && (
                <button type="button" className="o-btn ghost" disabled={busy} onClick={() => post('sit', { out: !me.sittingOut })}>{me.sittingOut ? t.live.sitIn : t.live.sitOut}</button>
              )}
              {me && !me.leaving && (
                <button type="button" className="o-btn ghost" disabled={busy} onClick={() => confirmPost(t.live.leaveConfirm, 'leave')}>{t.live.leave}</button>
              )}
              {host && !view.closing && (
                <button type="button" className="o-btn danger" disabled={busy} onClick={() => confirmPost(t.live.endConfirm, 'close')}>{t.live.end}</button>
              )}
              {running && dealtIn && <p className="o-wait" style={{ width: '100%' }}>…</p>}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function TableResultView({ detail }: { detail: TableDetail }) {
  const t = useOT();
  const r = detail.result!;
  const fmt = (n: number) => amount(detail.mode, n);
  return (
    <main className="o-page bare narrow">
      <OHeader title={detail.name} back="/online/tables" />
      <div className="o-row o-small" style={{ flexWrap: 'wrap', marginTop: -10 }}>
        <ModeBadge mode={detail.mode} />
        <span className="o-muted">{t.live.closedOn(day(detail.closedAt!))} · {t.live.handsPlayed(r.hands)}</span>
      </div>
      {detail.mode === 'fun' && <p className="o-note">{t.live.notCounted}</p>}

      <section className="o-section">
        <h2 className="o-label">{t.live.results}</h2>
        <div className="o-card">
          <ul className="o-list">
            {r.lines.map((l) => (
              <li key={l.accountId}>
                <a className="o-item" href={`#/online/player/${l.accountId}`}>
                  <span className="o-avatar">{l.avatar}</span>
                  <span className="grow">
                    <span className="title">{l.username}</span>
                    <span className="o-muted o-small">{t.live.boughtIn} {fmt(l.boughtIn)} · {t.live.cashedOut} {fmt(l.cashedOut)}</span>
                  </span>
                  <span className={`o-num ${l.result > 0 ? 'o-pos' : l.result < 0 ? 'o-neg' : ''}`}>{signedAmount(detail.mode, l.result)}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {detail.mode === 'cash' && (
        <section className="o-section">
          <h2 className="o-label">{t.live.transfers}</h2>
          <div className="o-card">
            {r.transfers.length === 0 ? (
              <p className="o-muted o-small">{t.live.nobodyOwes}</p>
            ) : (
              <ul className="o-list">
                {r.transfers.map((x, i) => (
                  <li key={i} className="o-item">
                    <span className="grow title">{x.fromName}</span>
                    <span className="o-muted"><Arrow /></span>
                    <span className="grow title">{x.toName}</span>
                    <span className="o-num">{fmt(x.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
