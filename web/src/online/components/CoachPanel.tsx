import type { Advice, Feedback, Leak } from '../../../../shared/poker/coach.ts';
import type { Card } from '../../../../shared/poker/cards.ts';
import { describe, evaluate } from '../../../../shared/poker/evaluate.ts';
import type { Action, Street } from '../../../../shared/poker/holdem.ts';
import { PlayingCard } from './PlayingCard.tsx';
import { Info } from '../../components/Info.tsx';
import { percent } from '../format.ts';
import { handName, useOT, type OnlineDict } from '../i18n.ts';

type Fmt = (n: number) => string;

function params(t: OnlineDict, a: { equity: number; potOdds: number; start: { label: string }; position: Advice['position'] }) {
  return { eq: percent(a.equity), need: percent(a.potOdds), label: a.start.label, pos: t.positions[a.position] };
}

function actionText(t: OnlineDict, a: Action, format: Fmt, betting: boolean): string {
  if (a.type === 'raise') return betting ? t.table.betTo(format(a.to!)) : t.table.raiseTo(format(a.to!));
  return t.table.actions[a.type];
}

/** Learn mode: the numbers behind the decision and the coach's line, updated on every turn. */
export function CoachPanel({ advice, format, betting }: { advice: Advice; format: Fmt; betting: boolean }) {
  const t = useOT();
  const p = params(t, advice);
  const draws = Object.entries(advice.outs?.byCategory ?? {})
    .filter(([cat, n]) => (cat === 'flush' || cat === 'straight') && n >= 4)
    .map(([cat]) => t.coach.draws[cat]);
  const cardsToCome = advice.street === 'flop' ? 2 : 1;
  const outs = advice.outs?.total ?? 0;

  return (
    <section className="o-coach" aria-live="polite">
      <h2>🎓 {t.coach.title}</h2>
      <div className="o-coach-grid">
        <div className="o-tile">
          <span>{t.coach.winChance}<Info label={t.coach.aboutEquity}>{t.coach.infoEquity}</Info></span>
          <strong className="o-num">{percent(advice.equity)}</strong>
          <span className="o-meter"><span style={{ width: percent(advice.equity) }} /></span>
          <small>{t.coach.anyTwo(percent(advice.equityAny))}</small>
        </div>
        <div className="o-tile">
          <span>{t.coach.potOdds}<Info label={t.coach.aboutPotOdds}>{t.coach.infoPotOdds}</Info></span>
          <strong className="o-num">{advice.toCall > 0 ? percent(advice.potOdds) : t.coach.free}</strong>
          {advice.toCall > 0 && <small>{t.coach.need(percent(advice.potOdds))} · {format(advice.toCall)}</small>}
        </div>
        <div className="o-tile">
          {advice.hand ? (
            <>
              <span>{t.coach.outs}<Info label={t.coach.aboutOuts}>{t.coach.infoOuts}</Info></span>
              <strong>{advice.outs ? t.coach.outsLine(outs, Math.min(outs * 2 * cardsToCome, 100)) : '–'}</strong>
              <small>{draws.length ? draws.join(', ') : handName(t, advice.hand)}</small>
            </>
          ) : (
            <>
              <span>{t.coach.start}</span>
              <strong className="o-num">{advice.start.label}</strong>
              <small>{t.coach.group(advice.start.group)}</small>
            </>
          )}
        </div>
        <div className="o-tile">
          <span>{t.coach.position}<Info label={t.coach.aboutPosition}>{t.coach.infoPosition}</Info></span>
          <strong>{t.positionShort[advice.position]}</strong>
          <small>{t.positions[advice.position]}</small>
        </div>
      </div>
      {advice.ranges.length > 0 && (
        <p className="o-small o-muted o-ranges">
          {t.coach.ranges}{' '}
          {advice.ranges.map((r, i) => (
            <span key={r.id}>
              {i > 0 && ' · '}
              <b>{r.name}</b> {r.share >= 0.99 ? t.coach.anyHand : t.coach.top(percent(r.share))}{r.narrowed ? ` ${t.coach.narrowed}` : ''}
            </span>
          ))}
          <Info label={t.coach.aboutRanges}>{t.coach.infoRanges}</Info>
        </p>
      )}
      <div className="o-suggest">
        <strong>{t.coach.suggest}: {actionText(t, advice.suggestion, format, betting)}</strong>
        {t.coach.tips[advice.reason](p)}
      </div>
    </section>
  );
}

export type ReviewedFeedback = Feedback & { label: string; position: Advice['position'] };

export function FeedbackLine({ feedback }: { feedback: ReviewedFeedback }) {
  const t = useOT();
  const p = { eq: percent(feedback.equity), need: percent(feedback.needed), label: feedback.label, pos: t.positions[feedback.position] };
  return (
    <p className={`o-feedback ${feedback.verdict}`} role="status">
      <b>{t.coach.verdict[feedback.verdict]}</b>
      {t.coach.feedback[feedback.code](p)}
    </p>
  );
}

/** After the hand: every decision with its verdict. */
export function HandReview({ items }: { items: ReviewedFeedback[] }) {
  const t = useOT();
  return (
    <section className="o-coach">
      <h2>{t.coach.review}</h2>
      {items.length === 0 ? (
        <p className="o-muted o-small">{t.coach.noReview}</p>
      ) : (
        <ul className="o-review">
          {items.map((f, i) => (
            <li key={i}>
              <span className="o-muted">{t.table.streets[f.street]} · </span>
              <b className={f.verdict === 'good' ? 'o-pos' : f.verdict === 'mistake' ? 'o-neg' : ''}>{t.coach.verdict[f.verdict]}</b>
              {' – '}
              {t.coach.feedback[f.code]({ eq: percent(f.equity), need: percent(f.needed), label: f.label, pos: t.positions[f.position] })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function LeakList({ leaks, onPick }: { leaks: Partial<Record<keyof OnlineDict['coach']['leaks'], number>>; onPick?: (leak: Leak) => void }) {
  const t = useOT();
  const rows = Object.entries(leaks).filter(([, n]) => n && n > 0).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  if (!rows.length) return <p className="o-muted o-small">{t.profile.noLeaks}</p>;
  return (
    <ul className="o-list">
      {rows.map(([leak, n]) => (
        <li key={leak}>
          {onPick ? (
            <button type="button" className="o-item" onClick={() => onPick(leak as Leak)}>
              <span className="grow">
                {t.coach.leaks[leak as keyof OnlineDict['coach']['leaks']]}
                <span className="o-muted o-small" style={{ display: 'block' }}>{t.profile.showHands}</span>
              </span>
              <span className="o-num o-muted">×{n}</span>
            </button>
          ) : (
            <span className="o-item">
              <span className="grow">{t.coach.leaks[leak as keyof OnlineDict['coach']['leaks']]}</span>
              <span className="o-num o-muted">×{n}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export interface RevealedHand {
  id: string;
  name: string;
  avatar: string;
  cards: Card[];
  /** Street they folded on, or null when they stayed in. */
  folded: Street | null;
  net: number;
}

/** Learn mode after a hand: every opponent's cards, how far they went, and what they had with the board. */
export function RevealList({ hands, board, showdown, format }: { hands: RevealedHand[]; board: Card[]; showdown: boolean; format: Fmt }) {
  const t = useOT();
  return (
    <section className="o-coach" aria-live="polite">
      <h2>🔍 {t.reveal.title}</h2>
      <ul className="o-list o-history">
        {hands.map((h) => {
          const made = board.length >= 3 ? handName(t, describe(evaluate([...h.cards, ...board]))) : null;
          const status = h.folded ? t.reveal.folded(h.folded, t.table.streets[h.folded]) : showdown ? made : t.reveal.noShowdown;
          return (
            <li key={h.id} className="o-item">
              <span className="o-cards o-mini">{h.cards.map((c, i) => <PlayingCard key={i} card={c} size="sm" />)}</span>
              <span className="grow">
                <span className="title">{h.avatar} {h.name}</span>
                <span className="o-muted o-small" style={{ display: 'block' }}>
                  {status}
                  {h.folded && made && ` · ${t.reveal.wouldHave(made)}`}
                </span>
              </span>
              <span className={`o-num ${h.net > 0 ? 'o-pos' : h.net < 0 ? 'o-neg' : 'o-muted'}`}>{h.net > 0 ? '+' : ''}{format(h.net)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
