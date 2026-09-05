import { useEffect, useMemo, useRef, useState } from 'react';
import './ActivityCenter.css';
import { getNotifications, markNotificationRead } from '../lib/notifications';
import { supabase } from '../lib/supabase';

function timeAgo(value) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60); if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
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
  const openRef = useRef(false);

  const refresh = async () => {
    try {
      const rows = await getNotifications();
      setNotifications((rows || []).filter(n => n.type !== 'message'));
    } catch (_) {}
  };

  const markVisibleRead = async rows => {
    const unreadRows = (rows || notifications).filter(n => !n.read_at);
    if (!unreadRows.length) return;
    const now = new Date().toISOString();
    setNotifications(current => current.map(n => unreadRows.some(row => row.id === n.id) ? { ...n, read_at: now } : n));
    await Promise.all(unreadRows.map(n => markNotificationRead(n.id).catch(() => {})));
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
        if (openRef.current && !row.read_at) await markNotificationRead(row.id).catch(() => {});
      })
      .subscribe();

    return () => {
      window.clearInterval(timer);
      try { supabase.removeChannel(channel); } catch (_) {}
    };
  }, []);

  useEffect(() => { openRef.current = open; }, [open]);

  const unread = useMemo(() => notifications.filter(n => !n.read_at).length, [notifications]);

  const openActivity = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    openRef.current = true;
    await markVisibleRead(notifications);
  };

  const activate = async notification => {
    if (!notification.read_at) {
      await markNotificationRead(notification.id).catch(() => {});
      setNotifications(current => current.map(n => n.id === notification.id ? { ...n, read_at: new Date().toISOString() } : n));
    }
    setOpen(false);
    openRef.current = false;
    window.setTimeout(() => navigateFromNotification(notification), 0);
  };

  return <div className="activity-center">
    <button className="activity-trigger" aria-label="Notifications" onClick={openActivity}>♢{unread > 0 && <span className="activity-badge">{unread > 9 ? '9+' : unread}</span>}</button>
    {open && <div className="activity-popover"><div className="activity-head"><div><small>FAVOURIT</small><h3>Notifications</h3></div></div><div className="activity-list">{notifications.length ? notifications.map(n => <button key={n.id} className={`activity-item ${n.read_at ? '' : 'unread'}`} onClick={() => activate(n)}><span className="activity-icon">✦</span><span><strong>{n.title}</strong><small>{n.body}</small><em>{timeAgo(n.created_at)} ago</em></span></button>) : <div className="activity-empty"><strong>You're all caught up.</strong><span>Order updates and social activity will appear here.</span></div>}</div></div>}
  </div>;
}
