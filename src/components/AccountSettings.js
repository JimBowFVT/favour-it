import { useEffect, useState } from 'react';
import { getAccountSecurityStatus, changePassword, sendPasswordReset, updateProfileBasics } from '../lib/accountSecurity';

export default function AccountSettings({ session, profile, onProfileChanged, onClose }) {
  const [displayName, setDisplayName] = useState(profile?.display_name || session?.user?.user_metadata?.display_name || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [password, setPassword] = useState('');
  const [security, setSecurity] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { getAccountSecurityStatus().then(setSecurity).catch(() => {}); }, []);

  const saveProfile = async event => {
    event.preventDefault(); setBusy(true); setError(''); setSaved('');
    try { const next = await updateProfileBasics({ displayName, bio }); onProfileChanged?.(next); setSaved('Profile updated.'); }
    catch (err) { setError(err.message || 'Could not update your profile.'); }
    finally { setBusy(false); }
  };

  const savePassword = async event => {
    event.preventDefault(); setBusy(true); setError(''); setSaved('');
    try { await changePassword(password); setPassword(''); setSaved('Password updated successfully.'); }
    catch (err) { setError(err.message || 'Could not update your password.'); }
    finally { setBusy(false); }
  };

  const resetPassword = async () => {
    setBusy(true); setError(''); setSaved('');
    try { await sendPasswordReset(session?.user?.email, `${window.location.origin}/`); setSaved('Password reset instructions were sent to your email.'); }
    catch (err) { setError(err.message || 'Could not send reset instructions.'); }
    finally { setBusy(false); }
  };

  return <div className="settings-overlay" onMouseDown={e => e.target === e.currentTarget && onClose?.()}><section className="settings-card" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <button className="username-manager-close" onClick={onClose} aria-label="Close settings">×</button>
    <div className="eyebrow">ACCOUNT & SECURITY</div><h2 id="settings-title">Your settings.</h2><p className="settings-intro">Keep your profile current and your account protected.</p>
    <form onSubmit={saveProfile} className="settings-section"><h3>Profile</h3><label>Display name<input value={displayName} maxLength={80} onChange={e => setDisplayName(e.target.value)} /></label><label>Bio<textarea value={bio} maxLength={500} rows="4" onChange={e => setBio(e.target.value)} /><small>{bio.length}/500</small></label><button className="primary" disabled={busy || !displayName.trim()}>Save profile</button></form>
    <div className="settings-section"><h3>Sign-in security</h3><div className="security-row"><span>Email</span><strong>{security?.email || session?.user?.email || '—'}</strong><em>{security?.emailConfirmedAt ? 'Verified' : 'Needs verification'}</em></div><div className="security-row"><span>Last sign in</span><strong>{security?.lastSignInAt ? new Date(security.lastSignInAt).toLocaleString() : '—'}</strong></div><form onSubmit={savePassword}><label>New password<input type="password" value={password} minLength={8} maxLength={128} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" /></label><button className="secondary" disabled={busy || password.length < 8}>Change password</button></form><button className="text-button" disabled={busy} onClick={resetPassword}>Send password reset email</button></div>
    {saved && <div className="settings-success">✓ {saved}</div>}{error && <div className="username-manager-error">{error}</div>}
  </section></div>;
}
