import { useState } from 'react';
import { signIn, signUp } from '../lib/auth';
import FavouritLoader from './FavouritLoader';

const AUTH_TIMEOUT_MS = 15000;
const USERNAME_ONBOARDING_KEY = 'favourit_username_onboarding_pending';
function Logo() { return <div className="logo"><span>Favour</span><i>it</i></div>; }
function withTimeout(promise, ms, message) { let timer; const timeout = new Promise((_, reject) => { timer = window.setTimeout(() => reject(new Error(message)), ms); }); return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer)); }

export default function AuthGate() {
  const [mode, setMode] = useState('login'); const [displayName, setDisplayName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault(); setError(''); setMessage('');
    if (mode === 'signup' && !displayName.trim()) return setError('Please enter your display name.');
    if (!email.trim() || !password) return setError('Enter your email and password.');
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    setBusy(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const result = mode === 'login' ? await withTimeout(signIn(cleanEmail, password), AUTH_TIMEOUT_MS, 'Sign in timed out. Check your connection and try again.') : await withTimeout(signUp(cleanEmail, password, displayName.trim()), AUTH_TIMEOUT_MS, 'Account creation timed out. Check your connection and try again.');
      if (result.error) throw result.error;
      if (mode === 'signup') {
        window.localStorage.setItem(USERNAME_ONBOARDING_KEY, JSON.stringify({ email: cleanEmail, userId: result.data?.user?.id || null, createdAt: Date.now() }));
        if (!result.data?.session) { setMessage('Account created. Check your email to confirm your account, then sign in.'); setMode('login'); setPassword(''); } else setMessage('Account created successfully. Let’s choose your @.');
      } else setMessage('Signed in successfully.');
    } catch (err) { setError(err.message || 'Authentication failed.'); }
    finally { setBusy(false); }
  };
  if (busy) return <FavouritLoader title={mode === 'signup' ? 'Creating your Favourit account' : 'Signing you in'} subtitle={mode === 'signup' ? 'Setting up your profile and secure wallet…' : 'Verifying your credentials securely…'} />;
  return <section className="auth-page"><form className="auth-card" onSubmit={submit}><Logo/><div className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'JOIN FAVOURIT'}</div><h1>{mode === 'login' ? 'Welcome back.' : 'Start earning FAV.'}</h1><p>{mode === 'login' ? 'Sign in to your marketplace account.' : 'Create an account and turn your skills into purchasing power.'}</p>{mode === 'signup' && <input className="auth-input" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Display name" autoComplete="name" />}<input className="auth-input" value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Email address" autoComplete="email" /><input className="auth-input" value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />{error && <div className="auth-error">{error}</div>}{message && <div className="auth-message">{message}</div>}<button className="primary full" disabled={busy} type="submit">{mode === 'login' ? 'Sign in →' : 'Create account →'}</button><div className="auth-switch">{mode === 'login' ? 'New to Favourit?' : 'Already have an account?'}{' '}<button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage(''); }}>{mode === 'login' ? 'Create one' : 'Sign in'}</button></div></form></section>;
}
