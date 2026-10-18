import { useId } from 'react';

const W = 320;
const H = 96;
const PAD = 6;

/** Running total as a soft gradient line, no axes: the trend at a glance. Starts at 0. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const id = useId();
  const points = [0, ...values];
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i / Math.max(points.length - 1, 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + ((max - v) / span) * (H - PAD * 2);

  // Smooth curve through the points (Catmull-Rom as cubic Béziers).
  let d = `M${x(0)},${y(points[0])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];
    const x0 = x(Math.max(i - 1, 0));
    const x3 = x(Math.min(i + 2, points.length - 1));
    const c1x = x(i) + (x(i + 1) - x0) / 6;
    const c1y = y(p1) + (y(p2) - y(p0)) / 6;
    const c2x = x(i + 1) - (x3 - x(i)) / 6;
    const c2y = y(p2) - (y(p3) - y(p1)) / 6;
    d += `C${c1x},${c1y} ${c2x},${c2y} ${x(i + 1)},${y(p2)}`;
  }

  return (
    <svg className="o-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#8ff0bf" />
          <stop offset="0.35" stopColor="#8ccfff" />
          <stop offset="0.65" stopColor="#c8b5ff" />
          <stop offset="1" stopColor="#ffbf8f" />
        </linearGradient>
      </defs>
      {min < 0 && max > 0 && <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke="#262629" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
      <path d={d} stroke={`url(#${id})`} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
