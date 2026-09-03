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
    osc.type = 'sine'; osc.frequency.setValueAtTime(740, now); osc.frequency.exponentialRampToValueAtTime(980, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(0.08, now + 0.015); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain); gain.connect(ctx.destination); osc.start(now); osc.stop(now + 0.2);
    window.setTimeout(() => ctx.close().catch(() => {}), 400);
  } catch (_) {}
}

export default function DirectMessaging({ session, usernameStatus }) {
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
  const [otherReadAt, setOtherReadAt] = useState(null);
  const [otherTyping, setOtherTyping] = useState(false);
  const [otherTypingAt, setOtherTypingAt] = useState(0);
  const endRef = useRef(null);
  const presenceRef = useRef(null);
  const typingTimerRef = useRef(null);
  const ownUsername = usernameStatus?.username || session?.user?.user_metadata?.username || 'username';

  const refreshConversations = async () => {
    try { setConversations(await getMyDirectConversations()); } catch (e) { setError(e.message || 'Could not load conversations.'); }
  };

  const refreshReadState = async id => {
    if (!id || !supabase) return;
    try {
      const { data, error: readError } = await supabase.rpc('get_conversation_read_state', { p_conversation_id: id });
      if (readError) throw readError;
      setOtherReadAt(data?.[0]?.other_last_read_at || null);
    } catch (_) {}
  };

  useEffect(() => { if (session) refreshConversations(); }, [session]);
  useEffect(() => {
    if (!open || !query.trim()) { setResults([]); return undefined; }
    const timer = window.setTimeout(() => searchUsersByUsername(query).then(setResults).catch(e => setError(e.message || 'Search failed.')), 220);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  useEffect(() => {
    if (!conversationId || !supabase) return undefined;
    let active = true;
    const load = async () => {
      try {
        const data = await getDirectMessages(conversationId);
        if (active) setMessages(data);
        await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId });
        await refreshReadState(conversationId);
        refreshConversations();
      } catch (e) { if (active) setError(e.message || 'Could not load messages.'); }
    };
    load();

    const channel = supabase.channel(`direct-chat-${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, payload => {
        setMessages(current => {
          if (current.some(m => m.id === payload.new.id)) return current;
          if (payload.new.sender_id !== session.user.id) playMessagePing();
          return [...current, payload.new];
        });
        supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId }).catch(() => {});
        refreshConversations();
        if (payload.new.sender_id !== session.user.id) refreshReadState(conversationId);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversation_reads', filter: `conversation_id=eq.${conversationId}` }, () => refreshReadState(conversationId))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_reads', filter: `conversation_id=eq.${conversationId}` }, () => refreshReadState(conversationId))
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const others = Object.values(state).flat().filter(p => p.user_id !== session.user.id);
        const typing = others.some(p => p.typing && Date.now() - Number(p.typing_at || 0) < 5000);
        setOtherTyping(typing); if (typing) setOtherTypingAt(Date.now());
      })
      .on('presence', { event: 'join' }, ({ key }) => { if (key !== session.user.id) refreshPresence(); })
      .on('presence', { event: 'leave' }, ({ key }) => { if (key !== session.user.id) setOtherTyping(false); })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ user_id: session.user.id, typing: false, typing_at: 0 });
        }
      });

    async function refreshPresence() {
      const state = channel.presenceState();
      const others = Object.values(state).flat().filter(p => p.user_id !== session.user.id);
      const typing = others.some(p => p.typing && Date.now() - Number(p.typing_at || 0) < 5000);
      setOtherTyping(typing); if (typing) setOtherTypingAt(Date.now());
    }

    const readTimer = window.setInterval(() => { refreshReadState(conversationId); refreshPresence(); }, 3000);
    const typingExpiry = window.setInterval(() => {
      if (otherTyping && otherTypingAt && Date.now() - otherTypingAt >= 5000) setOtherTyping(false);
    }, 1000);
    presenceRef.current = channel;
    return () => {
      active = false; window.clearInterval(readTimer); window.clearInterval(typingExpiry);
      try { channel.untrack(); supabase.removeChannel(channel); } catch (_) {}
      presenceRef.current = null;
      setOtherTyping(false); setOtherReadAt(null);
    };
  }, [conversationId, session?.user?.id]);

  useEffect(() => {
    if (!session || !supabase) return undefined;
    const channel = supabase.channel(`direct-inbox-${session.user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        if (payload.new.sender_id === session.user.id) return;
        if (payload.new.conversation_id !== conversationId) playMessagePing();
        refreshConversations();
      }).subscribe();
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

  const updateTyping = async value => {
    const channel = presenceRef.current;
    if (!channel) return;
    try { await channel.track({ user_id: session.user.id, typing: value, typing_at: value ? Date.now() : 0 }); } catch (_) {}
  };
  const handleBodyChange = e => {
    const value = e.target.value;
    setBody(value);
    updateTyping(Boolean(value.trim()));
    window.clearTimeout(typingTimerRef.current);
    if (value.trim()) typingTimerRef.current = window.setTimeout(() => updateTyping(false), 5000);
  };

  const send = async e => {
    e.preventDefault(); if (!body.trim() || !conversationId || busy) return;
    setBusy(true); setError('');
    try { const msg = await sendDirectMessage(conversationId, body); setMessages(v => v.some(m => m.id === msg.id) ? v : [...v, msg]); setBody(''); await updateTyping(false); refreshConversations(); }
    catch (e) { setError(e.message || 'Could not send message.'); }
    finally { setBusy(false); }
  };

  const lastMine = [...messages].reverse().find(m => m.sender_id === session.user.id);
  const isLastMineRead = Boolean(lastMine?.created_at && otherReadAt && new Date(otherReadAt).getTime() >= new Date(lastMine.created_at).getTime());
  const conversationStatus = otherTyping ? 'typing…' : isLastMineRead ? 'Read' : lastMine ? 'Sent' : 'Online chat';

  if (!session) return null;
  return <>
    <button className="dm-fab" onClick={() => { setOpen(true); setError(''); refreshConversations(); }} aria-label="Messages">
      <span className="dm-fab-icon">⌁</span><span>Messages</span>{unreadCount > 0 && <b className="dm-unread-dot">{unreadCount > 9 ? '9+' : unreadCount}</b>}
    </button>
    {open && <div className="dm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <section className="dm-panel">
        <header className="dm-header">
          <div className="dm-header-identity">
            <span className="dm-header-handle">@{ownUsername}</span>
            <span className="dm-header-title">Messages</span>
            {selected && <div className="dm-chatting-with"><span>chatting with</span><strong>{selected.display_name || `@${selected.username}`}</strong><small>@{selected.username}</small><em className={otherTyping ? 'typing-status' : ''}>{conversationStatus}</em></div>}
          </div>
          <button className="dm-close" onClick={() => setOpen(false)} aria-label="Close messages">×</button>
        </header>
        {error && <div className="dm-error">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
        {!selected ? <>
          <div className="dm-search"><span>@</span><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Message someone by @username…" /></div>
          {query.trim() && <div className="dm-results">{results.map(user => <button key={user.user_id} onClick={() => openConversation(user)} disabled={busy}><div className="dm-avatar">{(user.display_name || user.username || 'U').slice(0,1).toUpperCase()}</div><div><strong>{user.display_name || user.username}</strong><span>@{user.username}</span></div><b>→</b></button>)}{!results.length && <p className="dm-empty">No one found for @{query.replace(/^@/,'')}.</p>}</div>}
          <div className="dm-section-title">Recent conversations</div>
          <div className="dm-conversation-list">{conversations.map(c => <button key={c.conversation_id} className={`dm-conversation ${Number(c.unread_count) ? 'unread' : ''}`} onClick={() => openConversation({ username: c.other_username, display_name: c.other_display_name, avatar_url: c.other_avatar_url }, c.conversation_id)}><div className="dm-avatar">{(c.other_display_name || c.other_username || 'U').slice(0,1).toUpperCase()}</div><div className="dm-conversation-copy"><strong>{c.other_display_name || `@${c.other_username}`}</strong><span>@{c.other_username}</span><small>{c.last_message || 'Start a conversation'}</small></div><div className="dm-conversation-meta">{c.last_message_at && <time>{new Date(c.last_message_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time>}{Number(c.unread_count) > 0 && <b>{c.unread_count > 9 ? '9+' : c.unread_count}</b>}</div></button>)}{!conversations.length && !query.trim() && <div className="dm-empty">Your conversations will appear here.<br/><span>Search an @username above to start one.</span></div>}</div>
        </> : <>
          <div className="dm-thread">{messages.length ? messages.map(m => <div className={m.sender_id === session.user.id ? 'dm-message mine' : 'dm-message'} key={m.id}><span>{m.body}</span><small>{new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}{m.sender_id === session.user.id && m.id === lastMine?.id && <b className={`dm-receipt ${isLastMineRead ? 'read' : ''}`}>{isLastMineRead ? '✓✓ Read' : '✓ Sent'}</b>}</small></div>) : <div className="dm-empty">Say hello to @{selected.username} 👋</div>}<div ref={endRef}/></div>
          {otherTyping && <div className="dm-typing"><i></i><i></i><i></i><span>{selected.display_name || `@${selected.username}`} is typing</span></div>}
          <form className="dm-compose" onSubmit={send}><input value={body} onChange={handleBodyChange} onBlur={() => updateTyping(false)} maxLength={5000} placeholder={`Message @${selected.username}…`} autoFocus/><button className="primary" disabled={busy || !body.trim()}>{busy ? '…' : 'Send'}</button></form>
          <button className="dm-new" onClick={() => { setSelected(null); setConversationId(null); setMessages([]); setBody(''); refreshConversations(); }}>← All conversations</button>
        </>}
      </section>
    </div>}
  </>;
}
