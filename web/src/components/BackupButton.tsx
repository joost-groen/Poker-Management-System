import { useState } from 'react';
import { downloadBackup, errorText } from '../api.ts';
import { useT } from '../i18n.ts';
import { Info } from './Info.tsx';

/** Admins: downloads Poker Bank's and Play's data together as one file. Used in Settings and on Play's Admin page. */
export function BackupButton({ className }: { className: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      await downloadBackup();
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="backup">
      <div className="row gap" style={{ alignItems: 'center' }}>
        <button type="button" className={className} disabled={busy} onClick={run}>{busy ? t.common.loading : t.settings.backup}</button>
        <Info label={t.settings.aboutBackup}>{t.settings.infoBackup}</Info>
      </div>
      {error && <p className="error" role="alert" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}
