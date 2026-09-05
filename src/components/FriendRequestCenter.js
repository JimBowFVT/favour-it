import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import './FriendRequestCenter.css';

function openRequests() {
  const communityNav = [...document.querySelectorAll('button,a')].find(node => node.textContent?.trim() === 'Community');
  if (communityNav) communityNav.click();
  window.setTimeout(() => {
    const requestsTab = [...document.querySelectorAll('.community-tabs button')].find(node => node.textContent?.trim().startsWith('Requests'));
    requestsTab?.click();
  }, 120);
}

export default function FriendRequestCenter() {
  const [toast, setToast] = useState(null);
  const seen = useRef(new Set());

  useEffect(() => {
    if (!supabase) return undefined;
    let mounted = true;
    let channel;

    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const userId = data?.user?.id;
        if (!mounted || !userId) return;
        channel = supabase
          .channel(`friend-request-notifications-${userId}`)
          .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${userId}`,
          }, payload => {
            const row = payload.new;
            if (!row || row.user_id !== userId || row.type !== 'friend_request') return;
            if (seen.current.has(row.id)) return;
            seen.current.add(row.id);
            setToast({
              id: row.id,
              title: row.title || 'New friend request',
              body: row.body || 'Someone sent you a friend request.',
            });
            window.dispatchEvent(new CustomEvent('favourit:friend-request-updated'));
          })
          .subscribe();
      } catch (_) {}
    })();

    return () => {
      mounted = false;
      if (channel) {
        try { supabase.removeChannel(channel); } catch (_) {}
      }
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 7000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const listener = () => openRequests();
    window.addEventListener('favourit:open-community-requests', listener);
    return () => window.removeEventListener('favourit:open-community-requests', listener);
  }, []);

  if (!toast) return null;

  return (
    <button className="friend-request-toast" type="button" onClick={() => { openRequests(); setToast(null); }}>
      <span className="friend-request-toast-avatar">♡</span>
      <span><strong>{toast.title}</strong><small>{toast.body}</small></span>
    </button>
  );
}
