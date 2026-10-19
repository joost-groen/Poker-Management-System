import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { describe } from '../../../../shared/poker/evaluate.ts';
import type { HandView } from '../../../../shared/poker/view.ts';
import { handName, useOT, type OnlineDict } from '../i18n.ts';
import { CardSlot, cardText, PlayingCard } from './PlayingCard.tsx';

export interface SeatInfo {
  name: string;
  avatar: string;
  /** Between hands; during a hand the engine's stack is shown. */
  stack: number;
  /** Shown under the name, e.g. "Sitting out". */
  status?: string | null;
}

export interface Clock {
  seat: number;
  /** Local time (ms) when the player runs out of time. */
  end: number;
  total: number;
}

interface Props {
  maxSeats: number;
  seats: (SeatInfo | null)[];
  hand: HandView | null;
  /** The viewer's seat sits at the bottom. */
  youSeat: number | null;
  format: (n: number) => string;
  clock?: Clock | null;
  onTakeSeat?: (seat: number) => void;
  /** Shown in the middle when no hand is running. */
  idle?: string | null;
  /** Learn mode after a hand: hole cards of players who folded are shown too. */
  revealFolded?: boolean;
  /** Chat bubbles over the senders' seats. */
  bubbles?: { key: string | number; seat: number; text: string; emoji: boolean }[];
}

/** Seats around an oval, rotated so the viewer is at the bottom. Percentages of the table box. */
function spot(rel: number, max: number, rx: number, ry: number) {
  const a = ((90 + (rel * 360) / max) * Math.PI) / 180;
  return { left: `${50 + rx * Math.cos(a)}%`, top: `${50 + ry * Math.sin(a)}%` };
}

type Spot = ReturnType<typeof spot>;
const SEAT = [42, 41] as const;
const BET = [27, 25] as const;
const POT: Spot = { left: '50%', top: '47%' };

/** Hole cards come off the deck one at a time, starting left of the button. */
export function dealDelay(hand: HandView, index: number, round: number): number {
  const n = hand.players.length;
  return (round * n + ((index - hand.sbIndex + n) % n)) * 70;
}

/** Chips on their way: bets swept into the pot, the pot pushed to its winner. */
interface Moving {
  key: string;
  from: Spot;
  to: Spot;
  amount: number;
  win: boolean;
}

export function resultText(t: OnlineDict, hand: HandView, format: (n: number) => string, nameOf: (id: string) => string): string | null {
  const r = hand.result;
  if (!r) return null;
  return r.pots
    .filter((pot) => pot.eligible.length > 1 || r.pots.length === 1)
    .map((pot) => {
      if (pot.winners.length > 1) return t.table.split(format(pot.amount));
      const id = pot.winners[0];
      if (!r.showdown) return t.table.wins(nameOf(id), format(pot.amount));
      return t.table.winsWith(nameOf(id), format(pot.amount), handName(t, describe(r.scores[id])));
    })
    .join(' · ');
}

export function TableFelt({ maxSeats, seats, hand, youSeat, format, clock, onTakeSeat, idle, bubbles, revealFolded }: Props) {
  const t = useOT();
  const anchor = youSeat ?? 0;
  const nameOf = (id: string) => {
    const p = hand?.players.find((x) => x.id === id);
    return p && p.seat === youSeat ? t.common.you : (seats[p?.seat ?? -1]?.name ?? p?.name ?? '');
  };
  const acting = hand && !hand.result && hand.toAct !== null ? hand.players[hand.toAct].seat : null;
  const buttonSeat = hand ? hand.players[hand.button]?.seat : null;
  const banner = hand ? resultText(t, hand, format, nameOf) : null;
  const winners = new Set(hand?.result?.pots.flatMap((p) => p.winners) ?? []);
  const relOf = (seat: number) => (seat - anchor + maxSeats) % maxSeats;
  const seatSpot = (seat: number) => spot(relOf(seat), maxSeats, ...SEAT);
  const betSpot = (seat: number) => spot(relOf(seat), maxSeats, ...BET);

  // Each new frame of the hand compares itself with the last one to see which chips move.
  const prev = useRef<HandView | null>(null);
  const [moving, setMoving] = useState<Moving[]>([]);
  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = hand;
    if (!hand || !before || before.handNo !== hand.handNo) return setMoving([]);
    const out: Moving[] = [];
    if (before.street !== hand.street || (hand.result && !before.result)) {
      for (const p of before.players) {
        if (p.bet > 0) out.push({ key: `c${hand.handNo}-${before.street}-${p.id}`, from: betSpot(p.seat), to: POT, amount: p.bet, win: false });
      }
    }
    if (hand.result && !before.result) {
      for (const p of hand.players) {
        const won = hand.result.won[p.id];
        if (won > 0) out.push({ key: `w${hand.handNo}-${p.id}`, from: POT, to: seatSpot(p.seat), amount: won, win: true });
      }
    }
    if (out.length) setMoving(out);
  }, [hand]);

  return (
    <div className="o-felt">
      <div className="o-middle">
        <div className="o-board">
          {Array.from({ length: 5 }, (_, i) => (hand?.board[i] !== undefined ? <PlayingCard key={`${hand.handNo}-${i}`} card={hand.board[i]} delay={i < 3 ? i * 90 : 0} /> : <CardSlot key={i} />))}
        </div>
        {hand && !hand.result && (
          <div className="o-pot">
            {t.table.pot} <strong>{format(hand.pot)}</strong>
          </div>
        )}
        {banner && <div className="o-banner" role="status">{banner}</div>}
        {!hand && idle && <div className="o-pot">{idle}</div>}
      </div>

      {Array.from({ length: maxSeats }, (_, s) => {
        const pos = seatSpot(s);
        const info = seats[s];
        const p = hand?.players.find((x) => x.seat === s);
        if (!info && !p) {
          if (!onTakeSeat) return null;
          return (
            <div key={s} className="o-seat empty" style={pos}>
              <button type="button" onClick={() => onTakeSeat(s)}>
                <span className="o-avatar">+</span>
                <span className="name">{t.table.takeSeat}</span>
              </button>
            </div>
          );
        }
        const turn = acting === s;
        const last = p && hand ? hand.actions.filter((a) => a.playerId === p.id && a.street === hand.street).at(-1) : undefined;
        // The first raise after the flop is a bet.
        const opened = hand?.street !== 'preflop' && last === hand?.actions.find((a) => a.street === hand.street && a.type === 'raise');
        const stack = p ? p.stack : (info?.stack ?? 0);
        const showCards = p && s !== youSeat && (!p.folded || (revealFolded && p.cards));
        const isWinner = p ? winners.has(p.id) : false;
        const net = p && hand?.result ? hand.result.net[p.id] : 0;
        const index = p && hand ? hand.players.indexOf(p) : -1;
        const bubble = bubbles?.filter((b) => b.seat === s).at(-1);
        const cls = ['o-seat', turn && 'turn', p?.folded && 'folded', p?.folded && showCards && 'revealed', isWinner && net > 0 && 'won'].filter(Boolean).join(' ');
        return (
          <div key={s} className={cls} style={pos}>
            {showCards && (
              <span className="o-cards" role="group" aria-label={t.table.cardsAria(p.cards ? p.cards.map(cardText).join(' ') : `2 × ${t.table.hidden}`)}>
                {(p.cards ?? [null, null]).map((c, i) => (
                  <PlayingCard
                    key={`${hand!.handNo}-${i}-${c ?? 'back'}`}
                    card={c}
                    size="sm"
                    win={isWinner && hand?.result?.showdown}
                    label={t.table.hidden}
                    delay={c === null ? dealDelay(hand!, index, i) : i * 120}
                  />
                ))}
              </span>
            )}
            {bubble && <span key={bubble.key} className={`o-bubble${bubble.emoji ? ' emoji' : ''}`}>{bubble.text}</span>}
            <span className="o-avatar" aria-hidden="true">{info?.avatar ?? '🙂'}</span>
            {buttonSeat === s && <span className="o-dealer" role="img" aria-label={t.table.dealer}>D</span>}
            <span className="name">{s === youSeat ? t.common.you : (info?.name ?? p?.name)}</span>
            <span className="stack">{format(stack)}</span>
            {net > 0 ? (
              <span className="tag win">+{format(net)}</span>
            ) : p?.allIn && !hand?.result ? (
              <span className="tag hot">{t.table.allInTag}</span>
            ) : p?.folded ? (
              <span className="last">{t.table.folded}</span>
            ) : last && !hand?.result && last.type !== 'sb' && last.type !== 'bb' ? (
              <span key={hand!.actions.length} className="last pop">{opened && last.type === 'raise' ? t.table.bet : t.table.actions[last.type]}</span>
            ) : info?.status ? (
              <span className="tag">{info.status}</span>
            ) : null}
            {turn && clock && clock.seat === s && <Countdown clock={clock} />}
          </div>
        );
      })}

      {hand && !hand.result && hand.players.filter((p) => p.bet > 0).map((p) => {
        const from = seatSpot(p.seat);
        const style = { ...betSpot(p.seat), '--fx': from.left, '--fy': from.top } as CSSProperties;
        return (
          <span key={`${hand.handNo}-${hand.street}-${p.id}`} className="o-bet" style={style}>
            <span key={p.bet}>{format(p.bet)}</span>
          </span>
        );
      })}
      {moving.map((m) => (
        <span
          key={m.key}
          className={`o-bet o-move${m.win ? ' win' : ''}`}
          style={{ ...m.from, '--tx': m.to.left, '--ty': m.to.top } as CSSProperties}
          aria-hidden="true"
        >
          {format(m.amount)}
        </span>
      ))}
    </div>
  );
}

function Countdown({ clock }: { clock: Clock }) {
  const left = Math.max(clock.end - Date.now(), 0);
  return (
    <span className="o-clock" aria-hidden="true">
      <span key={clock.end} style={{ animationDuration: `${left}ms`, ['--from' as string]: String(left / clock.total) }} />
    </span>
  );
}
