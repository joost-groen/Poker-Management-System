import { useEffect, useRef, type ReactNode } from 'react';
import { Back, Bars, Cards, Spade } from '../../components/Icons.tsx';
import { useAccount } from '../api.ts';
import { useOT } from '../i18n.ts';
import { setMuted, useMuted } from '../sound.ts';

export type NavKey = 'home' | 'tables' | 'leaderboard' | 'profile' | 'admin';

const Person = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

const Shield = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6z" /><path d="m9 12 2 2 4-4" />
  </svg>
);

/** Bottom bar on phones, sidebar on desktop; the way back to Poker Bank sits in the sidebar and on Play's header. */
export function OnlineNav({ active }: { active: NavKey | null }) {
  const t = useOT();
  const admin = useAccount()?.admin ?? false;
  const tab = (key: NavKey, href: string, icon: ReactNode, label: string) => (
    <a href={href} aria-current={active === key ? 'page' : undefined}>
      {icon}
      {label}
    </a>
  );
  return (
    <nav className="o-nav" aria-label={t.nav.sections} style={admin ? { gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' } : undefined}>
      <span className="o-brand">Poker Bank · {t.nav.home}</span>
      {tab('home', '#/online', <Spade />, t.nav.home)}
      {tab('tables', '#/online/tables', <Cards />, t.nav.tables)}
      {tab('leaderboard', '#/online/leaderboard', <Bars />, t.nav.leaderboard)}
      {tab('profile', '#/online/me', <Person />, t.nav.profile)}
      {admin && tab('admin', '#/online/admin', <Shield />, t.nav.admin)}
      <a className="o-exit" href="#/">
        <Back />
        {t.nav.backToBank}
      </a>
    </nav>
  );
}

export function OHeader({ title, back, children }: { title: ReactNode; back?: string; children?: ReactNode }) {
  const t = useOT();
  return (
    <header className="o-head">
      {back && (
        <a className="icon-btn" href={`#${back}`} aria-label={t.common.back}>
          <Back />
        </a>
      )}
      <h1>{title}</h1>
      {children}
    </header>
  );
}

export function OLoading() {
  const t = useOT();
  return <p className="o-muted o-center" style={{ padding: '32px 0' }}>{t.common.loading}</p>;
}

export function OError({ error }: { error: string | null }) {
  return error ? <p className="o-error" role="alert">{error}</p> : null;
}

/** Turns the table sounds on and off; remembered on this device. */
export function SoundToggle() {
  const t = useOT();
  const muted = useMuted();
  return (
    <button type="button" className="icon-btn o-sound" aria-pressed={!muted} aria-label={muted ? t.table.soundOn : t.table.soundOff} title={muted ? t.table.soundOn : t.table.soundOff} onClick={() => setMuted(!muted)}>
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
        {muted ? <path d="m16 9.5 5 5m0-5-5 5" /> : <path d="M16 9a4.5 4.5 0 0 1 0 6m2.5-8.5a8 8 0 0 1 0 11" />}
      </svg>
    </button>
  );
}

/** An in-app confirmation instead of the browser's dialog, which looks out of place in the installed app. */
export function ConfirmSheet({ text, confirm, onConfirm, onCancel }: { text: string; confirm: string; onConfirm: () => void; onCancel: () => void }) {
  const t = useOT();
  useEscape(onCancel);
  return (
    <div className="o-sheet" role="alertdialog" aria-modal="true" aria-label={text} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div>
        <p style={{ fontSize: 17 }}>{text}</p>
        <button type="button" className="o-btn danger block" autoFocus onClick={onConfirm}>{confirm}</button>
        <button type="button" className="o-btn ghost block" onClick={onCancel}>{t.common.cancel}</button>
      </div>
    </div>
  );
}

/** A bottom sheet (phones) or centred panel (desktop) with a title and a close button. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const t = useOT();
  useEscape(onClose);
  return (
    <div className="o-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="o-sheet-panel">
        <div className="o-row o-between">
          <h2 style={{ fontSize: 18, fontWeight: 500 }}>{title}</h2>
          <button type="button" className="o-btn ghost small" onClick={onClose}>{t.common.close}</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Esc closes the topmost sheet only: a replay opened from the history closes before the history does. */
const escapeStack: (() => void)[] = [];
let escapeInstalled = false;

export function useEscape(onClose: () => void) {
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    const close = () => latest.current();
    escapeStack.push(close);
    if (!escapeInstalled) {
      escapeInstalled = true;
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !escapeStack.length) return;
        e.stopImmediatePropagation();
        escapeStack[escapeStack.length - 1]();
      }, true);
    }
    return () => void escapeStack.splice(escapeStack.indexOf(close), 1);
  }, []);
}
