import type { CSSProperties } from 'react';
import { RANK_CHARS, rankOf, suitOf, SUIT_SYMBOLS, type Card } from '../../../../shared/poker/cards.ts';

const rankText = (c: Card) => (RANK_CHARS[rankOf(c)] === 'T' ? '10' : RANK_CHARS[rankOf(c)]);

export function cardText(c: Card): string {
  return rankText(c) + SUIT_SYMBOLS[suitOf(c)];
}

/**
 * A face-up card, or the back when `card` is null. `delay` (ms) staggers the deal animation. `turnUp`: slides in
 * face down and turns over, as board cards are dealt; 'river' lifts it and turns it over slowly.
 */
export function PlayingCard({ card, size, dim, win, lose, turnUp, label, delay }: {
  card: Card | null; size?: 'sm' | 'lg'; dim?: boolean; win?: boolean; lose?: boolean; turnUp?: boolean | 'river'; label?: string; delay?: number;
}) {
  const cls = ['o-pc', size, dim && 'dim', win && 'win', lose && 'lose', turnUp && 'up', turnUp === 'river' && 'river'].filter(Boolean).join(' ');
  // The variable times the face-down cover of a card turning up together with the card.
  const style = delay ? ({ animationDelay: `${delay}ms`, '--d': `${delay}ms` } as CSSProperties) : undefined;
  if (card === null) return <span className={`${cls} back`} style={style} role="img" aria-label={label} />;
  const red = suitOf(card) === 1 || suitOf(card) === 2;
  return (
    <span className={`${cls}${red ? ' red' : ''}`} style={style} role="img" aria-label={cardText(card)}>
      <span className="r" aria-hidden="true">{rankText(card)}</span>
      <span className="s" aria-hidden="true">{SUIT_SYMBOLS[suitOf(card)]}</span>
    </span>
  );
}

export function CardSlot() {
  return <span className="o-pc slot" aria-hidden="true" />;
}
