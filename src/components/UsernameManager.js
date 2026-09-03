import { useMemo, useState } from 'react';
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
  const roll = () => setSuggestions(suggestUsernames({ displayName: status?.display_name, email: status?.email }));
  const submit = async e => {
    e.preventDefault(); if (!canChange || normalized.length < 3) return;
    setBusy(true); setError('');
    try { const profile = await changeUsername(normalized); onChanged?.({ ...status, ...profile, username: normalized, username_chosen: true, username_last_changed_at: new Date().toISOString() }); setOpen(false); }
    catch (err) { setError(err.message || 'Could not change your @.'); }
    finally { setBusy(false); }
  };
  return <>
    <button className="username-chip" onClick={() => { setUsername(status?.username || ''); setError(''); setOpen(true); }} aria-label="Manage username">@{status?.username || 'username'}</button>
    {open && <div className="username-manager-overlay" onMouseDown={e => e.target === e.currentTarget && setOpen(false)}><section className="username-manager-card">
      <button className="username-manager-close" onClick={() => setOpen(false)}>×</button>
      <div className="eyebrow">YOUR FAVOURIT ID</div><h2>@{status?.username}</h2><p>Your @ is how people find you. You can change it once every 30 days.</p>
      <form onSubmit={submit}><label className="username-manager-input"><span>@</span><input value={username} onChange={e => setUsername(e.target.value)} maxLength={20}/></label>
      <div className="username-manager-suggestions"><div><span>Need inspiration?</span><button type="button" onClick={roll}>🎲 Roll</button></div>{suggestions.map(s => <button type="button" key={s} onClick={() => setUsername(s)}>@{s}</button>)}</div>
      {!canChange && <div className="username-manager-lock">🔒 You can change your @ again on {nextChange.toLocaleDateString()}.</div>}
      {error && <div className="username-manager-error">{error}</div>}
      <button className="primary full" disabled={!canChange || normalized.length < 3 || normalized === status?.username || busy}>{busy ? 'Saving…' : 'Save new @'}</button></form>
    </section></div>}
  </>;
}
