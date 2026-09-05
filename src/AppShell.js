import { useEffect, useRef, useState } from 'react';
import App from './App';
import AuthGate from './components/AuthGate';
import ActivityCenter from './components/ActivityCenter';
import FavouritLoader from './components/FavouritLoader';
import AdminPanel from './components/AdminPanel';
import AdminOperations from './components/AdminOperations';
import AdminMessageReports from './components/AdminMessageReports';
import MiddlemanPanel from './components/MiddlemanPanel';
import UsernameGate from './components/UsernameGate';
import UsernameManager from './components/UsernameManager';
import DirectMessagingV2 from './components/DirectMessagingV2';
import DirectMessageBridge from './components/DirectMessageBridge';
import MessageRequestListBridge from './components/MessageRequestListBridge';
import PrivateGroupBridge from './components/PrivateGroupBridge';
import CommunityFinishBridge from './components/CommunityFinishBridge';
import CommunityModeratorMessageBridge from './components/CommunityModeratorMessageBridge';
import SettingsLauncher from './components/SettingsLauncher';
import PublicProfileHost from './components/PublicProfileHost';
import FriendRequestCenter from './components/FriendRequestCenter';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { getCurrentProfile } from './lib/profile';
import { getMyUsernameStatus } from './lib/usernames';
import { claimDailyReward, getMyWallet } from './lib/wallet';

const SESSION_TIMEOUT_MS = 6000;
const PROFILE_TIMEOUT_MS = 8000;
const USERNAME_STATUS_TIMEOUT_MS = 5000;
const REWARD_TIMEOUT_MS = 5000;
const WALLET_TIMEOUT_MS = 5000;
const USERNAME_ONBOARDING_KEY = 'favourit_username_onboarding_pending';

function withTimeout(promise, ms, message = 'Request timed out. Please try again.') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

function normalizedPath() {
  return window.location.pathname.replace(/\/+$/, '') || '/';
}

function isAdminPanelPath() {
  return normalizedPath() === '/adminpanel';
}

function isMiddlemanPanelPath() {
  return normalizedPath() === '/middleman';
}

function usernameCacheKey(userId) {
  return userId ? `favourit_username:${userId}` : '';
}

function getPendingOnboarding() {
  try { return JSON.parse(localStorage.getItem(USERNAME_ONBOARDING_KEY) || 'null'); }
  catch (_) { return null; }
}

export default function AppShell() {
  const [session, setSession] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [profile, setProfile] = useState(null);
  const [usernameStatus, setUsernameStatus] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [uiReady, setUiReady] = useState(false);
  const [rewardMessage, setRewardMessage] = useState('');
  const sessionUserRef = useRef(null);
  const adminPath = isAdminPanelPath();
  const middlemanPath = isMiddlemanPanelPath();
  const staffPath = adminPath || middlemanPath;

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return undefined;

    let mounted = true;
    let loadVersion = 0;

    const clearSession = () => {
      loadVersion += 1;
      sessionUserRef.current = null;
      if (!mounted) return;
      setSession(null);
      setWallet(null);
      setProfile(null);
      setUsernameStatus(null);
      setRewardMessage('');
      setUiReady(true);
      setLoading(false);
    };

    const hydrateSession = async (nextSession, { showLoader = false } = {}) => {
      if (!nextSession) {
        clearSession();
        return;
      }

      const version = ++loadVersion;
      const userId = nextSession.user.id;
      const userEmail = nextSession.user.email?.toLowerCase();
      sessionUserRef.current = userId;

      if (mounted && version === loadVersion) {
        setSession(nextSession);
        setLoading(false);
        if (showLoader) setUiReady(false);
      }

      try {
        const profileResult = await withTimeout(getCurrentProfile(), PROFILE_TIMEOUT_MS, 'Account data is taking too long.');
        if (!mounted || version !== loadVersion) return;
        setProfile(profileResult?.profile || null);
        if (profileResult?.wallet) {
          setWallet(profileResult.wallet);
        } else {
          try {
            const currentWallet = await withTimeout(getMyWallet(), WALLET_TIMEOUT_MS, 'Wallet loading timed out.');
            if (mounted && version === loadVersion) setWallet(currentWallet || null);
          } catch (_) {}
        }
      } catch (error) {
        if (mounted && version === loadVersion) setRewardMessage(error.message || 'Some account data could not be loaded yet.');
      } finally {
        if (mounted && version === loadVersion) setUiReady(true);
      }

      try {
        const status = await withTimeout(getMyUsernameStatus(), USERNAME_STATUS_TIMEOUT_MS, 'Username setup is taking too long.');
        if (!mounted || version !== loadVersion) return;
        const normalizedStatus = status?.username ? { ...status, username_chosen: true } : status || null;
        setUsernameStatus(normalizedStatus);
        if (normalizedStatus?.username) {
          localStorage.setItem(usernameCacheKey(userId), normalizedStatus.username);
          const pending = getPendingOnboarding();
          if (pending && ((pending.userId && pending.userId === userId) || pending.email === userEmail)) {
            localStorage.removeItem(USERNAME_ONBOARDING_KEY);
          }
        }
      } catch (_) {
        const cached = localStorage.getItem(usernameCacheKey(userId));
        if (cached && mounted && version === loadVersion) setUsernameStatus({ username: cached, username_chosen: true });
      }

      if (!staffPath) {
        try {
          const reward = await withTimeout(claimDailyReward(), REWARD_TIMEOUT_MS, 'Daily reward timed out.');
          if (mounted && version === loadVersion && reward?.claimed) {
            setRewardMessage(reward.reward_fav > 0 ? `Daily reward: +${reward.reward_fav} FAV` : 'Daily reward recorded.');
            try {
              const refreshedWallet = await withTimeout(getMyWallet(), WALLET_TIMEOUT_MS);
              if (mounted && version === loadVersion) setWallet(refreshedWallet || null);
            } catch (_) {}
          }
        } catch (rewardError) {
          if (mounted && version === loadVersion && !String(rewardError?.message || '').toLowerCase().includes('already claimed')) {
            setRewardMessage('Daily reward is unavailable right now.');
          }
        }
      }
    };

    const initializeSession = async () => {
      try {
        const { data } = await withTimeout(supabase.auth.getSession(), SESSION_TIMEOUT_MS, 'Session check timed out.');
        if (!mounted) return;
        if (data.session) await hydrateSession(data.session, { showLoader: true });
        else clearSession();
      } catch (_) {
        if (mounted) {
          setUiReady(true);
          setLoading(false);
        }
      }
    };

    initializeSession();

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      window.setTimeout(() => {
        if (!mounted) return;

        if (event === 'SIGNED_OUT') {
          clearSession();
          return;
        }

        if (!nextSession) return;

        const sameUser = sessionUserRef.current === nextSession.user.id;
        sessionUserRef.current = nextSession.user.id;
        setSession(nextSession);

        if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') return;

        if (event === 'SIGNED_IN') {
          if (!sameUser) hydrateSession(nextSession, { showLoader: true });
          return;
        }

        if (event === 'USER_UPDATED') {
          hydrateSession(nextSession, { showLoader: false });
        }
      }, 0);
    });

    return () => {
      mounted = false;
      loadVersion += 1;
      listener.subscription.unsubscribe();
    };
  }, [staffPath]);

  useEffect(() => {
    if (!session?.user?.id || !supabase || staffPath) return undefined;
    let active = true;

    const setPresence = async online => {
      try { await supabase.rpc('set_my_presence', { p_online: online }); }
      catch (_) {}
    };

    const mark = () => { if (active) setPresence(true); };
    mark();
    const timer = window.setInterval(mark, 20000);
    const onVisible = () => { if (document.visibilityState === 'visible') mark(); };
    document.addEventListener('visibilitychange', onVisible);
    const onUnload = () => { setPresence(false); };
    window.addEventListener('beforeunload', onUnload);

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('beforeunload', onUnload);
      setPresence(false);
    };
  }, [session?.user?.id, staffPath]);

  if (!isSupabaseConfigured) {
    return <div className="app-loading"><div><div className="logo"><span>Favour</span><i>it</i></div><h2>Connect your Favourit backend</h2><p>Add REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY to the environment before launching.</p></div></div>;
  }

  if (loading) return <FavouritLoader title="Connecting to Favourit" subtitle="Checking your secure account…" />;
  if (!session) return <AuthGate />;
  if (!uiReady) return <FavouritLoader title="Connecting to Favourit" subtitle="Checking your secure account…" />;

  if (adminPath) {
    return <>
      <AdminPanel />
      <AdminOperations />
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px 48px' }}><AdminMessageReports /></main>
    </>;
  }

  if (middlemanPath) {
    return <><MiddlemanPanel /><PublicProfileHost session={session} /></>;
  }

  const pending = getPendingOnboarding();
  const onboardingPending = Boolean(pending && ((pending.userId && pending.userId === session.user.id) || pending.email === session.user.email?.toLowerCase()));

  if (onboardingPending && !usernameStatus?.username) {
    return <UsernameGate
      displayName={usernameStatus?.display_name || session.user.user_metadata?.display_name || ''}
      email={usernameStatus?.email || session.user.email || ''}
      onComplete={profileData => {
        localStorage.removeItem(USERNAME_ONBOARDING_KEY);
        localStorage.setItem(usernameCacheKey(session.user.id), profileData.username);
        setUsernameStatus({ ...usernameStatus, ...profileData, username_chosen: true });
      }}
    />;
  }

  return <>
    <App initialWallet={wallet} session={session} rewardMessage={rewardMessage} usernameStatus={usernameStatus} />
    <UsernameManager status={usernameStatus} onChanged={status => {
      localStorage.setItem(usernameCacheKey(session.user.id), status.username);
      setUsernameStatus(status);
    }} />
    <DirectMessagingV2 session={session} />
    <DirectMessageBridge />
    <MessageRequestListBridge />
    <PrivateGroupBridge session={session} />
    <CommunityFinishBridge />
    <CommunityModeratorMessageBridge />
    <PublicProfileHost session={session} />
    <ActivityCenter />
    <FriendRequestCenter />
    <SettingsLauncher session={session} profile={profile} onProfileChanged={next => setProfile(next)} />
  </>;
}
