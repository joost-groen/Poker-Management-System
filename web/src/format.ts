import { dict, getLang } from './i18n.ts';

/**
 * Cents → "€20" / "€12.50" in English, "20€" / "12,50€" in German. No space before the €: in the monospace
 * number font a space is a full character wide and reads as a gap.
 */
export function eur(cents: number): string {
  const abs = Math.abs(cents);
  const minus = cents < 0 ? '−' : '';
  if (getLang() === 'de') {
    const s = abs % 100 === 0 ? String(abs / 100) : (abs / 100).toFixed(2).replace('.', ',');
    return `${minus}${s}€`;
  }
  const s = abs % 100 === 0 ? String(abs / 100) : (abs / 100).toFixed(2);
  return `${minus}€${s}`;
}

/** Signed: "+€20", "−€5", "€0". */
export function signed(cents: number): string {
  return cents > 0 ? `+${eur(cents)}` : eur(cents);
}

export function tone(cents: number): 'pos' | 'neg' | '' {
  return cents > 0 ? 'pos' : cents < 0 ? 'neg' : '';
}

/** "12,5" / "12.50" / "12" / "12 €" → cents, or null when not a non-negative amount. */
export function parseEur(input: string): number | null {
  const s = input.trim().replace(',', '.').replace(/^€\s*|\s*€$/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function day(iso: string): string {
  return new Date(iso).toLocaleDateString(dict().locale, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function fullDay(iso: string): string {
  return new Date(iso).toLocaleDateString(dict().locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function time(iso: string): string {
  return new Date(iso).toLocaleTimeString(dict().locale, { hour: '2-digit', minute: '2-digit' });
}
