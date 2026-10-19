import { useEffect, useState, type FormEvent } from 'react';
import { AVATARS, type SessionResponse } from '../../../../shared/online.ts';
import { Info } from '../../components/Info.tsx';
import { go } from '../../router.ts';
import { oapi, onlineErrorText, setSession, useAccount } from '../api.ts';
import { OError, OHeader } from '../components/Nav.tsx';
import { useOT } from '../i18n.ts';

/** Where pages send people who need an account first. */
export function loginPath(next: string): string {
  return `/online/login/${encodeURIComponent(next)}`;
}

/** Pages for signed-in players only send everyone else to sign in, and back afterwards. */
export function useRequireAccount(here: string) {
  const account = useAccount();
  useEffect(() => {
    if (!account) go(loginPath(here), true);
  }, [account, here]);
  return account;
}

export function Auth({ next }: { next: string }) {
  const t = useOT();
  const account = useAccount();
  const [mode, setMode] = useState<'signIn' | 'register'>('signIn');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [code, setCode] = useState('');
  const [asAdmin, setAsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (account) go(next, true);
  }, [account, next]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = mode === 'signIn'
        ? await oapi<SessionResponse>('/login', 'POST', { username, password })
        : await oapi<SessionResponse>('/register', 'POST', { username, password, avatar, code, admin: asAdmin });
      setSession(res);
    } catch (err) {
      setError(onlineErrorText(err));
      setBusy(false);
    }
  };

  return (
    <main className="o-page bare narrow">
      <OHeader title={mode === 'signIn' ? t.auth.signIn : t.auth.register} back="/online">
        <Info label={t.auth.aboutAccount}>{t.auth.infoAccount}</Info>
      </OHeader>
      <div className="o-seg">
        <button type="button" aria-pressed={mode === 'signIn'} onClick={() => setMode('signIn')}>{t.auth.signIn}</button>
        <button type="button" aria-pressed={mode === 'register'} onClick={() => setMode('register')}>{t.auth.register}</button>
      </div>
      <form className="o-section" onSubmit={submit}>
        <span className="o-label">
          <label htmlFor="o-user">{t.auth.username}</label>
          {mode === 'register' && <Info label={t.auth.aboutRules}>{t.auth.hint}</Info>}
        </span>
        <input id="o-user" className="o-input" autoComplete="username" autoCapitalize="off" autoCorrect="off" value={username} onChange={(e) => setUsername(e.target.value)} />
        <label className="o-label" htmlFor="o-pass">{t.auth.password}</label>
        <input id="o-pass" className="o-input" type="password" autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
        {mode === 'register' && (
          <>
            <span className="o-label">
              <label htmlFor="o-code">{asAdmin ? t.auth.adminCode : t.auth.inviteCode}</label>
              <Info label={t.auth.aboutCodes}>{t.auth.infoCodes}</Info>
            </span>
            <input id="o-code" className="o-input" type="password" autoComplete="off" autoCapitalize="off" autoCorrect="off" value={code} onChange={(e) => setCode(e.target.value)} />
            <label className="o-switch">
              <input type="checkbox" checked={asAdmin} onChange={(e) => setAsAdmin(e.target.checked)} />
              <strong>{t.auth.asAdmin}</strong>
            </label>
            <span className="o-label">{t.auth.avatar}</span>
            <div className="o-avatars" role="group" aria-label={t.auth.avatar}>
              {AVATARS.map((a) => (
                <button key={a} type="button" aria-pressed={avatar === a} onClick={() => setAvatar(a)}>{a}</button>
              ))}
            </div>
          </>
        )}
        <OError error={error} />
        <button className="o-btn block" type="submit" disabled={busy || !username.trim() || !password || (mode === 'register' && !code.trim())}>
          {mode === 'signIn' ? t.auth.submitSignIn : t.auth.submitRegister}
        </button>
      </form>
    </main>
  );
}
