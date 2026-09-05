import { useEffect, useMemo, useRef, useState } from 'react';
import './ActivityCenter.css';
import { getNotifications, markNotificationRead } from '../lib/notifications';
import { supabase } from '../lib/supabase';

const LAST_OPENED_KEY = 'favourit:activity:last-opened-at';

function timeAgo(value) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60); if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function storedLastOpenedAt() {
  try {
    const value = Number(localStorage.getItem(LAST_OPENED_KEY) || 0);
    return Number.isFinite(value) ? value : 0;
  } catch (_) {
    return 0;
  }
}

function persistLastOpenedAt(value) {
  try { localStorage.setItem(LAST_OPENED_KEY, String(value)); } catch (_) {}
}

function clickTopbar(name) {
  const button = [...document.querySelectorAll('.topbar nav button')].find(item => item.textContent?.trim() === name);
  button?.click();
}

function navigateFromNotification(notification) {
  const data = notification?.data || {};
  const type = String(notification?.type || '').toLowerCase();

  if ((type === 'friend_request' || type === 'friend_request_accepted' || type.includes('friend')) && data.user_id) {
    window.dispatchEvent(new CustomEvent('favourit:open-profile', { detail: { userId: data.user_id } }));
    return;
  }
  if (type === 'message' && (data.username || data.user_id)) {
    if (data.username) window.dispatchEvent(new CustomEvent('favourit:open-direct-message', { detail: { username: data.username } }));
    else window.dispatchEvent(new CustomEvent('favourit:open-profile', { detail: { userId: data.user_id } }));
    return;
  }
  if (data.order_id || type.includes('order') || type.includes('escrow') || type.includes('delivery')) {
    clickTopbar('Orders');
    return;
  }
  if (data.group_id || type.includes('community') || type.includes('group')) {
    clickTopbar('Community');
    return;
  }
  if (data.deal_id || type.includes('deal')) clickTopbar('Explore');
}

export default function ActivityCenter() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [lastOpenedAt, setLastOpenedAt] = useState(storedLastOpenedAt);
  const openRef = useRef(false);
  const lastOpenedRef = useRef(lastOpenedAt);

  const refresh = async () => {
    try {
      const rows = await getNotifications();
      setNotifications((rows || []).filter(n => n.type !== 'message'));
    } catch (_) {}
  };

  const isUnread = notification => {
    if (!notification || notification.read_at) return false;
    const createdAt = new Date(notification.created_at).getTime();
    return !Number.isFinite(createdAt) || createdAt > lastOpenedRef.current;
  };

  const markVisibleRead = async (rows, openedAt = Date.now()) => {
    const visibleRows = (rows || notifications).filter(n => {
      const createdAt = new Date(n.created_at).getTime();
      return !n.read_at && (!Number.isFinite(createdAt) || createdAt <= openedAt);
    });
    if (!visibleRows.length) return;

    const nowIso = new Date(openedAt).toISOString();
    setNotifications(current => current.map(n => visibleRows.some(row => row.id === n.id) ? { ...n, read_at: nowIso } : n));
    await Promise.all(visibleRows.map(n => markNotificationRead(n.id).catch(() => {})));
  };

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 15000);
    if (!supabase) return () => window.clearInterval(timer);

    const channel = supabase.channel('activity-center-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, async payload => {
        const row = payload.new;
        if (!row || row.type === 'message') return;

        await refresh();
        if (openRef.current && !row.read_at) {
          const now = Date.now();
          lastOpenedRef.current = now;
          setLastOpenedAt(now);
          persistLastOpenedAt(now);
          await markNotificationRead(row.id).catch(() => {});
          setNotifications(current => current.map(n => n.id === row.id ? { ...n, read_at: new Date(now).toISOString() } : n));
        }
      })
      .subscribe();

    return () => {
      window.clearInterval(timer);
      try { supabase.removeChannel(channel); } catch (_) {}
    };
  }, []);

  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => { lastOpenedRef.current = lastOpenedAt; }, [lastOpenedAt]);

  const unread = useMemo(() => notifications.filter(n => {
    if (!n || n.read_at) return false;
    const createdAt = new Date(n.created_at).getTime();
    return !Number.isFinite(createdAt) || createdAt > lastOpenedAt;
  }).length, [notifications, lastOpenedAt]);

  const openActivity = async () => {
    if (open) { setOpen(false); return; }

    const openedAt = Date.now();
    setOpen(true);
    openRef.current = true;
    lastOpenedRef.current = openedAt;
    setLastOpenedAt(openedAt);
    persistLastOpenedAt(openedAt);
    await markVisibleRead(notifications, openedAt);
  };

  const activate = async notification => {
    if (isUnread(notification)) {
      await markNotificationRead(notification.id).catch(() => {});
      setNotifications(current => current.map(n => n.id === notification.id ? { ...n, read_at: new Date().toISOString() } : n));
    }
    setOpen(false);
    openRef.current = false;
    window.setTimeout(() => navigateFromNotification(notification), 0);
  };

  return <div className="activity-center">
    <button className="activity-trigger" aria-label="Notifications" onClick={openActivity}>♢{unread > 0 && <span className="activity-badge">{unread > 9 ? '9+' : unread}</span>}</button>
    {open && <div className="activity-popover"><div className="activity-head"><div><small>FAVOURIT</small><h3>Notifications</h3></div></div><div className="activity-list">{notifications.length ? notifications.map(n => <button key={n.id} className={`activity-item ${isUnread(n) ? 'unread' : ''}`} onClick={() => activate(n)}><span className="activity-icon">✦</span><span><strong>{n.title}</strong><small>{n.body}</small><em>{timeAgo(n.created_at)} ago</em></span></button>) : <div className="activity-empty"><strong>You're all caught up.</strong><span>Order updates and social activity will appear here.</span></div>}</div></div>}
  </div>;
}
