import { useT } from '../i18n.ts';
import { setPeriod, usePeriod, type Period } from '../period.ts';

/** All time | This month — one choice shared by Ranking and Stats. */
export function PeriodSwitch() {
  const t = useT();
  const period = usePeriod();
  const options: [Period, string][] = [['all', t.ranking.allTime], ['month', t.ranking.thisMonth]];
  return (
    <div className="segmented" role="group" aria-label={t.ranking.period}>
      {options.map(([p, label]) => (
        <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>
          {label}
        </button>
      ))}
    </div>
  );
}
