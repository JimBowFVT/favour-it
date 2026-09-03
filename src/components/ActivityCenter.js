import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getNotifications, markAllNotificationsRead, markConversationRead, markNotificationRead } from '../lib/notifications';
import { getConversationMessages, sendMessage } from '../lib/messaging';

function timeAgo(value) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function ActivityCenter() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const unread = useMemo(() => notifications.filter(n => !n.read_at).length, [notifications]);

  const refresh = async () => {
    try { setNotifications(await getNotifications()); } catch (_) {}
  };

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!open || !conversation) return undefined;
    let active = true;
    const load = async () => {
      try {
        const rows = await getConversationMessages(conversation);
        if (active) setMessages(rows);
        await markConversationRead(conversation);
        await refresh();
      } catch (_) {}
    };
    load();
    const channel = supabase?.channel(`messages-${conversation}`)
      ?.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation}` }, payload => {
        setMessages(current => current.some(m => m.id === payload.new.id) ? current : [...current, payload.new]);
        markConversationRead(conversation).catch(() => {});
      })
      ?.subscribe();
    return () => { active = false; if (channel) supabase.removeChannel(channel); };
  }, [open, conversation]);

  const handleNotification = async (notification) => {
    if (!notification.read_at) {
      try { await markNotificationRead(notification.id); } catch (_) {}
      setNotifications(current => current.map(n => n.id === notification.id ? { ...n, read_at: new Date().toISOString() } : n));
    }
    if (notification.conversation_id) setConversation(notification.conversation_id);
  };

  const submit = async event => {
    event.preventDefault();
    if (!draft.trim() || !conversation || busy) return;
    setBusy(true);
    try {
      const message = await sendMessage(conversation, draft);
      setMessages(current => current.some(m => m.id === message.id) ? current : [...current, message]);
      setDraft('');
      await refresh();
    } catch (_) {} finally { setBusy(false); }
  };

  return <div className="activity-center">
    <button className="activity-trigger" aria-label="Notifications and messages" onClick={() => { setOpen(v => !v); setConversation(null); }}>
      ◌{unread > 0 && <span className="activity-badge">{unread > 9 ? '9+' : unread}</span>}
    </button>
    {open && <div className="activity-popover">
      <div className="activity-head"><div><small>FAVOURIT</small><h3>{conversation ? 'Messages' : 'Activity'}</h3></div><div className="activity-head-actions">{!conversation && unread > 0 && <button onClick={async () => { await markAllNotificationsRead().catch(() => {}); await refresh(); }}>Mark all read</button>}{conversation && <button onClick={() => setConversation(null)}>← Activity</button>}</div></div>
      {conversation ? <>
        <div className="message-list">{messages.length ? messages.map(message => <div className="message-bubble" key={message.id}><p>{message.body}</p><small>{timeAgo(message.created_at)} ago</small></div>) : <div className="activity-empty">No messages yet.</div>}</div>
        <form className="message-compose" onSubmit={submit}><input value={draft} onChange={e => setDraft(e.target.value)} maxLength={5000} placeholder="Write a message…"/><button className="primary" disabled={busy || !draft.trim()}>{busy ? '…' : 'Send'}</button></form>
      </> : <div className="activity-list">{notifications.length ? notifications.map(notification => <button key={notification.id} className={`activity-item ${notification.read_at ? '' : 'unread'}`} onClick={() => handleNotification(notification)}><span className="activity-icon">{notification.type === 'message' ? '✉' : '✦'}</span><span><strong>{notification.title}</strong><small>{notification.body}</small><em>{timeAgo(notification.created_at)} ago</em></span></button>) : <div className="activity-empty"><strong>You're all caught up.</strong><span>Order updates and messages will appear here.</span></div>}</div>}
    </div>}
  </div>;
}
