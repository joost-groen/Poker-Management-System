import { useState, type FormEvent } from 'react';
import type { StakesMode, TableSummary } from '../../../../shared/online.ts';
import { Info } from '../../components/Info.tsx';
import { go } from '../../router.ts';
import { oapi, onlineErrorText } from '../api.ts';
import { OError, OHeader } from '../components/Nav.tsx';
import { amount } from '../format.ts';
import { useOT } from '../i18n.ts';
import { useRequireAccount } from './Auth.tsx';

// Cash amounts are cents, fun amounts chips.
const BLINDS: Record<StakesMode, [number, number][]> = {
  cash: [[10, 20], [25, 50], [50, 100], [100, 200]],
  fun: [[5, 10], [10, 20], [25, 50], [50, 100]],
};
const BUY_INS: Record<StakesMode, number[]> = {
  cash: [1000, 2000, 5000, 10000],
  fun: [1000, 2000, 5000, 10000],
};
const SEATS = [2, 3, 4, 5, 6, 7, 8, 9];

export function CreateTable() {
  const t = useOT();
  useRequireAccount('/online/new');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<StakesMode>('cash');
  const [blinds, setBlinds] = useState(1);
  const [buyIn, setBuyIn] = useState(1);
  const [seats, setSeats] = useState(6);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [sb, bb] = BLINDS[mode][blinds];
  const options = BUY_INS[mode].filter((b) => b >= bb * 10);
  const chosenBuyIn = options[Math.min(buyIn, options.length - 1)];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const table = await oapi<TableSummary>('/tables', 'POST', { name: name.trim() || t.create.namePlaceholder, mode, sb, bb, buyIn: chosenBuyIn, maxSeats: seats });
      go(`/online/t/${table.code}`, true);
    } catch (err) {
      setError(onlineErrorText(err));
      setBusy(false);
    }
  };

  return (
    <main className="o-page bare narrow">
      <OHeader title={t.create.title} back="/online/tables" />
      <form className="o-section" style={{ gap: 18 }} onSubmit={submit}>
        <div className="o-section">
          <label className="o-label" htmlFor="o-name">{t.create.name}</label>
          <input id="o-name" className="o-input" maxLength={40} placeholder={t.create.namePlaceholder} value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="o-section">
          <span className="o-label">
            {t.create.mode}
            <Info label={t.live.aboutMode}>{mode === 'cash' ? t.live.infoCash : t.live.infoFun}</Info>
          </span>
          <div className="o-seg">
            <button type="button" aria-pressed={mode === 'cash'} onClick={() => setMode('cash')}>€ {t.common.cash}<small>{t.create.cashSub}</small></button>
            <button type="button" aria-pressed={mode === 'fun'} onClick={() => setMode('fun')}>{t.common.fun}<small>{t.create.funSub}</small></button>
          </div>
        </div>

        <div className="o-section">
          <span className="o-label">{t.create.blinds}</span>
          <div className="o-choices">
            {BLINDS[mode].map(([s, b], i) => (
              <button key={i} type="button" className="o-choice" aria-pressed={blinds === i} onClick={() => setBlinds(i)}>
                <span className="o-num">{amount(mode, s)}/{amount(mode, b)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="o-section">
          <span className="o-label">
            {t.create.buyIn}
            <Info label={t.create.aboutBuyIn}>{t.create.infoBuyIn}</Info>
          </span>
          <div className="o-choices">
            {options.map((b, i) => (
              <button key={b} type="button" className="o-choice" aria-pressed={chosenBuyIn === b} onClick={() => setBuyIn(i)}>
                <span className="o-num">{amount(mode, b)}</span>
                <small>{t.bots.bb(b / bb)}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="o-section">
          <span className="o-label">{t.create.seats}</span>
          <div className="o-seg">
            {SEATS.map((n) => (
              <button key={n} type="button" aria-pressed={seats === n} onClick={() => setSeats(n)}>{n}</button>
            ))}
          </div>
        </div>

        <OError error={error} />
        <button className="o-btn block" type="submit" disabled={busy}>{t.create.create}</button>
      </form>
    </main>
  );
}
