import { useEffect, useState } from 'react';
import type { Game } from '../../../shared/types.ts';
import { api, errorText } from '../api.ts';
import { Info } from '../components/Info.tsx';
import { Alert, Check } from '../components/Icons.tsx';
import { ErrorLine, Header, Loading } from '../components/Layout.tsx';
import { day, eur, parseEur, signed, tone } from '../format.ts';
import { useT } from '../i18n.ts';
import { go } from '../router.ts';
import { useApi } from '../useApi.ts';

export function Settle({ id }: { id: number }) {
  const t = useT();
  const game = useApi<Game>(`/games/${id}`);
  const [stacks, setStacks] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (game.data?.status === 'closed') go(`/game/${id}`, true);
  }, [game.data, id]);

  const g = game.data;
  if (!g) {
    return (
      <main className="page">
        <Header title={t.settle.title} back={`/game/${id}`} />
        {game.error ? <ErrorLine error={game.error} /> : <Loading />}
      </main>
    );
  }
  if (g.status !== 'live') return null;

  const parsed = g.players.map((p) => ({ p, cents: parseEur(stacks[p.playerId] ?? '') }));
  const complete = parsed.every((x) => x.cents !== null);
  const counted = parsed.reduce((s, x) => s + (x.cents ?? 0), 0);
  const diff = counted - g.totals.onTable;

  const close = async () => {
    setBusy(true);
    try {
      await api<Game>(`/games/${id}/close`, 'POST', {
        stacks: parsed.map((x) => ({ playerId: x.p.playerId, stack: x.cents })),
      });
      go(`/game/${id}`, true);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <main className="page with-footer">
      <Header title={t.settle.title} back={`/game/${id}`}>
        <span className="muted small">{day(g.startedAt)} · {eur(g.buyIn)}</span>
      </Header>

      <div className={`check ${complete && diff === 0 ? 'ok' : 'warn'}`} role="status">
        {complete && diff === 0 ? <Check /> : <Alert />}
        <span className="grow">
          {!complete ? t.settle.countEvery : diff === 0 ? t.settle.match : diff > 0 ? t.settle.tooMuch(eur(diff)) : t.settle.missing(eur(-diff))}
        </span>
        <span className="num">{eur(counted)} / {eur(g.totals.onTable)}</span>
        <Info label={t.settle.aboutCheck}>{t.settle.infoCheck}</Info>
      </div>

      <section>
        <div className="table-head">
          <span className="grow">{t.common.player}</span>
          <span className="col-sm">{t.common.debt}</span>
          <span className="col-input">{t.settle.finalStack}</span>
          <span className="col-sm">
            {t.common.result}
            <Info label={t.game.aboutResult}>{t.common.infoResult}</Info>
          </span>
        </div>
        <ul className="list">
          {parsed.map(({ p, cents }) => {
            const raw = stacks[p.playerId] ?? '';
            const result = cents === null ? null : cents - p.debt;
            return (
              <li key={p.playerId} className="result-row">
                <span className="grow strong ellipsis">{p.name}</span>
                <span className="col-sm num muted">{eur(p.debt)}</span>
                <input
                  className={`input num col-input ${raw && cents === null ? 'invalid' : ''}`}
                  inputMode="decimal"
                  aria-label={t.settle.stackAria(p.name)}
                  placeholder="0"
                  value={raw}
                  onChange={(e) => setStacks((s) => ({ ...s, [p.playerId]: e.target.value }))}
                />
                <span className={`col-sm num strong ${result === null ? 'muted' : tone(result)}`}>
                  {result === null ? '–' : signed(result)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <ErrorLine error={error} />

      <footer className="footer">
        <button className="primary grow" type="button" disabled={busy || !complete || diff !== 0} onClick={close}>
          {t.settle.close}
        </button>
      </footer>
    </main>
  );
}
