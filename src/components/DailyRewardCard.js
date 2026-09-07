import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatMicroFav } from '../lib/favAmounts';
import { createWalletApi } from '../lib/walletActivity';

const REASONS = {
  program_pending: 'The reward programme has not started yet.',
  setup_incomplete: 'Complete your account setup before claiming a reward.',
  already_claimed: 'Your reward for this UTC day is already recorded.',
  legacy_claimed: 'A reward for this UTC day was already recorded.',
  paused: 'Daily rewards are temporarily paused.',
  visit_required: 'Check today’s reward to record your visit. This does not add FAV.',
  wallet_missing: 'Your wallet must be recovered before a reward can be claimed.',
  wallet_inconsistent: 'Your wallet needs reconciliation. Contact support.',
  daily_budget_exhausted: 'Today’s reward budget has been reached. Your visit streak is preserved.',
};
export default function DailyRewardCard({ userId, onClaimed }) {
  const api = useMemo(() => createWalletApi(supabase, userId), [userId]);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const locked = useRef(false);
  const load = useCallback(async () => {
    const version = ++revision.current;
    setError('');
    try { const data = await api.rewardStatus(); if (version === revision.current) setStatus(data); }
    catch (err) { if (version === revision.current) setError(err.message || 'Could not load rewards.'); }
  }, [api]);
  useEffect(() => { load(); return () => { revision.current += 1; }; }, [load]);
  const act = async claim => {
    if (locked.current) return;
    const version = revision.current;
    locked.current = true; setBusy(true); setError('');
    try {
      const data = claim ? await api.claimReward(status.offer_id) : await api.prepareReward();
      if (version !== revision.current) return;
      setStatus(data);
      // Receipt, not a click or a local counter, determines successful issuance.
      if (claim && data.receipt?.transaction_id) await onClaimed?.();
    } catch (err) { if (version === revision.current) setError(err.message || 'Reward action failed.'); }
    finally { if (version === revision.current) { locked.current = false; setBusy(false); } }
  };
  return <section className="wallet-card" aria-labelledby="daily-reward-title">
    <h2 id="daily-reward-title">Daily FAV reward</h2>
    <p>Rewards stay inside Favourit. Opening the app does not automatically claim a reward.</p>
    {error && <div role="alert" className="wallet-message wallet-error">{error} <button type="button" className="text-button" onClick={load} disabled={busy}>Retry reward status</button></div>}
    {!status && !error && <p role="status">Loading reward status…</p>}
    {status && <>
      <p>Visit streak: {status.current_streak} day{status.current_streak === 1 ? '' : 's'} · Reward day: {status.reward_date} (UTC)</p>
      {status.receipt ? <p>Recorded: <strong>{formatMicroFav(status.receipt.amount_micro_fav)} FAV</strong></p> : <p>Today’s offer: <strong>{formatMicroFav(status.amount_micro_fav)} FAV</strong></p>}
      {status.reason === 'visit_required' && <button type="button" className="secondary" disabled={busy} onClick={() => act(false)}>{busy ? 'Checking…' : 'Check today’s reward'}</button>}
      {status.eligible === true && status.offer_id && !status.claimed && <button type="button" className="primary" disabled={busy} onClick={() => act(true)}>{busy ? 'Claiming…' : `Claim ${formatMicroFav(status.amount_micro_fav)} FAV`}</button>}
      <p className="wallet-caption">{REASONS[status.reason] || (status.eligible ? 'Claiming is optional. The server checks your account, offer and daily limit.' : 'A reward is not currently available.')}</p>
    </>}
  </section>;
}
