import { useMemo, useState } from 'react';
import { BOT_STYLE, decide, type Decision } from '../../../../shared/poker/bots.ts';
import { cardOf, mathRng, RANK_CHARS } from '../../../../shared/poker/cards.ts';
import { act, positionOf, startHand, type Action, type Position } from '../../../../shared/poker/holdem.ts';
import { handGroup, handLabel, OPEN_RANGE } from '../../../../shared/poker/preflop.ts';
import { rangeShare } from '../../../../shared/poker/ranges.ts';
import { viewFor, type HandView } from '../../../../shared/poker/view.ts';
import { Info } from '../../components/Info.tsx';
import { OHeader } from '../components/Nav.tsx';
import { PlayingCard } from '../components/PlayingCard.tsx';
import { TableFelt } from '../components/TableFelt.tsx';
import { chips, percent } from '../format.ts';
import { useOT } from '../i18n.ts';

// Learn mode's practice tools: the opening ranges at a glance, and quick preflop decisions with instant feedback.

const POSITIONS: Position[] = ['early', 'middle', 'late', 'button', 'sb'];

/** The 13×13 starting-hand grid: pairs on the diagonal, suited hands above it, offsuit below. */
function cell(row: number, col: number) {
  const hi = 12 - Math.min(row, col);
  const lo = 12 - Math.max(row, col);
  const cards = row === col ? [cardOf(hi, 0), cardOf(hi, 1)] : col > row ? [cardOf(hi, 0), cardOf(lo, 0)] : [cardOf(hi, 0), cardOf(lo, 1)];
  return { label: handLabel(cards), group: handGroup(cards) };
}

export function Chart() {
  const t = useOT();
  const [pos, setPos] = useState<Position>('button');
  const open = OPEN_RANGE[pos];
  const grid = useMemo(() => Array.from({ length: 13 }, (_, r) => Array.from({ length: 13 }, (_, c) => cell(r, c))), []);

  return (
    <main className="o-page bare narrow">
      <OHeader title={t.learn.chart} back="/online/learn">
        <Info label={t.learn.aboutChart}>{t.learn.chartIntro} {t.learn.chartNote}</Info>
      </OHeader>
      <div className="o-seg" role="group" aria-label={t.coach.position}>
        {POSITIONS.map((p) => (
          <button key={p} type="button" aria-pressed={pos === p} onClick={() => setPos(p)}>{t.positionShort[p]}</button>
        ))}
      </div>
      <p className="o-small o-muted">{t.learn.openShare(t.positions[pos], percent(rangeShare(open)))}</p>
      <div className="o-grid" role="table" aria-label={t.learn.chart}>
        {grid.map((row, r) => (
          <div key={r} role="row" className="o-grid-row">
            {row.map((c) => (
              <span
                key={c.label}
                role="cell"
                className={`o-grid-cell${c.group <= open ? ' in' : ''}${c.group <= 2 ? ' premium' : ''}`}
                style={c.group <= open ? { ['--g' as string]: String(c.group) } : undefined}
                title={c.group <= 8 ? t.coach.group(c.group) : undefined}
              >
                {c.label.replace(/[so]$/, '')}<small>{c.label.slice(2)}</small>
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="o-row o-small o-muted" style={{ flexWrap: 'wrap', gap: 14 }}>
        <span className="o-row" style={{ gap: 6 }}><span className="o-grid-key in" />{t.learn.keyOpen}</span>
        <span className="o-row" style={{ gap: 6 }}><span className="o-grid-key premium" />{t.learn.keyPremium}</span>
        <span>{t.learn.keyShape}</span>
      </div>
    </main>
  );
}

interface Spot {
  view: HandView;
  decision: Decision;
  position: Position;
  raiser: string | null;
}

const NAMES = BOT_STYLE.regular.names;

/** A random 6-max spot before the flop: folded to you, or one player has raised. */
function makeSpot(): Spot {
  for (;;) {
    const hero = mathRng(6);
    const players = Array.from({ length: 6 }, (_, i) => ({ id: i === hero ? 'you' : `p${i}`, name: i === hero ? '' : NAMES[i % NAMES.length], seat: i, stack: 2000 }));
    let s = startHand({ players, previousButton: mathRng(6), sb: 10, bb: 20, rng: mathRng, handNo: 1 });
    const before: number[] = [];
    for (let i = s.toAct!; s.players[i].id !== 'you'; i = (i + 1) % 6) before.push(i);
    const raiser = before.length && Math.random() < 0.45 ? before[mathRng(before.length)] : null;
    while (!s.result && s.players[s.toAct!].id !== 'you') {
      const a: Action = s.toAct === raiser ? { type: 'raise', to: s.bb * 3 } : { type: 'fold' };
      s = act(s, s.toAct!, a);
    }
    if (s.result) continue;
    const view = viewFor(s, 'you');
    return { view, decision: decide(view, 'coach', () => 0.999), position: positionOf(view, view.you!), raiser: raiser === null ? null : s.players[raiser].name };
  }
}

type Answer = 'fold' | 'call' | 'raise';
/** Check counts as the passive answer, like call. */
const kind = (a: Action): Answer => (a.type === 'raise' ? 'raise' : a.type === 'fold' ? 'fold' : 'call');

export function Drill() {
  const t = useOT();
  const [spot, setSpot] = useState(makeSpot);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0, streak: 0 });
  const { view, decision } = spot;
  const legal = view.legal!;
  const right = kind(decision.action);
  const me = view.players[view.you!];
  const label = handLabel(me.cards!);
  const seats = view.players.map((p) => ({ name: p.id === 'you' ? t.common.you : p.name, avatar: p.id === 'you' ? '😎' : '🙂', stack: p.stack }));

  const choose = (a: Answer) => {
    if (answer) return;
    setAnswer(a);
    const ok = a === right;
    setScore((s) => ({ right: s.right + (ok ? 1 : 0), total: s.total + 1, streak: ok ? s.streak + 1 : 0 }));
  };
  const next = () => {
    setSpot(makeSpot());
    setAnswer(null);
  };
  const options: { a: Answer; text: string }[] = [
    ...(legal.check ? [] : [{ a: 'fold' as const, text: t.table.fold }]),
    { a: 'call', text: legal.check ? t.table.check : t.table.actions.call },
    ...(legal.raise ? [{ a: 'raise' as const, text: t.table.raise }] : []),
  ];
  const tip = t.coach.tips[decision.reason]({ eq: '', need: '', label, pos: t.positions[spot.position] });

  return (
    <main className="o-page bare">
      <OHeader title={t.learn.drill} back="/online/learn">
        <span className="o-badge o-num">{score.right}/{score.total}{score.streak >= 3 ? ` · 🔥${score.streak}` : ''}</span>
      </OHeader>
      <div className="o-game solo drill">
        <TableFelt maxSeats={6} seats={seats} hand={view} youSeat={view.players[view.you!].seat} format={chips} />
        <div className="o-hand">
          <span className="o-cards">{me.cards!.map((c, i) => <PlayingCard key={`${c}-${i}`} card={c} size="lg" />)}</span>
          <span className="o-hand-name">{label} · {t.positionShort[spot.position]}</span>
        </div>
        <div className="o-actions">
          <p className="o-wait" style={{ minHeight: 0 }}>
            {spot.raiser ? t.learn.facingRaise(spot.raiser) : legal.check ? t.learn.checkedToYou : t.learn.foldedToYou}
          </p>
          {answer ? (
            <>
              <p className={`o-feedback ${answer === right ? 'good' : 'mistake'}`} role="status">
                <b>{answer === right ? t.learn.right : t.learn.wrong(options.find((o) => o.a === right)?.text ?? '')}</b>
                {tip}
              </p>
              <button type="button" className="o-btn block" autoFocus onClick={next}>{t.learn.nextSpot}</button>
            </>
          ) : (
            <div className="o-action-row" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
              {options.map((o) => (
                <button key={o.a} type="button" className={`o-act${o.a === 'call' ? ' main' : o.a === 'raise' ? ' raise' : ''}`} onClick={() => choose(o.a)}>{o.text}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
