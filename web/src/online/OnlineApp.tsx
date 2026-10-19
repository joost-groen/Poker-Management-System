import { useEffect } from 'react';
import type { Account } from '../../../shared/online.ts';
import { oapi, setAccount, useAccount } from './api.ts';
import { Admin } from './pages/Admin.tsx';
import './online.css';
import { Auth } from './pages/Auth.tsx';
import { Bots } from './pages/Bots.tsx';
import { CreateTable } from './pages/CreateTable.tsx';
import { Home } from './pages/Home.tsx';
import { Chart, Drill } from './pages/Learn.tsx';
import { Leaderboard } from './pages/Leaderboard.tsx';
import { Lobby } from './pages/Lobby.tsx';
import { Profile } from './pages/Profile.tsx';
import { TablePage } from './pages/TablePage.tsx';

/** The online section: routes below #/online, its own look and navigation. */
export default function OnlineApp({ path }: { path: string[] }) {
  useEffect(() => {
    document.documentElement.classList.add('online-mode');
    return () => document.documentElement.classList.remove('online-mode');
  }, []);
  // The stored account may be stale (made admin, or no longer admin): refresh it once per visit.
  const signedIn = Boolean(useAccount());
  useEffect(() => {
    if (signedIn) oapi<Account>('/me').then(setAccount, () => {});
  }, [signedIn]);

  const [page, arg] = path;
  return <div className="online">{route(page, arg)}</div>;
}

function route(page: string | undefined, arg: string | undefined) {
  switch (page) {
    case 'login':
      return <Auth next={arg ? decodeURIComponent(arg) : '/online'} />;
    case 'practice':
      return <Bots key="practice" mode="practice" />;
    case 'learn':
      return <Bots key="learn" mode="learn" />;
    case 'chart':
      return <Chart />;
    case 'drill':
      return <Drill />;
    case 'tables':
      return <Lobby />;
    case 'new':
      return <CreateTable />;
    case 't':
      if (arg) return <TablePage key={arg} code={arg.toUpperCase()} />;
      break;
    case 'admin':
      return <Admin />;
    case 'leaderboard':
      return <Leaderboard />;
    case 'me':
      return <Profile />;
    case 'player':
      if (Number(arg)) return <Profile key={arg} id={Number(arg)} />;
  }
  return <Home />;
}
