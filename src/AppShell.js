import { useEffect, useState } from 'react';
import App from './App';
import AuthGate from './components/AuthGate';
import ActivityCenter from './components/ActivityCenter';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { getCurrentProfile } from './lib/profile';
import { claimDailyReward, getMyWallet } from './lib/wallet';

export default function AppShell() {
  const [session, setSession] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [rewardMessage, setRewardMessage] = useState('');

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return undefined;
    let mounted = true;
    const load = async (nextSession) => {
      if (!nextSession) {
        if (mounted) { setSession(null); setWallet(null); setRewardMessage(''); setLoading(false); }
        return;
      }
      setLoading(true); setRewardMessage('');
      try {
        await getCurrentProfile();
        const currentWallet = await getMyWallet();
        if (!mounted) return;
        setSession(nextSession); setWallet(currentWallet);
        try {
          const reward = await claimDailyReward();
          if (mounted && reward?.claimed) {
            setRewardMessage(reward.reward_fav > 0 ? `Daily reward: +${reward.reward_fav} FAV` : 'Daily reward recorded.');
            setWallet(await getMyWallet());
          }
        } catch (rewardError) {
          if (mounted && !String(rewardError?.message || '').toLowerCase().includes('already claimed')) setRewardMessage('Daily reward is unavailable right now.');
        }
      } catch (error) {
        if (mounted) setRewardMessage(error.message || 'Could not load your account.');
      } finally { if (mounted) setLoading(false); }
    };
    supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => load(nextSession));
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  if (!isSupabaseConfigured) return <div className="app-loading"><div><div className="logo"><span>Favour</span><i>it</i></div><h2>Connect your Favourit backend</h2><p>Add REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY to the environment before launching.</p></div></div>;
  if (loading) return <div className="app-loading"><div><div className="logo"><span>Favour</span><i>it</i></div><p>Loading your Favourit account…</p></div></div>;
  if (!session) return <AuthGate />;
  return <><App initialWallet={wallet} session={session} rewardMessage={rewardMessage} /><ActivityCenter /></>;
}
