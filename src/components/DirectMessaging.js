import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getDirectMessages, getMyDirectConversations, getOrCreateDirectConversation, searchUsersByUsername, sendDirectMessage } from '../lib/directMessaging';
import './DirectMessaging.css';

function playMessagePing() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(740, now);
    osc.frequency.exponentialRampToValueAtTime(980, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain); gain.connect(ctx.destination); osc.start(now); osc.stop(now + 0.2);
    window.setTimeout(() => ctx.close().catch(() => {}), 400);
  } catch (_) {}
}

export default function DirectMessaging({ session }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);
  const previousMessageCount = useRef(0);

  const refreshConversations = async () => {
    try { setConversations(await getMyDirectConversations()); } catch (e) { setError(e.message || 'Could not load conversations.'); }
  };

  useEffect(() => { if (session) refreshConversations(); }, [session]);
  useEffect(() => {
    if (!open || !query.trim()) { setResults([]); return undefined; }
    const timer = window.setTimeout(() => searchUsersByUsername(query).then(setResults).catch(e => setError(e.message || 'Search failed.')), 220);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  useEffect(() => {
    if (!conversationId) return undefined;
    let active = true;
    const load = async () => {
      try {
        const data = await getDirectMessages(conversationId);
        if (active) setMessages(data);
        await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId });
        refreshConversations();
      } catch (e) { if (active) setError(e.message || 'Could not load messages.'); }
    };
    load();
    const channel = supabase?.channel(`direct-chat-${conversationId}-${Date.now()}`)
      ?.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, payload => {
        setMessages(current => {
          if (current.some(m => m.id === payload.new.id)) return current;
          if (payload.new.sender_id !== session.user.id) playMessagePing();
          return [...current, payload.new];
        });
        supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId }).catch(() => {});
        refreshConversations();
      })
      ?.subscribe();
    return () => {
      active = false;
      try { if (channel && supabase) supabase.removeChannel(channel); } catch (_) {}
    };
  }, [conversationId, session?.user?.id]);

  useEffect(() => {
    if (!session || !supabase) return undefined;
    const channel = supabase.channel(`direct-inbox-${session.user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        if (payload.new.sender_id === session.user.id) return;
        if (payload.new.conversation_id !== conversationId) playMessagePing();
        refreshConversations();
      })
      .subscribe();
    const timer = window.setInterval(refreshConversations, 12000);
    return () => { window.clearInterval(timer); try { supabase.removeChannel(channel); } catch (_) {} };
  }, [session?.user?.id, conversationId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const unreadCount = conversations.reduce((sum, c) => sum + Number(c.unread_count || 0), 0);
  const openConversation = async (user, existingId = null) => {
    setBusy(true); setError('');
    try {
      const id = existingId || await getOrCreateDirectConversation(user.username);
      setSelected(user); setConversationId(id); setQuery(''); setResults([]); setOpen(true);
    } catch (e) { setError(e.message || 'Could not open conversation.'); }
    finally { setBusy(false); }
  };

  const send = async e => {
    e.preventDefault(); if (!body.trim() || !conversationId || busy) return;
    setBusy(true); setError('');
    try { const msg = await sendDirectMessage(conversationId, body); setMessages(v => v.some(m => m.id === msg.id) ? v : [...v, msg]); setBody(''); refreshConversations(); }
    catch (e) { setError(e.message || 'Could not send message.'); }
    finally { setBusy(false); }
  };

  if (!session) return null;
  return <>
    <button className="dm-fab" onClick={() => { setOpen(true); setError(''); refreshConversations(); }} aria-label="Messages">
      <span className="dm-fab-icon">⌁</span><span>Messages</span>{unreadCount > 0 && <b className="dm-unread-dot">{unreadCount > 9 ? '9+' : unreadCount}</b>}
    </button>
    {open && <div className="dm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <section className="dm-panel">
        <header className="dm-header">
          <div><div className="eyebrow">FAVOURIT MESSAGES</div><h2>{selected ? `@${selected.username}` : 'Messages'}</h2></div>
          <button className="dm-close" onClick={() => setOpen(false)}>×</button>
        </header>
        {error && <div className="dm-error">{error}<button onClick={() => setError('')}>×</button></div>}
        {!selected ? <>
          <div className="dm-search"><span>@</span><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Message someone by @username…" /></div>
          {query.trim() && <div className="dm-results">{results.map(user => <button key={user.user_id} onClick={() => openConversation(user)} disabled={busy}><div className="dm-avatar">{(user.display_name || user.username || 'U').slice(0,1).toUpperCase()}</div><div><strong>{user.display_name || user.username}</strong><span>@{user.username}</span></div><b>→</b></button>)}{!results.length && <p className="dm-empty">No one found for @{query.replace(/^@/,'')}.</p>}</div>}
          <div className="dm-section-title">Recent conversations</div>
          <div className="dm-conversation-list">{conversations.map(c => <button key={c.conversation_id} className={`dm-conversation ${Number(c.unread_count) ? 'unread' : ''}`} onClick={() => openConversation({ username: c.other_username, display_name: c.other_display_name, avatar_url: c.other_avatar_url }, c.conversation_id)}><div className="dm-avatar">{(c.other_display_name || c.other_username || 'U').slice(0,1).toUpperCase()}</div><div className="dm-conversation-copy"><strong>{c.other_display_name || `@${c.other_username}`}</strong><span>@{c.other_username}</span><small>{c.last_message || 'Start a conversation'}</small></div><div className="dm-conversation-meta">{c.last_message_at && <time>{new Date(c.last_message_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time>}{Number(c.unread_count) > 0 && <b>{c.unread_count > 9 ? '9+' : c.unread_count}</b>}</div></button>)}{!conversations.length && !query.trim() && <div className="dm-empty">Your conversations will appear here.<br/><span>Search an @username above to start one.</span></div>}</div>
        </> : <>
          <div className="dm-thread">{messages.length ? messages.map(m => <div className={m.sender_id === session.user.id ? 'dm-message mine' : 'dm-message'} key={m.id}><span>{m.body}</span><small>{new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</small></div>) : <div className="dm-empty">Say hello to @{selected.username} 👋</div>}<div ref={endRef}/></div>
          <form className="dm-compose" onSubmit={send}><input value={body} onChange={e => setBody(e.target.value)} maxLength={5000} placeholder={`Message @${selected.username}…`} autoFocus/><button className="primary" disabled={busy || !body.trim()}>{busy ? '…' : 'Send'}</button></form>
          <button className="dm-new" onClick={() => { setSelected(null); setConversationId(null); setMessages([]); refreshConversations(); }}>← All conversations</button>
        </>}
      </section>
    </div>}
  </>;
}
