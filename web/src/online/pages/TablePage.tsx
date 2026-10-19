import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryHand, LiveTableView, TableDetail } from '../../../../shared/online.ts';
import { BOT_LEVELS, BOT_STYLE, type BotLevel } from '../../../../shared/poker/bots.ts';
import type { Action } from '../../../../shared/poker/holdem.ts';
import { describe, evaluate } from '../../../../shared/poker/evaluate.ts';
import { Info } from '../../components/Info.tsx';
import { Arrow } from '../../components/Icons.tsx';
import { day } from '../../format.ts';
import { oapi, onlineErrorText, useAccount } from '../api.ts';
import { useTurnAlert, useWakeLock } from '../alerts.ts';
import { ActionBar, PreActions, usePreAction } from '../components/ActionBar.tsx';
import { ChatPanel, type ChatSend } from '../components/Chat.tsx';
import { HistoryList } from '../components/HandReplay.tsx';
import { ConfirmSheet, OError, OHeader, OLoading, Sheet, SoundToggle } from '../components/Nav.tsx';
import { PlayingCard } from '../components/PlayingCard.tsx';
import { dealDelay, TableFelt, type SeatInfo } from '../components/TableFelt.tsx';
import { amount, signedAmount } from '../format.ts';
import { handName, useOT } from '../i18n.ts';
import { usePrefs } from '../prefs.ts';
import { isMuted, play, soundsFor } from '../sound.ts';
import { useStagedHand } from '../stage.ts';
import { useOnline, useTableStream } from '../useOnline.ts';
import { useRequireAccount } from './Auth.tsx';
import { ModeBadge } from './Lobby.tsx';

/** Matches the server's action clock (ONLINE_ACTION_MS default). */
const ACTION_MS = 30_000;
/** How long a chat message shows as a bubble over the sender's seat. */
const BUBBLE_MS = 4_500;

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
  const account = useAccount();
  const prefs = usePrefs();
  const { view, setView, connected, error: streamError, offset, chat } = useTableStream(code);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [panel, setPanel] = useState<'chat' | 'history' | 'bots' | null>(null);
  const [confirming, setConfirming] = useState<{ text: string; confirm: string; path: string; body?: object } | null>(null);
  const [readUpTo, setReadUpTo] = useState(0);
  const meId = view && view.you !== null ? String(view.seats[view.you]?.account.id) : null;
  // Every update is replayed step by step, with sound; the buttons appear once the screen has caught up.
  const { shown: hand, settled } = useStagedHand(view?.hand ?? null, (prev, next) => soundsFor(prev, next, meId));

  useEffect(() => {
    if (view?.status === 'closed') onClosed();
  }, [view?.status, onClosed]);

  const post = useCallback(async (path: string, body: object = {}) => {
    setBusy(true);
    try {
      setView(await oapi<LiveTableView>(`/tables/${code}/${path}`, 'POST', body));
      setError(null);
    } catch (err) {
      setError(onlineErrorText(err));
    } finally {
      setBusy(false);
    }
  }, [code, setView]);
  const act = useCallback((a: Action) => post('action', a), [post]);
  const pre = usePreAction(hand, settled, act);
  const yourTurn = Boolean(hand?.legal && settled);
  useTurnAlert(yourTurn, t.table.yourTurn);
  useWakeLock(Boolean(view?.you !== null && view?.started));

  // New messages: a soft ping, voice messages play by themselves (unless muted), bubbles over the seats.
  const seen = useRef(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const fresh = chat.filter((m) => m.id > seen.current);
    if (!fresh.length) return;
    const first = seen.current === 0;
    seen.current = chat[chat.length - 1].id;
    if (first) return setReadUpTo(seen.current);
    for (const m of fresh) {
      if (String(m.accountId) === meId) continue;
      if (m.kind === 'voice' && m.audio && prefs.autoplayVoice && !isMuted()) void new Audio(m.audio).play().catch(() => {});
      else play('message');
    }
    setNow(Date.now());
  }, [chat, meId, prefs.autoplayVoice]);
  useEffect(() => {
    if (panel === 'chat') setReadUpTo(chat.at(-1)?.id ?? 0);
  }, [panel, chat]);
  const bubbles = chat
    .filter((m) => m.seat !== null && m.at - offset > now - BUBBLE_MS)
    .map((m) => ({ key: m.id, seat: m.seat!, text: m.kind === 'voice' ? `🎤 ${Math.round((m.ms ?? 0) / 1000)} s` : m.text ?? '', emoji: m.kind === 'reaction' }));
  useEffect(() => {
    if (!bubbles.length) return;
    const timer = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [bubbles.length, now]);
  const unread = chat.filter((m) => m.id > readUpTo && String(m.accountId) !== meId).length;

  const history = useOnline<HistoryHand[]>(panel === 'history' ? `/tables/${code}/hands` : null);

  if (!view) return <main className="o-page bare"><OHeader title={code} back="/online/tables" /><OError error={streamError} /><OLoading /></main>;

  const fmt = (n: number) => amount(view.mode, n);
  const sendChat: ChatSend = async (body) => {
    await oapi(`/tables/${code}/chat`, 'POST', body).catch((err) => {
      throw new Error(onlineErrorText(err));
    });
  };

  const me = view.you !== null ? view.seats[view.you] : null;
  // Admins can run any table like its host, and stand players up.
  const host = view.hostId === me?.account.id || Boolean(account?.admin);
  const running = Boolean(hand && !hand.result);
  const dealtIn = running && hand!.you !== null;
  const myCards = hand && hand.you !== null ? hand.players[hand.you].cards : null;
  const myFolded = hand && hand.you !== null ? hand.players[hand.you].folded : false;
  const myHand = myCards && hand!.board.length ? describe(evaluate([...myCards, ...hand!.board])) : null;
  const seated = view.seats.filter(Boolean).length;
  const acting = running && hand!.toAct !== null ? hand!.players[hand!.toAct!].seat : null;
  const clock = view.deadline && acting !== null ? { seat: acting, end: view.deadline - offset, total: ACTION_MS } : null;
  const actorName = acting !== null && acting !== view.you ? view.seats[acting]?.account.username : null;

  const seats: (SeatInfo | null)[] = view.seats.map((s) => s && {
    name: s.account.username,
    avatar: s.account.avatar,
    stack: s.stack,
    status: s.leaving ? t.table.leaving : s.sittingOut ? t.table.sittingOut : !s.connected ? t.table.away : null,
  });
  const avatars = Object.fromEntries(view.seats.flatMap((s) => (s ? [[String(s.account.id), s.account.avatar]] : [])));

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

  const chatPanel = <ChatPanel messages={chat} meId={me?.account.id ?? null} onSend={sendChat} />;

  return (
    <main className="o-page bare">
      <OHeader title={view.name} back="/online/tables">
        <SoundToggle />
        <button type="button" className="icon-btn" aria-label={t.history.title} title={t.history.title} onClick={() => setPanel('history')}>
          <HistoryIcon />
        </button>
        <button type="button" className="icon-btn o-chat-toggle" aria-label={t.chat.title} title={t.chat.title} onClick={() => setPanel('chat')}>
          <ChatIcon />
          {unread > 0 && <span className="o-dot-count">{unread > 9 ? '9+' : unread}</span>}
        </button>
        <button type="button" className="icon-btn" aria-label={t.live.share} title={t.live.share} onClick={share}>
          <ShareIcon />
        </button>
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
          bubbles={bubbles}
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
                  {s.account.bot && host ? (
                    <button type="button" className="icon-btn" disabled={busy} aria-label={t.live.removeBot(s.account.username)} title={t.live.removeBot(s.account.username)}
                      onClick={() => post('bots/remove', { accountId: s.account.id })}>
                      ✕
                    </button>
                  ) : account?.admin && s.account.id !== account.id && (
                    <button type="button" className="icon-btn" aria-label={t.admin.kick(s.account.username)} title={t.admin.kick(s.account.username)}
                      onClick={() => setConfirming({ text: t.admin.kickConfirm(s.account.username), confirm: t.admin.kick(s.account.username), path: 'kick', body: { accountId: s.account.id } })}>
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <div className="o-chat-inline">{chatPanel}</div>
        </aside>

        <div className="o-actions">
          {yourTurn ? (
            <>
              <p className="o-wait" style={{ minHeight: 0 }}>{t.table.yourTurn}{clock && <TurnTimer end={clock.end} />}</p>
              <ActionBar view={hand!} format={fmt} onAct={act} busy={busy} />
            </>
          ) : running && dealtIn && pre.available ? (
            <>
              <p className="o-wait" style={{ minHeight: 0 }}>{actorName ? t.table.thinking(actorName) : '…'}</p>
              <PreActions state={pre} format={fmt} />
            </>
          ) : (
            <div className="o-toolbar">
              {view.you === null && !view.closing && (
                <button type="button" className="o-btn block" disabled={busy || (seated >= view.maxSeats && !view.seats.some((x) => x?.account.bot))} onClick={() => post('join')}>{t.live.join(fmt(view.buyIn))}</button>
              )}
              {host && view.mode === 'fun' && !view.closing && seated < view.maxSeats && (
                <button type="button" className="o-btn ghost" disabled={busy} onClick={() => setPanel('bots')}>🤖 {t.live.bots}</button>
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
                <button type="button" className="o-btn ghost" disabled={busy} onClick={() => setConfirming({ text: t.live.leaveConfirm, confirm: t.live.leave, path: 'leave' })}>{t.live.leave}</button>
              )}
              {host && !view.closing && (
                <button type="button" className="o-btn danger" disabled={busy} onClick={() => setConfirming({ text: t.live.endConfirm, confirm: t.live.end, path: 'close' })}>{t.live.end}</button>
              )}
              {running && dealtIn && <p className="o-wait" style={{ width: '100%' }}>…</p>}
            </div>
          )}
        </div>
      </div>

      {panel === 'chat' && <Sheet title={t.chat.title} onClose={() => setPanel(null)}>{chatPanel}</Sheet>}
      {panel === 'bots' && (
        <BotSheet
          free={view.maxSeats - seated - (view.you === null ? 1 : 0)}
          busy={busy}
          onClose={() => setPanel(null)}
          onFill={async (level) => {
            await post('bots', { level });
            setPanel(null);
          }}
        />
      )}
      {panel === 'history' && (
        <Sheet title={t.history.title} onClose={() => setPanel(null)}>
          <OError error={history.error} />
          {!history.data && !history.error ? <OLoading /> : (
            <HistoryList
              viewerId={meId ?? (account ? String(account.id) : null)}
              empty={t.history.empty}
              items={(history.data ?? []).map((h) => ({ key: h.id, record: h.record, title: h.tableName, at: h.at, maxSeats: h.maxSeats, avatars: { ...avatars, ...h.avatars }, format: fmt }))}
            />
          )}
        </Sheet>
      )}
      {confirming && (
        <ConfirmSheet
          text={confirming.text}
          confirm={confirming.confirm}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            void post(confirming.path, confirming.body);
            setConfirming(null);
          }}
        />
      )}
    </main>
  );
}

/** Host of a fun table: pick a level and fill the free seats with bots. */
function BotSheet({ free, busy, onClose, onFill }: { free: number; busy: boolean; onClose: () => void; onFill: (level: BotLevel) => void }) {
  const t = useOT();
  const [level, setLevel] = useState<BotLevel>('casual');
  return (
    <Sheet title={t.live.bots} onClose={onClose}>
      <span className="o-label">
        {t.bots.level}
        <Info label={t.bots.aboutLevels}>
          {BOT_LEVELS.map((l) => <span key={l} style={{ display: 'block', marginBottom: 6 }}><b>{t.bots.levels[l]}</b>: {t.bots.levelInfo[l]}</span>)}
        </Info>
      </span>
      <div className="o-levels">
        {BOT_LEVELS.map((l) => (
          <button key={l} type="button" className="o-level" aria-pressed={level === l} onClick={() => setLevel(l)}>
            <span className="o-emoji" aria-hidden="true">{BOT_STYLE[l].avatars[0]}</span>
            <strong>{t.bots.levels[l]}</strong>
          </button>
        ))}
      </div>
      <button type="button" className="o-btn block" disabled={busy || free < 1} onClick={() => onFill(level)}>{t.live.fillBots(Math.max(free, 0))}</button>
    </Sheet>
  );
}

/** Seconds left to act; ticks on its own so the table doesn't re-render every second. */
function TurnTimer({ end }: { end: number }) {
  const t = useOT();
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return <> · {t.table.seconds(Math.max(0, Math.ceil((end - Date.now()) / 1000)))}</>;
}

const HistoryIcon = () => (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3.5 4v4h4" /><path d="M12 8v4l3 2" />
  </svg>
);
const ShareIcon = () => (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12" /><path d="m7.5 7.5 4.5-4.5 4.5 4.5" /><path d="M5 12v7.5h14V12" />
  </svg>
);
const ChatIcon = () => (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 5.5h16v10H10l-4.5 3.5v-3.5H4z" />
  </svg>
);

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
