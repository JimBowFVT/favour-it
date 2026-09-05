import { useEffect, useState } from 'react';
import { getAccountSecurityStatus, changePassword, sendPasswordReset, updateProfileBasics, getMyPreferredLanguage, updateMyPreferredLanguage } from '../lib/accountSecurity';
import { getMySocialGraph, unblockUser } from '../lib/social';
import { languages, normalizeLanguageCode } from '../data/languages';
import './AccountSettings.css';

export default function AccountSettings({ session, profile, onProfileChanged, onClose }) {
  const [displayName, setDisplayName] = useState(profile?.display_name || session?.user?.user_metadata?.display_name || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [language, setLanguage] = useState(normalizeLanguageCode(profile?.preferred_language || 'en'));
  const [password, setPassword] = useState('');
  const [security, setSecurity] = useState(null);
  const [blocked, setBlocked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [unblocking, setUnblocking] = useState(null);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  const loadBlocked = async () => {
    try { const graph = await getMySocialGraph(); setBlocked(graph?.blocked || []); } catch (_) {}
  };

  useEffect(() => {
    getAccountSecurityStatus().then(setSecurity).catch(() => {});
    getMyPreferredLanguage().then(value => setLanguage(normalizeLanguageCode(value))).catch(() => {});
    loadBlocked();
  }, []);

  useEffect(() => {
    setDisplayName(profile?.display_name || session?.user?.user_metadata?.display_name || '');
    setBio(profile?.bio || '');
    if (profile?.preferred_language) setLanguage(normalizeLanguageCode(profile.preferred_language));
  }, [profile, session?.user?.id]);

  const saveProfile = async e => {
    e.preventDefault(); setBusy(true); setError(''); setSaved('');
    try { const next = await updateProfileBasics({ displayName, bio }); onProfileChanged?.({ ...profile, ...next, preferred_language: language }); setSaved('Profile updated.'); }
    catch (err) { setError(err.message || 'Could not update your profile.'); }
    finally { setBusy(false); }
  };

  const saveLanguage = async e => {
    e.preventDefault(); setBusy(true); setError(''); setSaved('');
    try {
      const savedLanguage = await updateMyPreferredLanguage(language);
      setLanguage(savedLanguage);
      onProfileChanged?.({ ...profile, preferred_language: savedLanguage });
      window.dispatchEvent(new CustomEvent('favourit:language-changed', { detail: { language: savedLanguage } }));
      setSaved('Language preference updated.');
    } catch (err) { setError(err.message || 'Could not update your language.'); }
    finally { setBusy(false); }
  };

  const savePassword = async e => { e.preventDefault(); setBusy(true); setError(''); setSaved(''); try { await changePassword(password); setPassword(''); setSaved('Password updated successfully.'); } catch (err) { setError(err.message || 'Could not update your password.'); } finally { setBusy(false); } };
  const resetPassword = async () => { setBusy(true); setError(''); setSaved(''); try { await sendPasswordReset(session?.user?.email, `${window.location.origin}/`); setSaved('Password reset instructions were sent to your email.'); } catch (err) { setError(err.message || 'Could not send reset instructions.'); } finally { setBusy(false); } };
  const handleUnblock = async user => { setUnblocking(user.id); setError(''); try { await unblockUser(user.id); setBlocked(current => current.filter(item => item.id !== user.id)); setSaved(`@${user.username || 'member'} was unblocked.`); } catch (err) { setError(err.message || 'Could not unblock this account.'); } finally { setUnblocking(null); } };

  return <div className="settings-overlay" onMouseDown={e => e.target === e.currentTarget && onClose?.()}><section className="settings-card" role="dialog" aria-modal="true" aria-labelledby="settings-title"><button className="username-manager-close" onClick={onClose} aria-label="Close settings">×</button><div className="eyebrow">ACCOUNT & SECURITY</div><h2 id="settings-title">Your settings.</h2><p className="settings-intro">Keep your profile current and your account protected.</p>
    <form onSubmit={saveProfile} className="settings-section"><h3>Profile</h3><label>Display name<input value={displayName} maxLength={80} onChange={e => setDisplayName(e.target.value)} /></label><label>Bio<textarea value={bio} maxLength={500} rows="4" onChange={e => setBio(e.target.value)} /><small>{bio.length}/500</small></label><button className="primary" disabled={busy || !displayName.trim()}>Save profile</button></form>
    <form onSubmit={saveLanguage} className="settings-section"><h3>Language & translation</h3><p className="settings-intro">Favourit will translate messages into this language. You can change it whenever you want.</p><label>Personal language<select value={language} onChange={e => setLanguage(e.target.value)}>{languages.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label><button className="secondary" disabled={busy}>Save language</button></form>
    <div className="settings-section"><h3>Sign-in security</h3><div className="security-row"><span>Email</span><strong>{security?.email || session?.user?.email || '—'}</strong><em>{security?.emailConfirmedAt ? 'Verified' : 'Needs verification'}</em></div><div className="security-row"><span>Last sign in</span><strong>{security?.lastSignInAt ? new Date(security.lastSignInAt).toLocaleString() : '—'}</strong></div><form onSubmit={savePassword}><label>New password<input type="password" value={password} minLength={8} maxLength={128} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" /></label><button className="secondary" disabled={busy || password.length < 8}>Change password</button></form><button type="button" className="text-button" disabled={busy} onClick={resetPassword}>Send password reset email</button></div>
    <div className="settings-section blocked-accounts-section"><div className="blocked-heading"><div><h3>Blocked accounts</h3><p>People you block stay out of your network, but your existing message history is kept.</p></div><span>{blocked.length}</span></div>{blocked.length ? <div className="blocked-list">{blocked.map(user => <div className="blocked-row" key={user.id}><div className="blocked-avatar">{(user.display_name || user.username || 'FV').slice(0, 1).toUpperCase()}</div><div className="blocked-copy"><strong>{user.display_name || 'Favourit member'}</strong><small>@{user.username || 'member'}</small></div><button className="secondary small" disabled={unblocking === user.id} onClick={() => handleUnblock(user)}>{unblocking === user.id ? 'Unblocking…' : 'Unblock'}</button></div>)}</div> : <div className="settings-muted">You have not blocked anyone.</div>}</div>
    {saved && <div className="settings-success">✓ {saved}</div>}{error && <div className="username-manager-error">{error}</div>}
  </section></div>;
}
