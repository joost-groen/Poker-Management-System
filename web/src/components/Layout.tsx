import type { ReactNode } from 'react';
import { useLang, useT } from '../i18n.ts';
import { PLAY_LABEL } from '../online/label.ts';
import { Back, Bars, Cards, Gear, Screen, Spade } from './Icons.tsx';

export function Header({ title, back, children }: { title: ReactNode; back?: string; children?: ReactNode }) {
  const t = useT();
  return (
    <header className="header">
      {back && (
        <a className="icon-btn back" href={`#${back}`} aria-label={t.nav.back}>
          <Back />
        </a>
      )}
      <h1>{title}</h1>
      {children}
    </header>
  );
}

/** Bottom tab bar on phones; a sidebar with the brand and TV mode on desktop. "Play" opens the online section. */
export function TabBar({ active }: { active: 'games' | 'ranking' | 'settings' }) {
  const t = useT();
  const lang = useLang();
  const tab = (key: typeof active, href: string, icon: ReactNode, label: string) => (
    <a href={href} aria-current={active === key ? 'page' : undefined}>
      {icon}
      {label}
    </a>
  );
  return (
    <nav className="tabbar" aria-label={t.nav.sections} style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
      <span className="brand">Poker Bank</span>
      {tab('games', '#/', <Cards />, t.nav.games)}
      {tab('ranking', '#/ranking', <Bars />, t.nav.ranking)}
      <a href="#/online">
        <Spade />
        {PLAY_LABEL[lang]}
      </a>
      {tab('settings', '#/settings', <Gear />, t.nav.settings)}
      <a className="tv-link" href="#/tv">
        <Screen />
        {t.nav.tv}
      </a>
    </nav>
  );
}

export function Loading() {
  const t = useT();
  return <p className="muted center pad">{t.common.loading}</p>;
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? <p className="error" role="alert">{error}</p> : null;
}
