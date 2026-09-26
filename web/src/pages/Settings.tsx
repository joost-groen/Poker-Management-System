import { useState, type FormEvent } from 'react';
import type { Meta, Player } from '../../../shared/types.ts';
import { api, errorText, isNative, lockAdmin, showConnect, unlockAdmin, useAdmin } from '../api.ts';
import { Info } from '../components/Info.tsx';
import { Pencil, Restore, Trash } from '../components/Icons.tsx';
import { ErrorLine, Header, TabBar } from '../components/Layout.tsx';
import { setLang, useLang, useT, type Lang } from '../i18n.ts';
import { useApi } from '../useApi.ts';

const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'de', label: 'Deutsch' },
];

export function Settings() {
  const t = useT();
  const lang = useLang();
  const admin = useAdmin();
  const meta = useApi<Meta>('/meta');

  return (
    <>
      <main className="page">
        <Header title={t.settings.title} />

        <section className="stack">
          <h2 className="label">{t.settings.language}</h2>
          <div className="segmented" role="group" aria-label={t.settings.language}>
            {LANGS.map((l) => (
              <button key={l.id} type="button" lang={l.id} aria-pressed={lang === l.id} onClick={() => setLang(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
        </section>

        <section className="stack">
          <h2 className="label">
            {t.settings.admin}
            <Info label={t.settings.aboutAdmin}>{t.settings.infoAdmin}</Info>
          </h2>
          {meta.data && !meta.data.admin && !admin ? (
            <p className="muted">{t.settings.adminOff}</p>
          ) : admin ? (
            <>
              <div className="check ok">
                <span className="grow">{t.settings.adminOn}</span>
                <button className="secondary small-btn" type="button" onClick={lockAdmin}>{t.settings.lock}</button>
              </div>
              <ManagePlayers />
            </>
          ) : (
            meta.data && <Unlock />
          )}
        </section>

        {(isNative || meta.data?.auth) && (
          <section className="stack">
            <h2 className="label">{t.settings.connection}</h2>
            <button className="secondary" type="button" onClick={showConnect}>{t.settings.changeConnection}</button>
          </section>
        )}

        <ErrorLine error={meta.error} />
      </main>
      <TabBar active="settings" />
    </>
  );
}

function Unlock() {
  const t = useT();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await unlockAdmin(pin);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="row gap">
        <input className="input grow" type="password" autoComplete="off" aria-label={t.settings.adminPin}
          placeholder={t.settings.adminPin} value={pin} onChange={(e) => setPin(e.target.value)} />
        <button className="pill-btn" type="submit" disabled={busy || !pin}>{t.settings.unlock}</button>
      </div>
      <ErrorLine error={error} />
    </form>
  );
}

function ManagePlayers() {
  const t = useT();
  const players = useApi<Player[]>('/players?all=1');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<string | null>) => {
    try {
      setNote(await fn());
      setError(null);
      setConfirm(null);
      await players.reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const rename = (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    run(async () => {
      await api(`/players/${editing.id}`, 'PATCH', { name: editing.name });
      setEditing(null);
      return null;
    });
  };

  const remove = (p: Player) =>
    run(async () => {
      const res = await api<{ archived: boolean }>(`/players/${p.id}`, 'DELETE');
      return res.archived ? t.settings.wasArchived(p.name) : t.settings.wasDeleted(p.name);
    });

  const restore = (p: Player) => run(async () => (await api(`/players/${p.id}/restore`, 'POST'), null));

  const active = players.data?.filter((p) => !p.archived) ?? [];
  const archived = players.data?.filter((p) => p.archived) ?? [];

  const row = (p: Player) =>
    editing?.id === p.id ? (
      <li key={p.id}>
        <form className="row gap manage-row" onSubmit={rename}>
          <input className="input grow" aria-label={t.player.name} maxLength={40} autoFocus value={editing.name}
            onChange={(e) => setEditing({ id: p.id, name: e.target.value })} />
          <button className="pill-btn" type="submit" disabled={!editing.name.trim()}>{t.common.save}</button>
          <button className="secondary small-btn" type="button" onClick={() => setEditing(null)}>{t.common.cancel}</button>
        </form>
      </li>
    ) : (
      <li key={p.id} className="row gap manage-row">
        <a className="grow strong ellipsis" href={`#/player/${p.id}`}>{p.name}</a>
        <button className="icon-btn" type="button" aria-label={t.settings.renameAria(p.name)} onClick={() => setEditing({ id: p.id, name: p.name })}>
          <Pencil />
        </button>
        {p.archived ? (
          <button className="icon-btn" type="button" aria-label={t.settings.restoreAria(p.name)} onClick={() => restore(p)}>
            <Restore />
          </button>
        ) : confirm === p.id ? (
          <button className="danger small-btn" type="button" onClick={() => remove(p)}>{t.common.delete}</button>
        ) : (
          <button className="icon-btn" type="button" aria-label={t.settings.deleteAria(p.name)} onClick={() => setConfirm(p.id)}>
            <Trash />
          </button>
        )}
      </li>
    );

  return (
    <div className="stack">
      <h3 className="label">
        {t.settings.managePlayers}
        <Info label={t.settings.aboutDelete}>{t.settings.infoDelete}</Info>
      </h3>
      <ul className="list">{active.map(row)}</ul>
      {archived.length > 0 && (
        <>
          <h3 className="label">{t.settings.archived}</h3>
          <ul className="list">{archived.map(row)}</ul>
        </>
      )}
      {note && <p className="muted small" role="status">{note}</p>}
      <ErrorLine error={error ?? players.error} />
    </div>
  );
}
