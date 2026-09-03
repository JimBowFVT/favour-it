import { useEffect, useState } from 'react';
import App from './App';
import AuthGate from './components/AuthGate';
import ActivityCenter from './components/ActivityCenter';
import FavouritLoader from './components/FavouritLoader';
import AdminPanel from './components/AdminPanel';
import UsernameGate from './components/UsernameGate';
import DirectMessaging from './components/DirectMessaging';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { getCurrentProfile } from './lib/profile';
import { getMyUsernameStatus } from './lib/usernames';
import { claimDailyReward, getMyWallet } from './lib/wallet';

const BOOTSTRAP_TIMEOUT_MS = 12000;
const USERNAME_STATUS_TIMEOUT_MS = 7000;
function withTimeout(promise, ms, message = 'Request timed out. Please try again.') { let timer; const timeout = new Promise((_, reject) => { timer = window.setTimeout(() => reject(new Error(message)), ms); }); return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer)); }
function isAdminPanelPath() { return window.location.pathname.replace(/\/+$/, '') === '/adminpanel'; }
function usernameCacheKey(userId) { return userId ? `favourit_username:${userId}` : ''; }

export default function AppShell() {
  const [session, setSession] = useState(null); const [wallet, setWallet] = useState(null); const [usernameStatus, setUsernameStatus] = useState(null); const [loading, setLoading] = useState(isSupabaseConfigured); const [rewardMessage, setRewardMessage] = useState('');
  const adminPath = isAdminPanelPath();
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return undefined; let mounted = true; let loadVersion = 0;
    const load = async nextSession => { const version = ++loadVersion;
      if (!nextSession) { if (mounted && version === loadVersion) { setSession(null); setWallet(null); setUsernameStatus(null); setRewardMessage(''); setLoading(false); } return; }
      if (mounted && version === loadVersion) { setSession(nextSession); setLoading(true); }
      try {
        const profileResult = await withTimeout(getCurrentProfile(), BOOTSTRAP_TIMEOUT_MS, 'Account setup is taking too long.');
        const currentWallet = profileResult?.wallet || await withTimeout(getMyWallet(), BOOTSTRAP_TIMEOUT_MS, 'Wallet loading timed out.');
        if (!mounted || version !== loadVersion) return;
        setWallet(currentWallet || null);
        try {
          const status = await withTimeout(getMyUsernameStatus(), USERNAME_STATUS_TIMEOUT_MS, 'Username setup is taking too long.');
          if (mounted && version === loadVersion) {
            const normalizedStatus = status?.username ? { ...status, username_chosen: true } : status || null;
            setUsernameStatus(normalizedStatus);
            if (normalizedStatus?.username) localStorage.setItem(usernameCacheKey(nextSession.user.id), normalizedStatus.username);
          }
        } catch (_) {
          const cached = localStorage.getItem(usernameCacheKey(nextSession.user.id));
          if (cached && mounted && version === loadVersion) setUsernameStatus({ username: cached, username_chosen: true });
        }
        if (!adminPath) { try { const reward = await withTimeout(claimDailyReward(), 8000, 'Daily reward timed out.'); if (mounted && version === loadVersion && reward?.claimed) { setRewardMessage(reward.reward_fav > 0 ? `Daily reward: +${reward.reward_fav} FAV` : 'Daily reward recorded.'); try { setWallet(await withTimeout(getMyWallet(), 5000)); } catch (_) {} } } catch (rewardError) { if (mounted && version === loadVersion && !String(rewardError?.message || '').toLowerCase().includes('already claimed')) setRewardMessage('Daily reward is unavailable right now.'); } }
      } catch (error) { if (mounted && version === loadVersion) setRewardMessage(error.message || 'Some account data could not be loaded yet.'); }
      finally { if (mounted && version === loadVersion) setLoading(false); }
    };
    supabase.auth.getSession().then(({ data }) => load(data.session)).catch(() => { if (mounted) setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => { window.setTimeout(() => load(nextSession), 0); });
    return () => { mounted = false; loadVersion += 1; listener.subscription.unsubscribe(); };
  }, [adminPath]);
  if (!isSupabaseConfigured) return <div className="app-loading"><div><div className="logo"><span>Favour</span><i>it</i></div><h2>Connect your Favourit backend</h2><p>Add REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY to the environment before launching.</p></div></div>;
  if (loading) return <FavouritLoader title={session ? 'Loading your Favourit account' : 'Connecting to Favourit'} subtitle={session ? 'Preparing your secure workspace…' : 'Checking your secure session…'} />;
  if (!session) return <AuthGate />;
  if (adminPath) return <AdminPanel />;
  // A handle is considered chosen as soon as a non-empty username exists. The
  // boolean flag is retained for backward compatibility but is not allowed to
  // lock existing users out of the app.
  if (!usernameStatus?.username) return <UsernameGate displayName={usernameStatus?.display_name || session.user.user_metadata?.display_name || ''} email={usernameStatus?.email || session.user.email || ''} onComplete={profile => { localStorage.setItem(usernameCacheKey(session.user.id), profile.username); setUsernameStatus({ ...usernameStatus, ...profile, username_chosen: true }); }} />;
  return <><App initialWallet={wallet} session={session} rewardMessage={rewardMessage} usernameStatus={usernameStatus} /><DirectMessaging session={session} usernameStatus={usernameStatus} /><ActivityCenter /></>;
}
