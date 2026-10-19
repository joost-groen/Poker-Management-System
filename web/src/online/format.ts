import type { StakesMode } from '../../../shared/online.ts';
import { eur, signed } from '../format.ts';
import { dict } from '../i18n.ts';

export function chips(n: number): string {
  return (n < 0 ? '−' : '') + Math.abs(n).toLocaleString(dict().locale);
}

/** Cash tables count in cents and show euros; fun tables and bot games show chips. */
export function amount(mode: StakesMode, n: number): string {
  return mode === 'cash' ? eur(n) : chips(n);
}

export function signedAmount(mode: StakesMode, n: number): string {
  if (mode === 'cash') return signed(n);
  return n > 0 ? `+${chips(n)}` : chips(n);
}

/** Big blinds with a sign and one decimal: "+12,5". */
export function signedBb(n: number): string {
  const s = Math.abs(n).toLocaleString(dict().locale, { maximumFractionDigits: 1 });
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}

export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}
