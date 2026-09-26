import type { ReactNode } from 'react';
import type { GameSummary } from '../../../shared/types.ts';
import { Plus } from '../components/Icons.tsx';
import { ErrorLine, Header, Loading, TabBar } from '../components/Layout.tsx';
import { day, eur, signed } from '../format.ts';
import { useT } from '../i18n.ts';
import { useApi } from '../useApi.ts';

export function Games() {
  const t = useT();
  const { data, error } = useApi<GameSummary[]>('/games', 15000);
  const live = data?.filter((g) => g.status === 'live') ?? [];
  const closed = data?.filter((g) => g.status === 'closed') ?? [];

  return (
    <>
      <main className="page">
        <Header title={t.games.title}>
          <a className="pill-btn" href="#/new">
            <Plus size={16} />
            {t.games.new}
          </a>
        </Header>
        <ErrorLine error={error} />
        {!data && !error && <Loading />}

        {live.length > 0 && (
        <div className="live-grid">
        {live.map((g) => (
          <a key={g.id} className="card live-card" href={`#/game/${g.id}`}>
            <div className="row between">
              <span className="live-dot">{t.games.live}</span>
              <span className="muted small">{day(g.startedAt)}</span>
            </div>
            <div className="stats">
              <Stat label={t.common.players} value={String(g.playerCount)} />
              <Stat label={t.common.buyIn} value={eur(g.buyIn)} />
              <Stat label={t.common.onTable} value={eur(g.onTable)} />
            </div>
          </a>
        ))}
        </div>
        )}

        {data && data.length === 0 && <p className="muted center pad">{t.games.empty}</p>}

        {closed.length > 0 && (
          <section>
            <h2 className="label">{t.games.history}</h2>
            <ul className="list">
              {closed.map((g) => (
                <li key={g.id}>
                  <a className="list-row" href={`#/game/${g.id}`}>
                    <span className="grow">
                      <span className="strong">{day(g.startedAt)}</span>
                      <span className="muted small block">{t.games.summary(g.playerCount, eur(g.buyIn), g.buyins)}</span>
                    </span>
                    {g.topName && (
                      <span className="right">
                        <span className="num pos block">{signed(g.topResult!)}</span>
                        <span className="muted small">{g.topName}</span>
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <TabBar active="games" />
    </>
  );
}

export function Stat({ label, value, info }: { label: string; value: string; info?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label">
        {label}
        {info}
      </span>
      <span className="num stat-value">{value}</span>
    </div>
  );
}
