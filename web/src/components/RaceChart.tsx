import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { shortDay, signed, tone } from '../format.ts';
import { useSize } from './BarChart.tsx';
import { niceStep } from './StepChart.tsx';

export interface RaceSeries {
  id: number;
  name: string;
  /** Running balance; index 0 is before the first game. */
  balance: number[];
}

interface Props {
  series: RaceSeries[];
  /** Start of each game, oldest first (one fewer than balance points). */
  dates: string[];
  label: string;
  startLabel: string;
  gameLabel: (i: number, n: number) => string;
}

/** Categorical slots for the dark surface, in fixed order (validated: CVD ΔE ≥ 8.4, contrast ≥ 3:1). */
export const RACE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];

const PAD = { top: 10, right: 78, bottom: 24, left: 52 };
const LABEL_GAP = 14;

const short = (name: string) => (name.length > 9 ? `${name.slice(0, 8)}…` : name);

/** Spreads end labels so none overlap: sorted by y, each at least LABEL_GAP below the previous. */
function spread(ys: number[], lo: number, hi: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) order[k].y = Math.max(order[k].y, order[k - 1].y + LABEL_GAP);
  const overflow = (order.at(-1)?.y ?? 0) - hi;
  if (overflow > 0) for (const o of order) o.y = Math.max(o.y - overflow, lo);
  const out = new Array<number>(ys.length);
  for (const o of order) out[o.i] = o.y;
  return out;
}

/**
 * Running balances of several players over the group's games. Colors follow the player (slot by position in
 * `series`, kept when lines are hidden); names sit at the line ends; the readout lists everyone at the picked game.
 */
export function RaceChart({ series, dates, label, startLabel, gameLabel }: Props) {
  const [wrap, size] = useSize();
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<number | null>(null);

  const n = dates.length;
  const sel = Math.min(selected ?? n, n);
  const shown = series.map((s, i) => ({ ...s, color: RACE_COLORS[i] })).filter((s) => !hidden.has(s.id));

  const values = shown.flatMap((s) => s.balance);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const step = niceStep(max - min, 5);
  const hi = max > 0 ? Math.ceil((max * 1.05) / step) * step : 0;
  const lo = min < 0 ? Math.floor((min * 1.05) / step) * step : 0;
  const span = hi - lo || step;
  const iw = Math.max(size.w - PAD.left - PAD.right, 1);
  const ih = Math.max(size.h - PAD.top - PAD.bottom, 1);
  const x = (i: number) => PAD.left + (i / Math.max(n, 1)) * iw;
  const y = (v: number) => PAD.top + ((hi - v) / span) * ih;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  const ends = spread(shown.map((s) => y(s.balance[n])), PAD.top, PAD.top + ih);

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setSelected(Math.min(Math.max(Math.round(((e.clientX - r.left - PAD.left) / iw) * n), 0), n));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const next = { ArrowLeft: sel - 1, ArrowRight: sel + 1, Home: 0, End: n }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setSelected(Math.min(Math.max(next, 0), n));
  };
  const toggle = (id: number) =>
    setHidden((h) => {
      const next = new Set(h);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const ranked = [...shown].sort((a, b) => b.balance[sel] - a.balance[sel]);

  return (
    <figure className="balance race">
      <div className="race-legend" role="group" aria-label={label}>
        {series.map((s, i) => (
          <button key={s.id} type="button" className="race-chip" aria-pressed={!hidden.has(s.id)} onClick={() => toggle(s.id)}>
            <span className="race-swatch" style={{ background: RACE_COLORS[i] }} />
            {s.name}
          </button>
        ))}
      </div>

      <div className="race-readout" aria-live="polite">
        <span className="strong">{sel === 0 ? startLabel : shortDay(dates[sel - 1])}</span>
        {sel > 0 && <span className="muted small">{gameLabel(sel, n)}</span>}
        <ul className="race-values">
          {ranked.map((s) => (
            <li key={s.id}>
              <span className="race-swatch" style={{ background: s.color }} />
              <span className="grow ellipsis">{s.name}</span>
              <span className={`num ${tone(s.balance[sel])}`}>{signed(s.balance[sel])}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="chart" ref={wrap}>
        {size.w > 0 && (
          <svg
            width={size.w}
            height={size.h}
            role="img"
            tabIndex={0}
            aria-label={label}
            onPointerDown={pick}
            onPointerMove={pick}
            onPointerLeave={(e) => e.pointerType === 'mouse' && setSelected(null)}
            onKeyDown={onKey}
          >
            {ticks.map((v) => (
              <g key={v}>
                <line className={v === 0 ? 'chart-zero' : 'chart-grid'} x1={PAD.left} x2={PAD.left + iw} y1={y(v)} y2={y(v)} />
                <text className="chart-axis" x={PAD.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle">{signed(v)}</text>
              </g>
            ))}
            {n > 1 && <text className="chart-axis" x={x(1)} y={size.h - 4} textAnchor="middle">{shortDay(dates[0])}</text>}
            {n > 0 && <text className="chart-axis" x={x(n)} y={size.h - 4} textAnchor="end">{shortDay(dates[n - 1])}</text>}
            {selected !== null && <line className="chart-cross" x1={x(sel)} x2={x(sel)} y1={PAD.top} y2={PAD.top + ih} />}
            {shown.map((s, k) => (
              <g key={s.id}>
                <path className="race-line" stroke={s.color} d={s.balance.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')} />
                <circle className="race-dot" fill={s.color} cx={x(sel)} cy={y(s.balance[sel])} r={4} />
                <text className="race-name" x={x(n) + 8} y={ends[k]} dominantBaseline="middle">{short(s.name)}</text>
              </g>
            ))}
          </svg>
        )}
      </div>

      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr><th />{series.map((s) => <th key={s.id}>{s.name}</th>)}</tr>
        </thead>
        <tbody>
          {dates.map((d, i) => (
            <tr key={i}><td>{shortDay(d)}</td>{series.map((s) => <td key={s.id}>{signed(s.balance[i + 1])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
