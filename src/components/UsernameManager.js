import { useEffect, useMemo, useState } from 'react';
import { changeUsername, suggestUsernames } from '../lib/usernames';
import './UsernameManager.css';

export default function UsernameManager({ status, onChanged }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState(status?.username || '');
  const [suggestions, setSuggestions] = useState(() => suggestUsernames({ displayName: status?.display_name, email: status?.email }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const normalized = useMemo(() => username.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, ''), [username]);
  const lastChanged = status?.username_last_changed_at ? new Date(status.username_last_changed_at) : null;
  const nextChange = lastChanged ? new Date(lastChanged.getTime() + 30 * 86400000) : null;
  const canChange = !nextChange || nextChange <= new Date();
  const nextChangeLabel = nextChange ? nextChange.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  const roll = () => setSuggestions(suggestUsernames({ displayName: status?.display_name, email: status?.email }));

  useEffect(() => {
    const onProfileOpen = event => {
      if (event.target?.closest?.('.profile-button, .profile-handle')) {
        setUsername(status?.username || '');
        setError('');
        setOpen(true);
      }
    };
    document.addEventListener('click', onProfileOpen);
    return () => document.removeEventListener('click', onProfileOpen);
  }, [status?.username]);

  useEffect(() => {
    if (!open) return;
    setUsername(status?.username || '');
  }, [open, status?.username]);

  const submit = async e => {
    e.preventDefault();
    if (!canChange || normalized.length < 3) return;
    setBusy(true); setError('');
    try {
      const profile = await changeUsername(normalized);
      onChanged?.({ ...status, ...profile, username: normalized, username_chosen: true, username_last_changed_at: new Date().toISOString() });
      setOpen(false);
    } catch (err) { setError(err.message || 'Could not change your @.'); }
    finally { setBusy(false); }
  };

  if (!status?.username) return null;
  return open ? <div className="username-manager-overlay" onMouseDown={e => e.target === e.currentTarget && setOpen(false)}>
    <section className="username-manager-card" role="dialog" aria-modal="true" aria-labelledby="username-manager-title">
      <button className="username-manager-close" onClick={() => setOpen(false)} aria-label="Close username settings">×</button>
      <div className="eyebrow">YOUR FAVOURIT ID</div>
      <h2 id="username-manager-title">@{status.username}</h2>
      <p>Your @ is your permanent identity on Favourit. It is how people find and message you.</p>
      <div className="username-manager-warning">
        <strong>Before you change it</strong>
        <span>{canChange ? 'Once you save a new @, you will not be able to change it again for 30 days.' : `Your @ is locked until ${nextChangeLabel}. You cannot change it before that date.`}</span>
      </div>
      <form onSubmit={submit}>
        <label className="username-manager-input"><span>@</span><input value={username} onChange={e => setUsername(e.target.value)} maxLength={20} disabled={!canChange || busy} /></label>
        <div className="username-manager-suggestions"><div><span>Need inspiration?</span><button type="button" onClick={roll} disabled={!canChange || busy}>🎲 Roll</button></div>{suggestions.map(s => <button type="button" key={s} onClick={() => setUsername(s)} disabled={!canChange || busy}>@{s}</button>)}</div>
        {!canChange && <div className="username-manager-lock">🔒 You can change your @ again on <strong>{nextChangeLabel}</strong>.</div>}
        {error && <div className="username-manager-error">{error}</div>}
        <button className="primary full" disabled={!canChange || normalized.length < 3 || normalized === status.username || busy}>{busy ? 'Saving…' : 'Save new @'}</button>
      </form>
    </section>
  </div> : null;
}
