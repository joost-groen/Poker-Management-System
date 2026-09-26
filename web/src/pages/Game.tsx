import { useEffect, useState } from 'react';
import type { Game as GameT, LogEvent, Player } from '../../../shared/types.ts';
import { api, errorText, useAdmin } from '../api.ts';
import { Info } from '../components/Info.tsx';
import { Arrow, Minus, Plus, Screen, Trash, Undo } from '../components/Icons.tsx';
import { ErrorLine, Header, Loading, TabBar } from '../components/Layout.tsx';
import { day, eur, fullDay, signed, time, tone } from '../format.ts';
import { useT } from '../i18n.ts';
import { go } from '../router.ts';
import { useApi } from '../useApi.ts';
import { Stat } from './Games.tsx';

type Act = (path: string, method?: string, body?: unknown) => Promise<void>;

export function Game({ id }: { id: number }) {
  const t = useT();
  const game = useApi<GameT>(`/games/${id}`, 4000);
  const [busy, setBusy] = useState(false);

  const act: Act = async (path, method = 'POST', body) => {
    setBusy(true);
    try {
      game.setData(await api<GameT>(`/games/${id}${path}`, method, body));
      game.setError(null);
    } catch (e) {
      game.setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const g = game.data;
  if (!g) {
    return (
      <main className="page">
        <Header title={t.game.fallbackTitle} back="/" />
        {game.error ? <ErrorLine error={game.error} /> : <Loading />}
      </main>
    );
  }

  return g.status === 'live' ? (
    <LiveGame g={g} busy={busy} act={act} error={game.error} />
  ) : (
    <ClosedGame g={g} busy={busy} act={act} error={game.error} />
  );
}

interface ViewProps {
  g: GameT;
  busy: boolean;
  act: Act;
  error: string | null;
}

function LiveGame({ g, busy, act, error }: ViewProps) {
  const t = useT();
  const admin = useAdmin();
  const last = g.lastEvent;
  return (
    <>
      <main className="page with-footer">
        <Header title={day(g.startedAt)} back="/">
          <a className="secondary small-btn desktop-only" href={`#/tv/${g.id}`}>
            <Screen size={18} />
            {t.nav.tv}
          </a>
          <span className="tag num">{eur(g.buyIn)}</span>
        </Header>

        <div className="game-grid">
        <div className="card stats">
          <Stat label={t.game.boughtIn} value={eur(g.totals.in)} />
          <Stat label={t.game.cashedOut} value={eur(g.totals.out)} />
          <Stat
            label={t.common.onTable}
            value={eur(g.totals.onTable)}
            info={<Info label={t.game.aboutOnTable}>{t.common.infoOnTable}</Info>}
          />
        </div>

        <section className="players-section">
          <div className="table-head">
            <span className="grow">{t.common.player}</span>
            <span className="col-debt">
              {t.common.debt}
              <Info label={t.game.aboutDebt}>{t.game.infoDebt(eur(0))}</Info>
            </span>
            <span className="col-actions">
              {t.game.rebuyOut}
              <Info label={t.game.aboutActions}>{t.game.infoActions(eur(g.buyIn))}</Info>
            </span>
          </div>
          <ul className="list">
            {g.players.map((p) => (
              <li key={p.playerId} className="player-row">
                <span className="grow min0">
                  <span className="row gap-s">
                    <span className="strong ellipsis">{p.name}</span>
                    {p.debt === 0 && <span className="badge">{t.game.profit}</span>}
                  </span>
                  <span className="muted small block">
                    {t.common.buyins(p.buyins)}
                    {p.cashouts > 0 && ` · ${t.game.out(eur(p.cashouts * g.buyIn))}`}
                  </span>
                </span>
                <span className="col-debt num big">{eur(p.debt)}</span>
                <span className="col-actions row gap-s">
                  <button className="square-btn" type="button" disabled={busy} aria-label={t.game.rebuyAria(p.name)}
                    onClick={() => act('/rebuy', 'POST', { playerId: p.playerId })}>
                    <Plus />
                  </button>
                  <button className="square-btn" type="button" disabled={busy || p.debt < g.buyIn} aria-label={t.game.cashoutAria(p.name)}
                    onClick={() => act('/cashout', 'POST', { playerId: p.playerId })}>
                    <Minus />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <LateJoin g={g} busy={busy} act={act} />
        </section>

        {admin && <AdminPanel g={g} busy={busy} act={act} />}
        </div>

        <ErrorLine error={error} />

        <footer className="footer">
          <button className="square-btn tall" type="button" disabled={busy || !last} onClick={() => act('/undo')}
            aria-label={last ? t.game.undoAria(last.name, last.type === 'buyin') : t.game.nothingToUndo}>
            <Undo />
          </button>
          {last && (
            <span className="last-action muted small">
              {last.name} {last.type === 'buyin' ? `+${eur(g.buyIn)}` : `−${eur(g.buyIn)}`}
            </span>
          )}
          <a className="primary grow" href={`#/game/${g.id}/settle`}>{t.game.endGame}</a>
        </footer>
      </main>
      <TabBar active="games" />
    </>
  );
}

function LateJoin({ g, busy, act }: Omit<ViewProps, 'error'>) {
  const t = useT();
  const players = useApi<Player[]>('/players');
  const [pick, setPick] = useState('');
  const available = players.data?.filter((p) => !g.players.some((x) => x.playerId === p.id)) ?? [];
  if (available.length === 0) return null;
  return (
    <div className="row gap late-join">
      <select className="input grow" aria-label={t.game.lateJoinAria} value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="">{t.game.lateJoin}</option>
        {available.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <button className="square-btn" type="button" aria-label={t.game.addToGame} disabled={busy || !pick}
        onClick={() => act('/join', 'POST', { playerId: Number(pick) }).then(() => setPick(''))}>
        <Plus />
      </button>
      <Info label={t.game.aboutLateJoin}>{t.game.infoLateJoin}</Info>
    </div>
  );
}

function ClosedGame({ g, busy, act, error }: ViewProps) {
  const t = useT();
  const admin = useAdmin();
  return (
    <>
      <main className="page">
        <Header title={fullDay(g.startedAt)} back="/">
          <span className="tag num">{eur(g.buyIn)}</span>
        </Header>

        <div className="game-grid">
        <section className="players-section">
          <div className="table-head">
            <span className="grow">{t.common.player}</span>
            <span className="col-sm">{t.common.debt}</span>
            <span className="col-sm">{t.game.stack}</span>
            <span className="col-sm">
              {t.common.result}
              <Info label={t.game.aboutResult}>{t.common.infoResult}</Info>
            </span>
          </div>
          <ul className="list">
            {g.players.map((p) => (
              <li key={p.playerId} className="result-row">
                <a className="grow strong ellipsis" href={`#/player/${p.playerId}`}>{p.name}</a>
                <span className="col-sm num muted">{eur(p.debt)}</span>
                <span className="col-sm num muted">{eur(p.finalStack ?? 0)}</span>
                <span className={`col-sm num strong ${tone(p.result ?? 0)}`}>{signed(p.result ?? 0)}</span>
              </li>
            ))}
          </ul>
        </section>

        <Transfers g={g} />

        {admin && <AdminPanel g={g} busy={busy} act={act} />}
        </div>

        <ErrorLine error={error} />
      </main>
      <TabBar active="games" />
    </>
  );
}

export function Transfers({ g }: { g: GameT }) {
  const t = useT();
  return (
    <section>
      <h2 className="label">
        {t.game.transfers}
        <Info label={t.game.aboutTransfers}>{t.game.infoTransfers}</Info>
      </h2>
      {g.transfers.length === 0 ? (
        <p className="muted">{t.game.nobodyOwes}</p>
      ) : (
        <ul className="plain">
          {g.transfers.map((tr, i) => (
            <li key={i} className="transfer">
              <span className="transfer-name">{tr.fromName}</span>
              <span className="muted"><Arrow /></span>
              <span className="grow">{tr.toName}</span>
              <span className="num">{eur(tr.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Admin-only tools for one game: date, full log, removing players, reopen and delete. */
function AdminPanel({ g, busy, act }: Omit<ViewProps, 'error'>) {
  const t = useT();
  const live = g.status === 'live';
  const [date, setDate] = useState(g.startedAt.slice(0, 10));
  const [log, setLog] = useState<LogEvent[] | null>(null);
  const [remove, setRemove] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload the log whenever the game changes (own actions, other phones via polling).
  const signature = g.players.map((p) => `${p.playerId}:${p.buyins}:${p.cashouts}`).join(',');
  useEffect(() => {
    if (!live) return;
    api<LogEvent[]>(`/games/${g.id}/log`).then(setLog, (e) => setError(errorText(e)));
  }, [g.id, live, signature]);

  const kind = (e: LogEvent, index: number) => {
    if (e.type === 'cashout') return t.admin.cashout;
    if (e.initial) return t.admin.opening;
    // A buy-in that is a player's first entry in the game is a late join.
    return log!.slice(0, index).some((x) => x.playerId === e.playerId) ? t.admin.rebuy : t.admin.joined;
  };

  const deleteGame = async () => {
    try {
      await api(`/games/${g.id}`, 'DELETE');
      go('/', true);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <section className="admin-panel stack">
      <h2 className="label">{t.admin.title}</h2>

      <div className="row gap">
        <input className="input grow" type="date" aria-label={t.admin.date} value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="secondary small-btn" type="button" disabled={busy || !date || date === g.startedAt.slice(0, 10)}
          onClick={() => act('', 'PATCH', { date })}>
          {t.admin.saveDate}
        </button>
      </div>

      {live && log && (
        <div>
          <h3 className="label">
            {t.admin.log}
            <Info label={t.admin.aboutLog}>{t.admin.infoLog}</Info>
          </h3>
          <ul className="list">
            {log.map((e, i) => (
              <li key={e.id} className="log-row">
                <span className="num muted small">{time(e.createdAt)}</span>
                <span className="grow ellipsis">{e.name}</span>
                <span className="muted small">{kind(e, i)}</span>
                <button className="icon-btn" type="button" disabled={busy} aria-label={t.admin.deleteEntry(kind(e, i), e.name)}
                  onClick={() => act(`/log/${e.id}`, 'DELETE')}>
                  <Trash />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {live && g.players.length > 0 && (
        <div className="row gap">
          <select className="input grow" aria-label={t.admin.removePlayerAria} value={remove} onChange={(e) => setRemove(e.target.value)}>
            <option value="">{t.admin.removePlayer}</option>
            {g.players.map((p) => (
              <option key={p.playerId} value={p.playerId}>{p.name}</option>
            ))}
          </select>
          <button className="secondary small-btn" type="button" disabled={busy || !remove}
            onClick={() => act(`/players/${remove}`, 'DELETE').then(() => setRemove(''))}>
            {t.admin.remove}
          </button>
        </div>
      )}

      <div className="row gap">
        {!live && (
          <button className="secondary grow" type="button" disabled={busy} onClick={() => act('/reopen')}>{t.admin.reopen}</button>
        )}
        {confirmDelete ? (
          <button className="danger grow" type="button" onClick={deleteGame}>{t.common.deleteForGood}</button>
        ) : (
          <button className="secondary grow" type="button" onClick={() => setConfirmDelete(true)}>{t.admin.deleteGame}</button>
        )}
        <Info label={t.admin.aboutReopen}>{t.admin.infoReopen}</Info>
      </div>

      <ErrorLine error={error} />
    </section>
  );
}
