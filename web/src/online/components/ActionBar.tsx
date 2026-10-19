import { useEffect, useRef, useState } from 'react';
import type { Action, Street } from '../../../../shared/poker/holdem.ts';
import type { HandView } from '../../../../shared/poker/view.ts';
import { dict } from '../../i18n.ts';
import { useOT } from '../i18n.ts';

/** Preflop sizes are multiples of the bet to beat (2.5×, 3×, 4× the big blind for an open); later streets use the pot. */
const PREFLOP = [2.5, 3, 4] as const;
const POSTFLOP = [1 / 3, 0.5, 0.75, 1] as const;

/** Keys only count when no text field has focus and no modifier is held. */
function keyFor(e: KeyboardEvent): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const el = e.target as HTMLElement | null;
  if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range') || el.isContentEditable)) return null;
  return e.key;
}

/**
 * Fold / Check or Call / Bet or Raise, with size presets, a slider and ± steps.
 * Desktop keys: F fold, C check or call, R raise; while sizing 1–4 presets, A all-in, arrows step, Enter sends, Esc cancels.
 */
export function ActionBar({ view, format, onAct, busy }: { view: HandView; format: (n: number) => string; onAct: (a: Action) => void; busy?: boolean }) {
  const t = useOT();
  const legal = view.legal;
  const [sizing, setSizing] = useState(false);
  const [to, setTo] = useState(0);

  const raise = legal?.raise ?? null;
  const betting = view.currentBet === 0;
  const preflop = view.street === 'preflop';
  const step = view.bb;
  const clamp = (v: number) => (raise ? Math.min(Math.max(Math.round(v / view.sb) * view.sb, raise.min), raise.max) : 0);
  const presets: { label: string; to: number }[] = !legal || !raise
    ? []
    : preflop
      ? PREFLOP.map((x) => ({ label: `${x.toLocaleString(dict().locale)}×`, to: clamp(view.currentBet * x) }))
      : POSTFLOP.map((f) => ({
        label: f === 1 ? t.table.fullPot : f === 0.75 ? t.table.threeQuarter : f === 0.5 ? t.table.half : t.table.third,
        to: clamp(view.currentBet + (view.pot + legal.call) * f),
      }));
  const me = view.players[view.you!];
  const allInCall = legal ? !legal.check && legal.call >= me.stack : false;
  const label = (v: number) => (raise && v >= raise.max ? `${t.table.allIn} ${format(v)}` : betting ? t.table.betTo(format(v)) : t.table.raiseTo(format(v)));

  const send = (a: Action) => {
    setSizing(false);
    onAct(a);
  };
  const openSizing = () => {
    if (!raise) return;
    setTo(presets[1]?.to ?? raise.min);
    setSizing(true);
  };

  // The latest values for the key handler, which is registered once.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    const key = keyFor(e);
    if (!key || !legal || busy) return;
    const onSlider = (e.target as HTMLElement | null)?.tagName === 'INPUT';
    if (sizing && raise) {
      if (key === 'Enter') send({ type: 'raise', to });
      else if (key === 'Escape') setSizing(false);
      else if (key === 'a' || key === 'A') setTo(raise.max);
      else if (/^[1-4]$/.test(key) && presets[Number(key) - 1]) setTo(presets[Number(key) - 1].to);
      else if (!onSlider && (key === 'ArrowUp' || key === 'ArrowRight')) setTo((v) => clamp(v + step));
      else if (!onSlider && (key === 'ArrowDown' || key === 'ArrowLeft')) setTo((v) => clamp(v - step));
      else return;
    } else if (key === 'f' || key === 'F') {
      // Never a fold when checking is free.
      if (legal.check) return;
      send({ type: 'fold' });
    } else if (key === 'c' || key === 'C' || key === 'k' || key === 'K') send({ type: legal.check ? 'check' : 'call' });
    else if (key === 'r' || key === 'R' || key === 'b' || key === 'B') openSizing();
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!legal) return null;

  if (sizing && raise) {
    return (
      <div className="o-raise">
        <div className="o-presets" style={{ gridTemplateColumns: `repeat(${presets.length + 1}, minmax(0, 1fr))` }}>
          {presets.map((p, i) => (
            <button key={p.label} type="button" aria-pressed={to === p.to} onClick={() => setTo(p.to)}>
              {p.label}<kbd>{i + 1}</kbd>
            </button>
          ))}
          <button type="button" aria-pressed={to === raise.max} onClick={() => setTo(raise.max)}>{t.table.allIn}<kbd>A</kbd></button>
        </div>
        <div className="o-size">
          <button type="button" className="o-step" aria-label={t.table.less} disabled={to <= raise.min} onClick={() => setTo((v) => clamp(v - step))}>−</button>
          <input
            className="o-slider"
            type="range"
            aria-label={t.table.amount}
            aria-valuetext={format(to)}
            min={raise.min}
            max={raise.max}
            step={view.sb}
            value={to}
            onChange={(e) => setTo(clamp(Number(e.target.value)))}
          />
          <button type="button" className="o-step" aria-label={t.table.more} disabled={to >= raise.max} onClick={() => setTo((v) => clamp(v + step))}>+</button>
        </div>
        <div className="o-action-row" style={{ gridTemplateColumns: '1fr 2fr' }}>
          <button type="button" className="o-act" onClick={() => setSizing(false)}>{t.common.cancel}<kbd>Esc</kbd></button>
          <button type="button" className="o-act raise" disabled={busy} onClick={() => send({ type: 'raise', to })}>{label(to)}<kbd>↵</kbd></button>
        </div>
      </div>
    );
  }

  return (
    <div className="o-action-row" style={{ gridTemplateColumns: `repeat(${(legal.check ? 1 : 2) + (raise ? 1 : 0)}, minmax(0, 1fr))` }}>
      {!legal.check && (
        <button type="button" className="o-act" disabled={busy} onClick={() => send({ type: 'fold' })}>{t.table.fold}<kbd>F</kbd></button>
      )}
      {legal.check ? (
        <button type="button" className="o-act main" disabled={busy} onClick={() => send({ type: 'check' })}>{t.table.check}<kbd>C</kbd></button>
      ) : (
        <button type="button" className="o-act main" disabled={busy} onClick={() => send({ type: 'call' })}>
          {allInCall ? t.table.allIn : t.table.actions.call}
          <small>{format(legal.call)}</small>
          <kbd>C</kbd>
        </button>
      )}
      {raise && (
        <button type="button" className="o-act raise" disabled={busy} onClick={openSizing}>
          {betting ? t.table.bet : t.table.raise}
          <small>{format(raise.min)}+</small>
          <kbd>R</kbd>
        </button>
      )}
    </div>
  );
}

export type PreKind = 'checkFold' | 'check' | 'call' | 'callAny';

interface Pre {
  kind: PreKind;
  /** To call when chosen: "Call 40" no longer holds after a raise. */
  amount: number;
  street: Street;
  handNo: number;
}

/**
 * Acting in advance while others think: Check/Fold, Check, Call X or Call any. The choice is played the moment
 * your turn comes (`ready`: the screen has caught up), and dropped when a raise or a new street makes it stale.
 */
export function usePreAction(view: HandView | null, ready: boolean, act: (a: Action) => void) {
  const [pre, setPre] = useState<Pre | null>(null);
  const me = view && view.you !== null ? view.players[view.you] : null;
  const toCall = me && view ? Math.max(0, Math.min(view.currentBet - me.bet, me.stack)) : 0;
  const valid = Boolean(
    pre && view && pre.handNo === view.handNo && pre.street === view.street && !((pre.kind === 'check' || pre.kind === 'call') && toCall !== pre.amount),
  );
  const actRef = useRef(act);
  actRef.current = act;

  useEffect(() => {
    if (pre && !valid) setPre(null);
  }, [pre, valid]);

  useEffect(() => {
    if (!ready || !view?.legal || !pre || !valid) return;
    const l = view.legal;
    const a: Action | null = pre.kind === 'checkFold' ? { type: l.check ? 'check' : 'fold' }
      : pre.kind === 'check' ? (l.check ? { type: 'check' } : null)
        : pre.kind === 'call' ? (l.call === pre.amount ? { type: 'call' } : null)
          : { type: l.check ? 'check' : 'call' };
    setPre(null);
    if (a) actRef.current(a);
  }, [ready, view, pre, valid]);

  const available = Boolean(view && me && !view.result && !me.folded && !me.allIn && !(ready && view.legal));
  const choose = (kind: PreKind) => {
    if (!view) return;
    setPre((p) => (p?.kind === kind ? null : { kind, amount: toCall, street: view.street, handNo: view.handNo }));
  };
  return { pre: valid ? pre!.kind : null, toCall, available, choose };
}

/** The pre-action toggles shown while someone else is to act. */
export function PreActions({ state, format }: { state: ReturnType<typeof usePreAction>; format: (n: number) => string }) {
  const t = useOT();
  if (!state.available) return null;
  const options: { kind: PreKind; label: string }[] = state.toCall === 0
    ? [{ kind: 'checkFold', label: t.table.checkFold }, { kind: 'check', label: t.table.check }, { kind: 'callAny', label: t.table.callAny }]
    : [{ kind: 'checkFold', label: t.table.fold }, { kind: 'call', label: `${t.table.actions.call} ${format(state.toCall)}` }, { kind: 'callAny', label: t.table.callAny }];
  return (
    <div className="o-pre" role="group" aria-label={t.table.preActions}>
      {options.map((o) => (
        <button key={o.kind} type="button" aria-pressed={state.pre === o.kind} onClick={() => state.choose(o.kind)}>
          <span className="o-tick" aria-hidden="true" />
          {o.label}
        </button>
      ))}
    </div>
  );
}
