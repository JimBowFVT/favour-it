import { useMemo, useState } from 'react';
import { completeUsername, suggestUsernames } from '../lib/usernames';
import './UsernameGate.css';

export default function UsernameGate({ displayName, email, onComplete }) {
  const [username, setUsername] = useState('');
  const [suggestions, setSuggestions] = useState(() => suggestUsernames({ displayName, email }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const normalized = useMemo(() => username.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, ''), [username]);
  const roll = () => setSuggestions(suggestUsernames({ displayName, email }));
  const submit = async e => {
    e.preventDefault();
    if (normalized.length < 3) return setError('Your @ must be at least 3 characters.');
    setBusy(true); setError('');
    try { const profile = await completeUsername(normalized); onComplete(profile); }
    catch (err) { setError(err.message || 'Could not save your username.'); }
    finally { setBusy(false); }
  };
  return <div className="username-gate"><div className="username-glow"/><form className="username-card" onSubmit={submit}>
    <div className="username-brand"><span>Favour</span><i>it</i></div>
    <div className="eyebrow">ONE LAST STEP</div>
    <h1>Choose your <span>@.</span></h1>
    <p>Your @username is how people find and message you on Favourit. You can use letters, numbers and underscores.</p>
    <label className="username-input-wrap"><span>@</span><input autoFocus value={username} onChange={e=>setUsername(e.target.value)} maxLength={20} placeholder="yourname" autoComplete="off"/><small>{normalized.length}/20</small></label>
    <div className="suggestion-heading"><span>✨ Suggestions for you</span><button type="button" onClick={roll} aria-label="Generate new username suggestions">🎲 Roll</button></div>
    <div className="username-suggestions">{suggestions.map(s=><button type="button" key={s} onClick={()=>setUsername(s)}>@{s}</button>)}</div>
    {error && <div className="username-error">{error}</div>}
    <button className="primary full username-continue" disabled={busy || normalized.length < 3}>{busy ? 'Saving your @…' : 'Claim my @ →'}</button>
    <small className="username-note">Your @ is unique. Choose something you will be happy to be known by.</small>
  </form></div>;
}
