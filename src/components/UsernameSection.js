import { useEffect, useMemo, useState } from 'react';
import { changeUsername, getMyUsernameStatus, suggestUsernames } from '../lib/usernames';
import './UsernameSection.css';

const THIRTY_DAYS_MS = 30 * 86400000;

export default function UsernameSection({ status: initialStatus = null, compact = false }) {
  const [status, setStatus] = useState(initialStatus);
  const [username, setUsername] = useState(initialStatus?.username || '');
  const [suggestions, setSuggestions] = useState(() => suggestUsernames({ displayName: initialStatus?.display_name, email: initialStatus?.email }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    if (initialStatus?.username) {
      setStatus(initialStatus);
      setUsername(initialStatus.username);
      return;
    }
    let active = true;
    getMyUsernameStatus().then(next => {
      if (!active || !next) return;
      setStatus(next);
      setUsername(next.username || '');
    }).catch(() => {});
    return () => { active = false; };
  }, [initialStatus?.username, initialStatus?.username_last_changed_at]);

  const normalized = useMemo(() => username.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, ''), [username]);
  const lastChanged = status?.username_last_changed_at ? new Date(status.username_last_changed_at) : null;
  const nextChange = lastChanged ? new Date(lastChanged.getTime() + THIRTY_DAYS_MS) : null;
  const canChange = !nextChange || nextChange <= new Date();
  const nextChangeLabel = nextChange ? nextChange.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';

  const roll = () => setSuggestions(suggestUsernames({ displayName: status?.display_name, email: status?.email }));

  const submit = async event => {
    event.preventDefault();
    if (!canChange || busy || normalized.length < 3 || normalized === status?.username) return;
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const profile = await changeUsername(normalized);
      const next = {
        ...status,
        ...profile,
        username: normalized,
        username_chosen: true,
        username_last_changed_at: profile?.username_last_changed_at || new Date().toISOString(),
      };
      setStatus(next);
      setUsername(normalized);
      setSaved(`Your Favourit ID is now @${normalized}.`);
      window.dispatchEvent(new CustomEvent('favourit:username-changed', { detail: { status: next } }));
    } catch (err) {
      setError(err.message || 'Could not change your @.');
    } finally {
      setBusy(false);
    }
  };

  if (!status?.username) return <div className="username-inline-muted">Loading your Favourit ID…</div>;

  return <div className={`username-inline ${compact ? 'compact' : ''}`}>
    <div className="username-inline-top">
      <div><strong>@{status.username}</strong><small>Your public Favourit ID</small></div>
      <span className={canChange ? 'available' : ''}>{canChange ? 'Change available' : 'Locked'}</span>
    </div>
    <div className="username-inline-warning">
      <strong>30-day change window</strong>
      <span>{canChange ? 'Before saving: once you change your @, you cannot change it again for 30 days.' : `You can change your @ again on ${nextChangeLabel}.`}</span>
    </div>
    <form onSubmit={submit}>
      <label className="username-inline-input"><span>@</span><input value={username} onChange={event => setUsername(event.target.value)} maxLength={20} disabled={!canChange || busy} aria-label="Favourit username" /></label>
      {canChange && <div className="username-inline-suggestions"><div><small>✨ Suggestions for you</small><button type="button" onClick={roll} disabled={busy} aria-label="Generate new username suggestions">🎲 Roll</button></div>{suggestions.map(item => <button type="button" key={item} onClick={() => setUsername(item)} disabled={busy}>@{item}</button>)}</div>}
      {error && <div className="username-inline-error">{error}</div>}
      {saved && <div className="username-inline-success">✓ {saved}</div>}
      <button className="primary" disabled={!canChange || busy || normalized.length < 3 || normalized === status.username}>{busy ? 'Saving…' : 'Save new @'}</button>
    </form>
  </div>;
}
