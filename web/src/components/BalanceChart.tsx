import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { PlayerGame } from '../../../shared/types.ts';
import { fullDay, shortDay, signed, tone } from '../format.ts';
import { useT } from '../i18n.ts';
import { niceStep } from './StepChart.tsx';

const PAD = { top: 10, right: 10, bottom: 24, left: 52 };
/** Above this many games single points would crowd the line; only the selected one is drawn. */
const MAX_DOTS = 40;

/**
 * Running total of a player's results, one point per closed game (evenly spaced, starting at 0). The readout above
 * shows the latest game; dragging across the chart (or arrow keys) moves it, so it works with a thumb on a phone.
 */
export function BalanceChart({ games }: { games: PlayerGame[] }) {
  const t = useT();
  const clip = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [selected, setSelected] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The API lists newest first; the chart reads left to right.
  const history = useMemo(() => [...games].reverse(), [games]);
  const balances = useMemo(() => {
    let sum = 0;
    return [0, ...history.map((g) => (sum += g.result))];
  }, [history]);

  const n = history.length;
  const sel = selected ?? n;
  const game = history[sel - 1];
  const balance = balances[sel];

  const min = Math.min(...balances);
  const max = Math.max(...balances);
  const step = niceStep(max - min, 5);
  const hi = max > 0 ? Math.ceil((max * 1.05) / step) * step : 0;
  const lo = min < 0 ? Math.floor((min * 1.05) / step) * step : 0;
  const span = hi - lo || step;
  const iw = Math.max(size.w - PAD.left - PAD.right, 1);
  const ih = Math.max(size.h - PAD.top - PAD.bottom, 1);
  const x = (i: number) => PAD.left + (i / n) * iw;
  const y = (v: number) => PAD.top + ((hi - v) / span) * ih;

  const line = balances.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('');
  const area = `${line}L${x(n)},${y(0)}L${x(0)},${y(0)}Z`;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - PAD.left) / iw) * n);
    setSelected(Math.min(Math.max(i, 1), n));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const next = { ArrowLeft: sel - 1, ArrowRight: sel + 1, Home: 1, End: n }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setSelected(Math.min(Math.max(next, 1), n));
  };

  return (
    <figure className="balance">
      <div className="balance-readout" aria-live="polite">
        <span className="grow min0">
          <span className="strong block ellipsis">{fullDay(game.startedAt)}</span>
          <span className="muted small">
            {t.player.gameN(sel, n)} · <span className={`num ${tone(game.result)}`}>{signed(game.result)}</span>
          </span>
        </span>
        <span className="right">
          <span className="muted small block">{t.player.balance}</span>
          <span className={`num balance-value ${tone(balance)}`}>{signed(balance)}</span>
        </span>
      </div>

      <div className="chart" ref={wrap}>
        {size.w > 0 && (
          <svg
            width={size.w}
            height={size.h}
            role="img"
            tabIndex={0}
            aria-label={t.player.balanceChart}
            onPointerDown={pick}
            onPointerMove={pick}
            onPointerLeave={(e) => e.pointerType === 'mouse' && setSelected(null)}
            onKeyDown={onKey}
          >
            <defs>
              <clipPath id={`${clip}-pos`}><rect x={0} y={0} width={size.w} height={y(0)} /></clipPath>
              <clipPath id={`${clip}-neg`}><rect x={0} y={y(0)} width={size.w} height={Math.max(size.h - y(0), 0)} /></clipPath>
            </defs>
            {ticks.map((v) => (
              <g key={v}>
                <line className={v === 0 ? 'chart-zero' : 'chart-grid'} x1={PAD.left} x2={PAD.left + iw} y1={y(v)} y2={y(v)} />
                <text className="chart-axis" x={PAD.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle">{signed(v)}</text>
              </g>
            ))}
            {n > 1 && <text className="chart-axis" x={PAD.left} y={size.h - 4}>{shortDay(history[0].startedAt)}</text>}
            <text className="chart-axis" x={PAD.left + iw} y={size.h - 4} textAnchor="end">{shortDay(history[n - 1].startedAt)}</text>
            <path className="chart-area-pos" d={area} clipPath={`url(#${clip}-pos)`} />
            <path className="chart-area-neg" d={area} clipPath={`url(#${clip}-neg)`} />
            {selected !== null && <line className="chart-cross" x1={x(sel)} x2={x(sel)} y1={PAD.top} y2={PAD.top + ih} />}
            <path className="chart-line" d={line} />
            {n <= MAX_DOTS && balances.slice(1).map((v, i) => <circle key={i} className="chart-point" cx={x(i + 1)} cy={y(v)} r={2.5} />)}
            <circle className="chart-dot" cx={x(sel)} cy={y(balance)} r={5} />
          </svg>
        )}
      </div>

      <table className="sr-only">
        <caption>{t.player.balanceChart}</caption>
        <thead>
          <tr><th>{t.admin.date}</th><th>{t.common.result}</th><th>{t.player.balance}</th></tr>
        </thead>
        <tbody>
          {history.map((g, i) => (
            <tr key={g.gameId}><td>{fullDay(g.startedAt)}</td><td>{signed(g.result)}</td><td>{signed(balances[i + 1])}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
