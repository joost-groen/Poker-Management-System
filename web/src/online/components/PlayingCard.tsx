import { RANK_CHARS, rankOf, suitOf, SUIT_SYMBOLS, type Card } from '../../../../shared/poker/cards.ts';

const rankText = (c: Card) => (RANK_CHARS[rankOf(c)] === 'T' ? '10' : RANK_CHARS[rankOf(c)]);

export function cardText(c: Card): string {
  return rankText(c) + SUIT_SYMBOLS[suitOf(c)];
}

/** A face-up card, or the back when `card` is null. `delay` (ms) staggers the deal animation. */
export function PlayingCard({ card, size, dim, win, label, delay }: { card: Card | null; size?: 'sm' | 'lg'; dim?: boolean; win?: boolean; label?: string; delay?: number }) {
  const cls = ['o-pc', size, dim && 'dim', win && 'win'].filter(Boolean).join(' ');
  const style = delay ? { animationDelay: `${delay}ms` } : undefined;
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
