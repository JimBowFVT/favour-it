import { useState } from 'react';
import { signIn, signUp } from '../lib/auth';

function Logo() {
  return <div className="logo"><span>Favour</span><i>it</i></div>;
}

export default function AuthGate() {
  const [mode, setMode] = useState('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (mode === 'signup' && !displayName.trim()) return setError('Please enter your display name.');
    if (!email.trim() || !password) return setError('Enter your email and password.');
    if (password.length < 6) return setError('Password must be at least 6 characters.');

    setBusy(true);
    try {
      const result = mode === 'login'
        ? await signIn(email.trim(), password)
        : await signUp(email.trim(), password, displayName.trim());
      if (result.error) throw result.error;
      if (mode === 'signup' && !result.data?.session) {
        setMessage('Account created. Check your email to confirm your account, then sign in.');
        setMode('login');
        setPassword('');
      } else {
        setMessage('Signed in. Loading your Favourit account…');
      }
    } catch (err) {
      setError(err.message || 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <Logo />
        <div className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'JOIN FAVOURIT'}</div>
        <h1>{mode === 'login' ? 'Welcome back.' : 'Start earning FAV.'}</h1>
        <p>{mode === 'login' ? 'Sign in to your marketplace account.' : 'Create an account and turn your skills into purchasing power.'}</p>
        {mode === 'signup' && <input className="auth-input" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Display name" autoComplete="name" />}
        <input className="auth-input" value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Email address" autoComplete="email" />
        <input className="auth-input" value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        {error && <div className="auth-error">{error}</div>}
        {message && <div className="auth-message">{message}</div>}
        <button className="primary full" disabled={busy} type="submit">{busy ? 'Please wait…' : mode === 'login' ? 'Sign in →' : 'Create account →'}</button>
        <div className="auth-switch">
          {mode === 'login' ? 'New to Favourit?' : 'Already have an account?'}{' '}
          <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage(''); }}>
            {mode === 'login' ? 'Create one' : 'Sign in'}
          </button>
        </div>
      </form>
    </section>
  );
}
