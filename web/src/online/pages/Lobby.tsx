import { useState, type FormEvent } from 'react';
import type { TableSummary } from '../../../../shared/online.ts';
import { Plus } from '../../components/Icons.tsx';
import { day } from '../../format.ts';
import { go } from '../../router.ts';
import { OError, OHeader, OLoading, OnlineNav } from '../components/Nav.tsx';
import { amount } from '../format.ts';
import { useOT, type OnlineDict } from '../i18n.ts';
import { useOnline } from '../useOnline.ts';
import { useRequireAccount } from './Auth.tsx';

export function ModeBadge({ mode }: { mode: TableSummary['mode'] }) {
  const t = useOT();
  return <span className={`o-badge ${mode === 'cash' ? 'cash' : ''}`}>{mode === 'cash' ? `€ ${t.common.cash}` : t.common.fun}</span>;
}

function stakes(x: Pick<TableSummary, 'mode' | 'sb' | 'bb' | 'buyIn'>, t: OnlineDict) {
  return `${amount(x.mode, x.sb)}/${amount(x.mode, x.bb)} · ${t.common.buyIn} ${amount(x.mode, x.buyIn)}`;
}

export function Lobby() {
  const t = useOT();
  const account = useRequireAccount('/online/tables');
  const { data, error } = useOnline<TableSummary[]>(account ? '/tables' : null);
  const [code, setCode] = useState('');
  const open = data?.filter((x) => x.status === 'open') ?? [];
  const closed = data?.filter((x) => x.status === 'closed') ?? [];

  const join = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c) go(`/online/t/${c}`);
  };

  return (
    <>
      <main className="o-page narrow">
        <OHeader title={t.lobby.title}>
          <a className="o-btn small" href="#/online/new"><Plus size={16} />{t.lobby.new}</a>
        </OHeader>

        <form className="o-row" onSubmit={join}>
          <input className="o-input o-num" aria-label={t.lobby.joinCode} placeholder={`${t.lobby.joinCode} · ${t.lobby.codePlaceholder}`} maxLength={6}
            autoCapitalize="characters" autoCorrect="off" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="o-btn ghost" type="submit" disabled={!code.trim()}>{t.lobby.go}</button>
        </form>

        <OError error={error} />
        {!data && !error && <OLoading />}

        {data && (
          <section className="o-section">
            <h2 className="o-label">{t.lobby.open}</h2>
            {open.length === 0 && <p className="o-note">{t.lobby.none}</p>}
            {open.map((x) => (
              <a key={x.code} className="o-card link" href={`#/online/t/${x.code}`}>
                <span className="o-row o-between">
                  <strong className="title">{x.name}</strong>
                  <ModeBadge mode={x.mode} />
                </span>
                <span className="o-row o-between o-small">
                  <span className="o-muted">{stakes(x, t)}</span>
                  <span className={`o-badge ${x.started ? 'live' : ''}`}>{x.started ? t.lobby.live : t.lobby.waiting} · {t.lobby.seated(x.seated, x.maxSeats)}</span>
                </span>
                <span className="o-muted o-small">{x.host.avatar} {t.lobby.by(x.host.username)} · {x.code}</span>
              </a>
            ))}
          </section>
        )}

        {closed.length > 0 && (
          <section className="o-section">
            <h2 className="o-label">{t.lobby.history}</h2>
            <ul className="o-list">
              {closed.map((x) => (
                <li key={x.code}>
                  <a className="o-item" href={`#/online/t/${x.code}`}>
                    <span className="grow">
                      <span className="title">{x.name}</span>
                      <span className="o-muted o-small">{day(x.closedAt ?? x.createdAt)} · {stakes(x, t)}</span>
                    </span>
                    <ModeBadge mode={x.mode} />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <OnlineNav active="tables" />
    </>
  );
}
