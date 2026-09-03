import { useEffect, useMemo, useState } from 'react';
import './ActivityCenter.css';
import { supabase } from '../lib/supabase';
import { getNotifications, markAllNotificationsRead, markConversationRead, markNotificationRead } from '../lib/notifications';
import { getConversationMessages, sendMessage } from '../lib/messaging';

function timeAgo(value) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60); if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function ActivityCenter() {
  const [open,setOpen]=useState(false); const [notifications,setNotifications]=useState([]); const [conversation,setConversation]=useState(null); const [messages,setMessages]=useState([]); const [draft,setDraft]=useState(''); const [busy,setBusy]=useState(false);
  const unread=useMemo(()=>notifications.filter(n=>!n.read_at).length,[notifications]);
  const refresh=async()=>{try{setNotifications(await getNotifications())}catch(_){}};
  useEffect(()=>{refresh();const timer=window.setInterval(refresh,15000);return()=>window.clearInterval(timer)},[]);
  useEffect(()=>{const openConversation=e=>{setConversation(e.detail);setOpen(true)};window.addEventListener('favourit:open-conversation',openConversation);return()=>window.removeEventListener('favourit:open-conversation',openConversation)},[]);
  useEffect(()=>{if(!open||!conversation)return undefined;let active=true;const load=async()=>{try{const rows=await getConversationMessages(conversation);if(active)setMessages(rows);await markConversationRead(conversation);await refresh()}catch(_) {}};load();const channel=supabase?.channel(`messages-${conversation}`)?.on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`conversation_id=eq.${conversation}`},payload=>{setMessages(current=>current.some(m=>m.id===payload.new.id)?current:[...current,payload.new]);markConversationRead(conversation).catch(()=>{})})?.subscribe();return()=>{active=false;if(channel&&supabase)supabase.removeChannel(channel)}},[open,conversation]);
  const handleNotification=async n=>{if(!n.read_at){await markNotificationRead(n.id).catch(()=>{});setNotifications(v=>v.map(x=>x.id===n.id?{...x,read_at:new Date().toISOString()}:x))}if(n.conversation_id)setConversation(n.conversation_id)};
  const submit=async e=>{e.preventDefault();if(!draft.trim()||!conversation||busy)return;setBusy(true);try{const message=await sendMessage(conversation,draft);setMessages(v=>v.some(m=>m.id===message.id)?v:[...v,message]);setDraft('');await refresh()}catch(_){}finally{setBusy(false)}};
  return <div className="activity-center"><button className="activity-trigger" aria-label="Notifications and messages" onClick={()=>{setOpen(v=>!v);if(open)setConversation(null)}}>◌{unread>0&&<span className="activity-badge">{unread>9?'9+':unread}</span>}</button>{open&&<div className="activity-popover"><div className="activity-head"><div><small>FAVOURIT</small><h3>{conversation?'Messages':'Activity'}</h3></div><div className="activity-head-actions">{!conversation&&unread>0&&<button onClick={async()=>{await markAllNotificationsRead().catch(()=>{});await refresh()}}>Mark all read</button>}{conversation&&<button onClick={()=>setConversation(null)}>← Activity</button>}</div></div>{conversation?<><div className="message-list">{messages.length?messages.map(m=><div className="message-bubble" key={m.id}><p>{m.body}</p><small>{timeAgo(m.created_at)} ago</small></div>):<div className="activity-empty">No messages yet.</div>}</div><form className="message-compose" onSubmit={submit}><input value={draft} onChange={e=>setDraft(e.target.value)} maxLength={5000} placeholder="Write a message…"/><button className="primary" disabled={busy||!draft.trim()}>{busy?'…':'Send'}</button></form></>:<div className="activity-list">{notifications.length?notifications.map(n=><button key={n.id} className={`activity-item ${n.read_at?'':'unread'}`} onClick={()=>handleNotification(n)}><span className="activity-icon">{n.type==='message'?'✉':'✦'}</span><span><strong>{n.title}</strong><small>{n.body}</small><em>{timeAgo(n.created_at)} ago</em></span></button>):<div className="activity-empty"><strong>You're all caught up.</strong><span>Order updates and messages will appear here.</span></div>}</div>}</div>}</div>;
}
