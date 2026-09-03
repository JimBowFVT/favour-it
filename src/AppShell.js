import { useEffect, useState } from 'react';
import App from './App';
import AuthGate from './components/AuthGate';
import ActivityCenter from './components/ActivityCenter';
import FavouritLoader from './components/FavouritLoader';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { getCurrentProfile } from './lib/profile';
import { claimDailyReward, getMyWallet } from './lib/wallet';

const BOOTSTRAP_TIMEOUT_MS = 12000;

function withTimeout(promise, ms, message = 'Request timed out. Please try again.') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

export default function AppShell() {
  const [session, setSession] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [rewardMessage, setRewardMessage] = useState('');

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return undefined;
    let mounted = true;
    let loadVersion = 0;

    const load = async (nextSession) => {
      const version = ++loadVersion;
      if (!nextSession) {
        if (mounted && version === loadVersion) {
          setSession(null);
          setWallet(null);
          setRewardMessage('');
          setLoading(false);
        }
        return;
      }

      // IMPORTANT: establish the authenticated UI immediately. Account
      // bootstrap must never turn a successful Supabase login back into a
      // logged-out screen just because profile/wallet loading is slow.
      if (mounted && version === loadVersion) {
        setSession(nextSession);
        setLoading(true);
      }

      try {
        const profileResult = await withTimeout(getCurrentProfile(), BOOTSTRAP_TIMEOUT_MS, 'Account setup is taking too long.');
        const currentWallet = profileResult?.wallet || await withTimeout(getMyWallet(), BOOTSTRAP_TIMEOUT_MS, 'Wallet loading timed out.');
        if (!mounted || version !== loadVersion) return;
        setWallet(currentWallet || null);

        // Reward claiming is non-blocking. A slow reward call must not prevent
        // the user from entering the app after a valid login.
        try {
          const reward = await withTimeout(claimDailyReward(), 8000, 'Daily reward timed out.');
          if (mounted && version === loadVersion && reward?.claimed) {
            setRewardMessage(reward.reward_fav > 0
              ? `Daily reward: +${reward.reward_fav} FAV`
              : 'Daily reward recorded.');
            try { setWallet(await withTimeout(getMyWallet(), 5000)); } catch (_) { /* wallet refresh is optional */ }
          }
        } catch (rewardError) {
          if (mounted && version === loadVersion && !String(rewardError?.message || '').toLowerCase().includes('already claimed')) {
            setRewardMessage('Daily reward is unavailable right now.');
          }
        }
      } catch (error) {
        // Keep the valid auth session. The app can still render and individual
        // screens will surface their own data errors instead of forcing login.
        if (mounted && version === loadVersion) {
          setRewardMessage(error.message || 'Some account data could not be loaded yet.');
        }
      } finally {
        if (mounted && version === loadVersion) setLoading(false);
      }
    };

    supabase.auth.getSession().then(({ data }) => load(data.session)).catch(() => {
      if (mounted) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => load(nextSession), 0);
    });

    return () => {
      mounted = false;
      loadVersion += 1;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (!isSupabaseConfigured) return <div className="app-loading"><div><div className="logo"><span>Favour</span><i>it</i></div><h2>Connect your Favourit backend</h2><p>Add REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY to the environment before launching.</p></div></div>;
  if (loading && session) return <FavouritLoader />;
  if (loading) return <FavouritLoader title="Connecting to Favourit" subtitle="Checking your secure session…" />;
  if (!session) return <AuthGate />;
  return <><App initialWallet={wallet} session={session} rewardMessage={rewardMessage} /><ActivityCenter /></>;
}
