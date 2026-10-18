import { useState } from 'react';
import type { Action } from '../../../../shared/poker/holdem.ts';
import type { HandView } from '../../../../shared/poker/view.ts';
import { useOT } from '../i18n.ts';

const PRESETS = [0.5, 0.75, 1] as const;

/** Fold / Check or Call / Bet or Raise, with presets and a slider for the size. */
export function ActionBar({ view, format, onAct, busy }: { view: HandView; format: (n: number) => string; onAct: (a: Action) => void; busy?: boolean }) {
  const t = useOT();
  const legal = view.legal;
  const [sizing, setSizing] = useState(false);
  const [to, setTo] = useState(0);
  if (!legal) return null;

  const raise = legal.raise;
  const betting = view.currentBet === 0;
  const clamp = (v: number) => (raise ? Math.min(Math.max(Math.round(v / view.sb) * view.sb, raise.min), raise.max) : 0);
  const preset = (f: number) => clamp(view.currentBet + (view.pot + legal.call) * f);
  const me = view.players[view.you!];
  const allInCall = !legal.check && legal.call >= me.stack;
  const label = (v: number) => (raise && v >= raise.max ? `${t.table.allIn} ${format(v)}` : betting ? t.table.betTo(format(v)) : t.table.raiseTo(format(v)));
  const send = (a: Action) => {
    setSizing(false);
    onAct(a);
  };

  if (sizing && raise) {
    return (
      <div className="o-raise">
        <div className="o-presets">
          {PRESETS.map((f) => (
            <button key={f} type="button" onClick={() => setTo(preset(f))}>
              {f === 0.5 ? t.table.half : f === 0.75 ? t.table.threeQuarter : t.table.fullPot}
            </button>
          ))}
          <button type="button" onClick={() => setTo(raise.max)}>{t.table.allIn}</button>
        </div>
        <input
          className="o-slider"
          type="range"
          aria-label={t.table.amount}
          min={raise.min}
          max={raise.max}
          step={view.sb}
          value={to}
          onChange={(e) => setTo(clamp(Number(e.target.value)))}
        />
        <div className="o-action-row" style={{ gridTemplateColumns: '1fr 2fr' }}>
          <button type="button" className="o-act" onClick={() => setSizing(false)}>{t.common.cancel}</button>
          <button type="button" className="o-act raise" disabled={busy} onClick={() => send({ type: 'raise', to })}>{label(to)}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="o-action-row" style={{ gridTemplateColumns: `repeat(${(legal.check ? 1 : 2) + (raise ? 1 : 0)}, minmax(0, 1fr))` }}>
      {!legal.check && (
        <button type="button" className="o-act" disabled={busy} onClick={() => send({ type: 'fold' })}>{t.table.fold}</button>
      )}
      {legal.check ? (
        <button type="button" className="o-act main" disabled={busy} onClick={() => send({ type: 'check' })}>{t.table.check}</button>
      ) : (
        <button type="button" className="o-act main" disabled={busy} onClick={() => send({ type: 'call' })}>
          {allInCall ? t.table.allIn : t.table.actions.call}
          <small>{format(legal.call)}</small>
        </button>
      )}
      {raise && (
        <button
          type="button"
          className="o-act raise"
          disabled={busy}
          onClick={() => {
            setTo(preset(betting ? 0.5 : 0.75));
            setSizing(true);
          }}
        >
          {betting ? t.table.bet : t.table.raise}
          <small>{format(raise.min)}+</small>
        </button>
      )}
    </div>
  );
}
