import { useEffect, useMemo, useState } from 'react';
import './ActivityCenter.css';
import { getNotifications, markAllNotificationsRead, markNotificationRead } from '../lib/notifications';

function timeAgo(value) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60); if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function ActivityCenter() {
  const [open, setOpen] = useState(false); const [notifications, setNotifications] = useState([]);
  const refresh = async () => { try { const rows = await getNotifications(); setNotifications((rows || []).filter(n => n.type !== 'message')); } catch (_) {} };
  useEffect(() => { refresh(); const timer = window.setInterval(refresh, 15000); return () => window.clearInterval(timer); }, []);
  const unread = useMemo(() => notifications.filter(n => !n.read_at).length, [notifications]);
  const markRead = async notification => { if (!notification.read_at) { await markNotificationRead(notification.id).catch(() => {}); setNotifications(v => v.map(n => n.id === notification.id ? { ...n, read_at: new Date().toISOString() } : n)); } };
  return <div className="activity-center">
    <button className="activity-trigger" aria-label="Notifications" onClick={() => { setOpen(v => !v); refresh(); }}>♢{unread > 0 && <span className="activity-badge">{unread > 9 ? '9+' : unread}</span>}</button>
    {open && <div className="activity-popover"><div className="activity-head"><div><small>FAVOURIT</small><h3>Notifications</h3></div>{unread > 0 && <button className="activity-mark" onClick={async () => { await markAllNotificationsRead().catch(() => {}); await refresh(); }}>Mark all read</button>}</div><div className="activity-list">{notifications.length ? notifications.map(n => <button key={n.id} className={`activity-item ${n.read_at ? '' : 'unread'}`} onClick={() => markRead(n)}><span className="activity-icon">✦</span><span><strong>{n.title}</strong><small>{n.body}</small><em>{timeAgo(n.created_at)} ago</em></span></button>) : <div className="activity-empty"><strong>You're all caught up.</strong><span>Order updates will appear here.</span></div>}</div></div>}
  </div>;
}
