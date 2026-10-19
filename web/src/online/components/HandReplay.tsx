import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Card } from '../../../../shared/poker/cards.ts';
import { describe, evaluate } from '../../../../shared/poker/evaluate.ts';
import { redact, replayViews, type HandRecord } from '../../../../shared/poker/history.ts';
import { handName, useOT } from '../i18n.ts';
import { soundsFor } from '../sound.ts';
import { stage } from '../stage.ts';
import { useEscape } from './Nav.tsx';
import { PlayingCard } from './PlayingCard.tsx';
import { TableFelt, type SeatInfo } from './TableFelt.tsx';

/** Shortest pause between replay steps, so quick actions stay readable. */
const MIN_STEP_MS = 500;

/** Plays a finished hand back on a table, step by step, as `viewerId` saw it. */
export function HandReplay({ record, viewerId, maxSeats, avatars, format, onClose }: {
  record: HandRecord;
  viewerId: string | null;
  maxSeats: number;
  avatars?: Record<string, string>;
  format: (n: number) => string;
  onClose: () => void;
}) {
  const t = useOT();
  useEscape(onClose);
  const frames = useMemo(() => {
    const { start, end } = replayViews(redact(record, viewerId), viewerId);
    return [start, ...stage(start, end).map((f) => f.view)];
  }, [record, viewerId]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const view = frames[i];

  useEffect(() => {
    if (!playing) return;
    if (i >= frames.length - 1) return setPlaying(false);
    const timer = setTimeout(() => {
      soundsFor(frames[i], frames[i + 1], viewerId);
      setI(i + 1);
    }, Math.max(MIN_STEP_MS, i === 0 ? 700 : 0));
    return () => clearTimeout(timer);
  }, [playing, i, frames, viewerId]);

  const seats: (SeatInfo | null)[] = Array.from({ length: maxSeats }, () => null);
  for (const p of record.players) seats[p.seat] = { name: p.name, avatar: avatars?.[p.id] ?? '🙂', stack: p.stack };
  const youSeat = record.players.find((p) => p.id === viewerId)?.seat ?? null;
  const mine = view.you !== null ? view.players[view.you] : null;

  // Rendered at the section's root: opened from inside another sheet, it must not be clipped by it.
  return createPortal(
    <div className="o-sheet" role="dialog" aria-modal="true" aria-label={t.history.replay}>
      <div className="o-replay">
        <div className="o-row o-between">
          <h2 style={{ fontSize: 18, fontWeight: 500 }}>{t.history.handNo(record.handNo)} · {t.table.streets[view.street]}</h2>
          <button type="button" className="o-btn ghost small" onClick={onClose}>{t.common.close}</button>
        </div>
        <TableFelt maxSeats={maxSeats} seats={seats} hand={view} youSeat={youSeat} format={format} />
        {mine?.cards && (
          <div className="o-hand" style={{ minHeight: 0 }}>
            <span className="o-cards">{mine.cards.map((c, k) => <PlayingCard key={k} card={c} size="lg" dim={mine.folded} />)}</span>
          </div>
        )}
        <div className="o-replay-controls">
          <button type="button" className="o-btn ghost small" aria-label={t.history.restart} onClick={() => { setI(0); setPlaying(true); }}>⏮</button>
          <button type="button" className="o-btn ghost small" aria-label={t.history.back} disabled={i === 0} onClick={() => { setPlaying(false); setI(i - 1); }}>◀</button>
          <button type="button" className="o-btn small" onClick={() => (i >= frames.length - 1 ? (setI(0), setPlaying(true)) : setPlaying(!playing))}>
            {playing ? t.history.pause : t.history.play}
          </button>
          <button type="button" className="o-btn ghost small" aria-label={t.history.forward} disabled={i >= frames.length - 1} onClick={() => { setPlaying(false); setI(i + 1); }}>▶</button>
          <span className="o-muted o-small o-num">{i + 1}/{frames.length}</span>
        </div>
      </div>
    </div>,
    document.querySelector('.online') ?? document.body,
  );
}

export interface HistoryItem {
  key: string | number;
  record: HandRecord;
  /** Table name, bot level … */
  title: string;
  at: string;
  maxSeats: number;
  avatars?: Record<string, string>;
  format: (n: number) => string;
}

function MiniCards({ cards }: { cards: Card[] }) {
  return <span className="o-cards o-mini">{cards.map((c, k) => <PlayingCard key={k} card={c} size="sm" />)}</span>;
}

/** Finished hands, newest first: your cards, the board and your result. Tap one to replay it. */
export function HistoryList({ items, viewerId, empty }: { items: HistoryItem[]; viewerId: string | null; empty: string }) {
  const t = useOT();
  const [open, setOpen] = useState<HistoryItem | null>(null);
  if (!items.length) return <p className="o-note">{empty}</p>;
  return (
    <>
      <ul className="o-list o-history">
        {items.map((item) => {
          const r = item.record;
          const me = r.players.find((p) => p.id === viewerId);
          const winner = r.players.filter((p) => p.won > 0).sort((a, b) => b.won - a.won)[0];
          const winnerCards = winner?.shown ? winner.hole : null;
          const summary = winner
            ? winnerCards && r.board.length === 5
              ? t.history.wonWith(winner.id === viewerId ? t.common.you : winner.name, handName(t, describe(evaluate([...winnerCards, ...r.board]))))
              : t.history.won(winner.id === viewerId ? t.common.you : winner.name)
            : '';
          return (
            <li key={item.key}>
              <button type="button" className="o-item" onClick={() => setOpen(item)}>
                {me?.hole.length ? <MiniCards cards={me.hole} /> : <span className="o-avatar" aria-hidden="true">🂠</span>}
                <span className="grow">
                  <span className="title">{item.title} · {t.history.handNo(r.handNo)}</span>
                  <span className="o-muted o-small">{summary}</span>
                </span>
                {me && <span className={`o-num ${me.net > 0 ? 'o-pos' : me.net < 0 ? 'o-neg' : 'o-muted'}`}>{me.net > 0 ? '+' : ''}{item.format(me.net)}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {open && (
        <HandReplay record={open.record} viewerId={viewerId} maxSeats={open.maxSeats} avatars={open.avatars} format={open.format} onClose={() => setOpen(null)} />
      )}
    </>
  );
}
