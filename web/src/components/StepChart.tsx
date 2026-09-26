import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';

export interface Point {
  /** ms timestamp */
  t: number;
  v: number;
}

interface Props {
  points: Point[];
  end: number;
  format: (v: number) => string;
  formatTime: (t: number) => string;
  label: string;
  tableLabel: string;
  timeLabel: string;
  valueLabel: string;
}

const PAD = { top: 12, right: 64, bottom: 28, left: 56 };

/** Largest "nice" step (1, 2, 2.5, 5 × 10^k) giving about `count` gridlines. */
function niceStep(max: number, count: number): number {
  const raw = Math.max(max / count, 1);
  const pow = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow);
}

/**
 * One series as a step line: the value holds until the next change. Neutral ink (not a status color), recessive
 * grid, a direct label on the last value, a crosshair readout on hover, and a table for screen readers.
 */
export function StepChart({ points, end, format, formatTime, label, tableLabel, timeLabel, valueLabel }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Always the same wrapper (the size observer is attached to it); an empty series draws nothing.
  const series = points.length > 0 ? points : [{ t: end, v: 0 }];
  const start = series[0].t;
  const stop = Math.max(end, series[series.length - 1].t + 1);
  const max = Math.max(...series.map((p) => p.v));
  const step = niceStep(max, 3);
  const top = Math.ceil((max * 1.05) / step) * step || step;
  const iw = Math.max(size.w - PAD.left - PAD.right, 1);
  const ih = Math.max(size.h - PAD.top - PAD.bottom, 1);
  const x = (t: number) => PAD.left + ((t - start) / (stop - start)) * iw;
  const y = (v: number) => PAD.top + ih - (v / top) * ih;

  let d = `M${x(series[0].t)},${y(series[0].v)}`;
  for (let i = 1; i < series.length; i++) d += `H${x(series[i].t)}V${y(series[i].v)}`;
  d += `H${x(stop)}`;
  const area = `${d}V${y(0)}H${x(series[0].t)}Z`;

  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const last = series[series.length - 1];

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = start + ((e.clientX - r.left - PAD.left) / iw) * (stop - start);
    setHover(t < start || t > stop ? null : t);
  };
  const hovered = hover === null ? null : [...series].reverse().find((p) => p.t <= hover) ?? series[0];

  return (
    <figure className="chart-figure">
      <figcaption className="chart-title">{label}</figcaption>
      <div className="chart" ref={wrap}>
        {size.w > 0 && points.length > 0 && (
          <svg width={size.w} height={size.h} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            {ticks.map((v) => (
              <g key={v}>
                <line className="chart-grid" x1={PAD.left} x2={PAD.left + iw} y1={y(v)} y2={y(v)} />
                <text className="chart-axis" x={PAD.left - 10} y={y(v)} textAnchor="end" dominantBaseline="middle">{format(v)}</text>
              </g>
            ))}
            <text className="chart-axis" x={PAD.left} y={size.h - 6}>{formatTime(start)}</text>
            <text className="chart-axis" x={PAD.left + iw} y={size.h - 6} textAnchor="end">{formatTime(stop)}</text>
            <path className="chart-area" d={area} />
            <path className="chart-line" d={d} />
            <circle className="chart-dot" cx={x(stop)} cy={y(last.v)} r={5} />
            <text className="chart-value" x={x(stop) + 10} y={y(last.v)} dominantBaseline="middle">{format(last.v)}</text>
            {hovered && hover !== null && (
              <g>
                <line className="chart-cross" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ih} />
                <circle className="chart-dot" cx={x(hover)} cy={y(hovered.v)} r={5} />
              </g>
            )}
          </svg>
        )}
        {hovered && hover !== null && (
          <div className="chart-tip" style={{ left: Math.min(x(hover) + 12, size.w - 150), top: PAD.top }}>
            <span className="muted">{formatTime(hover)}</span>
            <span className="num">{format(hovered.v)}</span>
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>{tableLabel}</caption>
        <thead>
          <tr><th>{timeLabel}</th><th>{valueLabel}</th></tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}><td>{formatTime(p.t)}</td><td>{format(p.v)}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
