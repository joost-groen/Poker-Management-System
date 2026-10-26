import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { niceStep } from './StepChart.tsx';

export interface Bar {
  key: string;
  /** Axis and readout label. */
  label: string;
  value: number;
  /** Second readout line. */
  detail?: string;
  /** Diverging charts color each bar by its side of zero. */
  tone?: 'pos' | 'neg' | '';
}

interface Props {
  bars: Bar[];
  format: (v: number) => string;
  label: string;
  valueLabel: string;
  /** Bar shown in the readout until one is picked; defaults to the last. */
  initial?: number;
}

const PAD = { top: 10, right: 6, bottom: 24, left: 52 };
const GAP = 2;
const MAX_BAR = 36;
const RADIUS = 4;

export function useSize(): [RefObject<HTMLDivElement | null>, { w: number; h: number }] {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [wrap, size];
}

/** Bar with a rounded data end, anchored square to the baseline. */
function barPath(x: number, w: number, top: number, base: number) {
  const r = Math.min(RADIUS, w / 2, base - top);
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
}

/**
 * One series of non-negative bars. The readout above names the picked bar; dragging across the chart (or arrow
 * keys) moves it, as in the balance chart. A table carries the values for screen readers.
 */
export function BarChart({ bars, format, label, valueLabel, initial }: Props) {
  const [wrap, size] = useSize();
  const [selected, setSelected] = useState<number | null>(null);
  const n = bars.length;
  const sel = Math.min(selected ?? initial ?? n - 1, n - 1);
  const bar = bars[sel];

  const max = Math.max(...bars.map((b) => b.value), 1);
  const step = niceStep(max, 4);
  const top = Math.ceil(max / step) * step;
  const iw = Math.max(size.w - PAD.left - PAD.right, 1);
  const ih = Math.max(size.h - PAD.top - PAD.bottom, 1);
  const slot = iw / Math.max(n, 1);
  const bw = Math.max(Math.min(slot - GAP, MAX_BAR), 1);
  const x = (i: number) => PAD.left + i * slot + (slot - bw) / 2;
  const y = (v: number) => PAD.top + ih - (v / top) * ih;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setSelected(Math.min(Math.max(Math.floor((e.clientX - r.left - PAD.left) / slot), 0), n - 1));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const next = { ArrowLeft: sel - 1, ArrowRight: sel + 1, Home: 0, End: n - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setSelected(Math.min(Math.max(next, 0), n - 1));
  };

  if (!bar) return null;

  return (
    <figure className="balance">
      <div className="balance-readout" aria-live="polite">
        <span className="grow min0">
          <span className="strong block ellipsis">{bar.label}</span>
          {bar.detail && <span className="muted small">{bar.detail}</span>}
        </span>
        <span className="right">
          <span className="muted small block">{valueLabel}</span>
          <span className="num balance-value">{format(bar.value)}</span>
        </span>
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
                <text className="chart-axis" x={PAD.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle">{format(v)}</text>
              </g>
            ))}
            {bars.map((b, i) => (
              <path
                key={b.key}
                className={`chart-bar ${b.tone ? `chart-bar-${b.tone}` : ''} ${i === sel ? 'on' : ''}`}
                d={barPath(x(i), bw, b.value > 0 ? Math.min(y(b.value), y(0) - 2) : y(0), y(0))}
              />
            ))}
            {n > 1 && <text className="chart-axis" x={x(0)} y={size.h - 4}>{bars[0].label}</text>}
            <text className="chart-axis" x={x(n - 1) + bw} y={size.h - 4} textAnchor="end">{bars[n - 1].label}</text>
          </svg>
        )}
      </div>

      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {bars.map((b) => (
            <tr key={b.key}><td>{b.label}</td><td>{format(b.value)}</td>{b.detail && <td>{b.detail}</td>}</tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
