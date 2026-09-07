import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { createAccountRequests } from '../lib/accountRequests';
import { validateBirthDate } from '../lib/age';

export default function WalletAccountSetup({ userId, onSaved }) {
  const requests = useMemo(() => createAccountRequests(supabase, userId), [userId]);
  const [eligibility, setEligibility] = useState(null);
  const [birthDate, setBirthDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const load = useCallback(async () => {
    const id = ++version.current;
    try {
      const result = await requests.run(() => supabase.rpc('get_my_account_eligibility'));
      if (id === version.current) { setEligibility(result); setError(''); }
    } catch (err) { if (id === version.current) setError(err.message || 'Could not load account setup.'); }
  }, [requests]);
  useEffect(() => { load(); return () => { version.current += 1; requests.cancel(); }; }, [load, requests]);
  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    const id = version.current;
    setBusy(true); setError('');
    try {
      const date = validateBirthDate(birthDate);
      const result = await requests.run(() => supabase.rpc('set_my_birth_date', { p_birth_date: date }));
      if (id !== version.current) return;
      setEligibility(result); setBirthDate('');
      await onSaved?.();
    } catch (err) { if (id === version.current) setError(err.message || 'Could not save account setup.'); }
    finally { if (id === version.current) setBusy(false); }
  };
  if (eligibility && !eligibility.birth_date_required && !error) return null;
  return <section className="wallet-card" aria-labelledby="wallet-setup-title">
    <h2 id="wallet-setup-title">Complete your account setup</h2>
    {error && <p role="alert">{error} <button type="button" onClick={load} disabled={busy}>Retry account status</button></p>}
    {!eligibility && !error && <p role="status">Checking account setup…</p>}
    {eligibility?.birth_date_required && <form className="wallet-support" onSubmit={submit}>
      <p>Your account needs a date of birth before rewards can be claimed. This does not verify your identity or enable crypto.</p>
      <label htmlFor="wallet-birth-date">Date of birth</label><input id="wallet-birth-date" className="auth-input" type="date" autoComplete="bday" min="1900-01-01" required value={birthDate} onChange={e => setBirthDate(e.target.value)} />
      <small>Saved privately once. Corrections require support. Accounts must be 13+; crypto requires verified age 18+.</small>
      <button className="secondary" disabled={busy || !birthDate} type="submit">{busy ? 'Saving…' : 'Save date of birth'}</button>
    </form>}
  </section>;
}
