import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getMySocialGraph } from '../lib/social';
import './FriendRequestCenter.css';

function openCommunityRequests() {
  const communityNav = [...document.querySelectorAll('.topbar nav button')]
    .find(node => node.textContent?.trim() === 'Community');

  if (communityNav && !communityNav.classList.contains('active')) {
    communityNav.click();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('favourit:open-community-requests'));
    }, 100);
    return;
  }

  window.dispatchEvent(new CustomEvent('favourit:open-community-requests'));
}

export default function FriendRequestCenter() {
  const [toast, setToast] = useState(null);
  const seen = useRef(new Set());
  const knownRequestIds = useRef(new Set());

  const refreshRequests = async (showNew = false) => {
    try {
      const graph = await getMySocialGraph();
      const incoming = Array.isArray(graph?.incoming) ? graph.incoming.filter(Boolean) : [];

      if (showNew) {
        const newest = incoming.find(request => request?.id && !knownRequestIds.current.has(request.id));
        if (newest) {
          setToast({
            id: newest.id,
            title: 'New friend request',
            body: `${newest.display_name || `@${newest.username || 'Someone'}`} sent you a friend request.`,
          });
        }
      }

      knownRequestIds.current = new Set(incoming.map(request => request?.id).filter(Boolean));
      window.dispatchEvent(new CustomEvent('favourit:friend-request-updated'));
    } catch (_) {}
  };

  useEffect(() => {
    let mounted = true;
    refreshRequests(false);
    if (!supabase) return undefined;
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
            refreshRequests(false);
          })
          .subscribe();
      } catch (_) {}
    })();

    const fallback = window.setInterval(() => refreshRequests(true), 8000);
    return () => {
      mounted = false;
      window.clearInterval(fallback);
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

  if (!toast) return null;

  return (
    <button className="friend-request-toast" type="button" onClick={() => { openCommunityRequests(); setToast(null); }}>
      <span className="friend-request-toast-avatar">♡</span>
      <span><strong>{toast.title}</strong><small>{toast.body}</small></span>
    </button>
  );
}
