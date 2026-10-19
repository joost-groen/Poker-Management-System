import { useState, type FormEvent } from 'react';
import type { AdminAccount, TableSummary } from '../../../../shared/online.ts';
import { BackupButton } from '../../components/BackupButton.tsx';
import { day } from '../../format.ts';
import { oapi, onlineErrorText } from '../api.ts';
import { ConfirmSheet, OError, OHeader, OLoading, OnlineNav, Sheet } from '../components/Nav.tsx';
import { amount } from '../format.ts';
import { useOT } from '../i18n.ts';
import { useOnline } from '../useOnline.ts';
import { useRequireAccount } from './Auth.tsx';
import { ModeBadge } from './Lobby.tsx';

/** Admins only: every account (admin rights, blocking, passwords, deleting) and every open table. */
export function Admin() {
  const t = useOT();
  const account = useRequireAccount('/online/admin');
  const accounts = useOnline<AdminAccount[]>(account?.admin ? '/admin/accounts' : null);
  const tables = useOnline<TableSummary[]>(account?.admin ? '/tables' : null);
  const [open, setOpen] = useState<AdminAccount | null>(null);
  const [closing, setClosing] = useState<TableSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (account && !account.admin) {
    return (
      <>
        <main className="o-page narrow">
          <OHeader title={t.admin.title} />
          <OError error={t.errors.admin_required()} />
        </main>
        <OnlineNav active={null} />
      </>
    );
  }

  const closeTable = async (x: TableSummary) => {
    setClosing(null);
    try {
      await oapi(`/tables/${x.code}/close`, 'POST');
      setError(null);
      await tables.reload();
    } catch (err) {
      setError(onlineErrorText(err));
    }
  };
  const live = (tables.data ?? []).filter((x) => x.status === 'open');

  return (
    <>
      <main className="o-page narrow">
        <OHeader title={t.admin.title} />
        <OError error={error ?? accounts.error ?? tables.error} />

        <BackupButton className="o-btn ghost" />

        <section className="o-section">
          <h2 className="o-label">{t.admin.accounts}</h2>
          {!accounts.data ? <OLoading /> : (
            <ul className="o-list">
              {accounts.data.map((a) => (
                <li key={a.id}>
                  <button type="button" className="o-item" onClick={() => setOpen(a)}>
                    <span className="o-avatar">{a.avatar}</span>
                    <span className="grow">
                      <span className="title">{a.username}{a.id === account?.id ? ` · ${t.common.you}` : ''}</span>
                      <span className="o-muted o-small">{t.admin.activity(a.tables, a.hands)}</span>
                    </span>
                    {a.admin && <span className="o-badge cash">{t.admin.admin}</span>}
                    {a.blocked && <span className="o-badge o-neg">{t.admin.blocked}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="o-section">
          <h2 className="o-label">{t.admin.tables}</h2>
          {!tables.data ? <OLoading /> : live.length === 0 ? <p className="o-note">{t.lobby.none}</p> : (
            <ul className="o-list">
              {live.map((x) => (
                <li key={x.code} className="o-item">
                  <a className="grow" href={`#/online/t/${x.code}`}>
                    <span className="title">{x.name}</span>
                    <span className="o-muted o-small">
                      {x.host.username} · {amount(x.mode, x.sb)}/{amount(x.mode, x.bb)} · {t.lobby.seated(x.seated, x.maxSeats)}
                    </span>
                  </a>
                  <ModeBadge mode={x.mode} />
                  <button type="button" className="o-btn danger small" onClick={() => setClosing(x)}>{t.live.end}</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <OnlineNav active="admin" />

      {open && (
        <AccountSheet
          account={open}
          self={open.id === account?.id}
          onClose={() => setOpen(null)}
          onChanged={async () => {
            setOpen(null);
            await accounts.reload();
          }}
        />
      )}
      {closing && (
        <ConfirmSheet text={t.admin.endTable(closing.name)} confirm={t.live.end} onCancel={() => setClosing(null)} onConfirm={() => closeTable(closing)} />
      )}
    </>
  );
}

function AccountSheet({ account: a, self, onClose, onChanged }: { account: AdminAccount; self: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const t = useOT();
  const [password, setPassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(onlineErrorText(err));
      setBusy(false);
    }
  };
  const patch = (body: object) => run(() => oapi(`/admin/accounts/${a.id}`, 'PATCH', body));
  const reset = (e: FormEvent) => {
    e.preventDefault();
    void patch({ password });
  };

  return (
    <Sheet title={`${a.avatar} ${a.username}`} onClose={onClose}>
      <p className="o-muted o-small">{t.admin.since(day(a.createdAt))} · {t.admin.activity(a.tables, a.hands)}</p>
      {!self && (
        <div className="o-toolbar">
          <button type="button" className="o-btn ghost" disabled={busy} onClick={() => patch({ admin: !a.admin })}>
            {a.admin ? t.admin.removeAdmin : t.admin.makeAdmin}
          </button>
          <button type="button" className={`o-btn ${a.blocked ? 'ghost' : 'danger'}`} disabled={busy} onClick={() => patch({ blocked: !a.blocked })}>
            {a.blocked ? t.admin.unblock : t.admin.block}
          </button>
        </div>
      )}
      <form className="o-row" onSubmit={reset}>
        <input className="o-input" type="password" autoComplete="new-password" placeholder={t.admin.newPassword} aria-label={t.admin.newPassword}
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit" className="o-btn small" disabled={busy || password.length < 6}>{t.admin.setPassword}</button>
      </form>
      {!self && (
        confirmDelete ? (
          <button type="button" className="o-btn danger block" disabled={busy} onClick={() => run(() => oapi(`/admin/accounts/${a.id}`, 'DELETE'))}>
            {t.admin.deleteConfirm(a.username)}
          </button>
        ) : (
          <button type="button" className="o-btn ghost block" disabled={busy} onClick={() => setConfirmDelete(true)}>{t.admin.delete}</button>
        )
      )}
      <OError error={error} />
    </Sheet>
  );
}
