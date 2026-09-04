import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getDirectMessages, getMyDirectConversations, getOrCreateDirectConversation, searchUsersByUsername, sendDirectMessage } from '../lib/directMessaging';
import './DirectMessaging.css';

function createPingContext() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch (_) {
    return null;
  }
}

function playMessagePing(audioRef, incoming = true) {
  try {
    const ctx = audioRef.current || createPingContext();
    if (!ctx) return;
    audioRef.current = ctx;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
      return;
    }
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(incoming ? 740 : 620, now);
    osc.frequency.exponentialRampToValueAtTime(incoming ? 980 : 760, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(incoming ? 0.11 : 0.055, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
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
  const [typingByConversation, setTypingByConversation] = useState({});

  const endRef = useRef(null);
  const audioRef = useRef(null);
  const typingChannelsRef = useRef(new Map());
  const typingExpiryTimersRef = useRef(new Map());
  const typingHeartbeatRef = useRef(null);
  const conversationIdRef = useRef(null);
  const bodyRef = useRef('');
  const ownUsername = usernameStatus?.username || session?.user?.user_metadata?.username || 'username';

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const setConversationTyping = (id, isTyping, timestamp = Date.now()) => {
    if (!id) return;
    const previousTimer = typingExpiryTimersRef.current.get(id);
    if (previousTimer) window.clearTimeout(previousTimer);

    setTypingByConversation(current => {
      const next = { ...current };
      if (isTyping) next[id] = timestamp;
      else delete next[id];
      return next;
    });

    if (isTyping) {
      const timer = window.setTimeout(() => {
        setTypingByConversation(current => {
          if (!current[id]) return current;
          const next = { ...current };
          delete next[id];
          return next;
        });
        typingExpiryTimersRef.current.delete(id);
      }, 4000);
      typingExpiryTimersRef.current.set(id, timer);
    } else {
      typingExpiryTimersRef.current.delete(id);
    }
  };

  const readTypingState = channel => {
    try {
      const state = channel.presenceState();
      const now = Date.now();
      const others = Object.values(state).flat().filter(item => item.user_id !== session.user.id);
      const typingEntry = others
        .filter(item => item.typing && now - Number(item.typing_at || 0) < 4000)
        .sort((a, b) => Number(b.typing_at || 0) - Number(a.typing_at || 0))[0];
      setConversationTyping(channel.__favouritConversationId, Boolean(typingEntry), Number(typingEntry?.typing_at || now));
    } catch (_) {}
  };

  const ensureTypingChannel = async id => {
    if (!id || !supabase || !session?.user?.id) return null;
    const existing = typingChannelsRef.current.get(id);
    if (existing) {
      await existing.ready;
      return existing.channel;
    }

    const channel = supabase.channel(`direct-typing-${id}`, {
      config: {
        broadcast: { self: false },
        presence: { key: session.user.id },
      },
    });
    channel.__favouritConversationId = id;

    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    typingChannelsRef.current.set(id, { channel, ready });

    channel
      .on('broadcast', { event: 'typing' }, payload => {
        if (payload.payload?.user_id === session.user.id) return;
        const isTyping = Boolean(payload.payload?.typing);
        const timestamp = Number(payload.payload?.typing_at || Date.now());
        setConversationTyping(id, isTyping, timestamp);
      })
      .on('presence', { event: 'sync' }, () => readTypingState(channel))
      .on('presence', { event: 'join' }, () => readTypingState(channel))
      .on('presence', { event: 'leave' }, () => readTypingState(channel));

    channel.subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        try {
          await channel.track({ user_id: session.user.id, typing: false, typing_at: 0 });
        } catch (_) {}
        readTypingState(channel);
        resolveReady();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        resolveReady();
      }
    });

    await ready;
    return channel;
  };

  const refreshConversations = async () => {
    try {
      const data = await getMyDirectConversations();
      setConversations(data.map(c => (
        c.conversation_id === conversationId && open ? { ...c, unread_count: 0 } : c
      )));
    } catch (e) {
      setError(e.message || 'Could not load conversations.');
    }
  };

  const refreshReadState = async id => {
    if (!id || !supabase) return;
    try {
      const { data, error: readError } = await supabase.rpc('get_conversation_read_state', { p_conversation_id: id });
      if (readError) throw readError;
      setOtherReadAt(data?.[0]?.other_last_read_at || null);
    } catch (_) {}
  };

  const markCurrentConversationRead = async id => {
    if (!id || !supabase) return;
    try { await supabase.rpc('mark_conversation_read', { p_conversation_id: id }); } catch (_) {}
  };

  const refreshMessages = async id => {
    if (!id) return;
    try {
      const data = await getDirectMessages(id);
      setMessages(current => {
        const oldLast = current[current.length - 1]?.id;
        const newLast = data[data.length - 1]?.id;
        if (newLast && newLast !== oldLast && oldLast && data.some(m => m.id === newLast && m.sender_id !== session.user.id)) {
          playMessagePing(audioRef, true);
        }
        return data;
      });
    } catch (_) {}
  };

  useEffect(() => {
    if (session) refreshConversations();
  }, [session, conversationId, open]);

  useEffect(() => {
    if (!open || !query.trim()) {
      setResults([]);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      searchUsersByUsername(query)
        .then(setResults)
        .catch(e => setError(e.message || 'Search failed.'));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  useEffect(() => {
    if (!session?.user?.id || !supabase) return undefined;
    const ids = new Set(conversations.map(c => c.conversation_id).filter(Boolean));
    if (conversationId) ids.add(conversationId);
    ids.forEach(id => { ensureTypingChannel(id).catch(() => {}); });

    typingChannelsRef.current.forEach((entry, id) => {
      if (!ids.has(id)) {
        try { entry.channel.untrack(); } catch (_) {}
        try { supabase.removeChannel(entry.channel); } catch (_) {}
        const expiry = typingExpiryTimersRef.current.get(id);
        if (expiry) window.clearTimeout(expiry);
        typingExpiryTimersRef.current.delete(id);
        typingChannelsRef.current.delete(id);
        setConversationTyping(id, false);
      }
    });
  }, [conversations, conversationId, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id || !supabase) return undefined;
    return () => {
      if (typingHeartbeatRef.current) {
        window.clearInterval(typingHeartbeatRef.current);
        typingHeartbeatRef.current = null;
      }
      typingExpiryTimersRef.current.forEach(timer => window.clearTimeout(timer));
      typingExpiryTimersRef.current.clear();
      typingChannelsRef.current.forEach(entry => {
        try { entry.channel.untrack(); } catch (_) {}
        try { supabase.removeChannel(entry.channel); } catch (_) {}
      });
      typingChannelsRef.current.clear();
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!conversationId || !supabase) return undefined;
    let active = true;
    const load = async () => {
      try {
        const data = await getDirectMessages(conversationId);
        if (!active) return;
        setMessages(data);
        await markCurrentConversationRead(conversationId);
        await refreshReadState(conversationId);
        refreshConversations();
        await ensureTypingChannel(conversationId);
      } catch (e) {
        if (active) setError(e.message || 'Could not load messages.');
      }
    };
    load();
    const channel = supabase
      .channel(`direct-chat-${conversationId}`, { config: { broadcast: { self: false }, presence: { key: session.user.id } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, payload => {
        const message = payload.new;
        if (message.sender_id === session.user.id) return;
        setMessages(current => current.some(m => m.id === message.id) ? current : [...current, message]);
        playMessagePing(audioRef, true);
        markCurrentConversationRead(conversationId);
        refreshConversations();
        refreshReadState(conversationId);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversation_reads', filter: `conversation_id=eq.${conversationId}` }, () => refreshReadState(conversationId))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_reads', filter: `conversation_id=eq.${conversationId}` }, () => refreshReadState(conversationId))
      .subscribe();

    const pollTimer = window.setInterval(() => {
      refreshMessages(conversationId);
      refreshReadState(conversationId);
      const entry = typingChannelsRef.current.get(conversationId);
      if (entry) readTypingState(entry.channel);
    }, 1000);
    const readHeartbeat = window.setInterval(() => markCurrentConversationRead(conversationId), 1500);
    return () => {
      active = false;
      window.clearInterval(pollTimer);
      window.clearInterval(readHeartbeat);
      try { supabase.removeChannel(channel); } catch (_) {}
      setMessages([]);
      setOtherReadAt(null);
    };
  }, [conversationId, session?.user?.id]);

  useEffect(() => {
    if (!session || !supabase) return undefined;
    const channel = supabase
      .channel(`direct-inbox-${session.user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        if (payload.new.sender_id === session.user.id) return;
        if (payload.new.conversation_id !== conversationId) playMessagePing(audioRef, true);
        refreshConversations();
      })
      .subscribe();
    const timer = window.setInterval(refreshConversations, 8000);
    return () => {
      window.clearInterval(timer);
      try { supabase.removeChannel(channel); } catch (_) {}
    };
  }, [session?.user?.id, conversationId]);

  useEffect(() => () => {
    if (typingHeartbeatRef.current) window.clearInterval(typingHeartbeatRef.current);
    try { audioRef.current?.close(); } catch (_) {}
  }, []);

  useEffect(() => { bodyRef.current = body; }, [body]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, typingByConversation]);

  const unreadCount = conversations.reduce((sum, c) => (
    sum + (c.conversation_id === conversationId && open ? 0 : Number(c.unread_count || 0))
  ), 0);

  const updateTyping = async (value, id = conversationIdRef.current) => {
    if (!id || !supabase || !session?.user?.id) return;
    try {
      const channel = await ensureTypingChannel(id);
      if (!channel) return;
      const payload = { user_id: session.user.id, typing: Boolean(value), typing_at: value ? Date.now() : 0 };
      await channel.track(payload);
      await channel.send({ type: 'broadcast', event: 'typing', payload });
    } catch (_) {}
  };

  const stopTypingHeartbeat = async id => {
    if (typingHeartbeatRef.current) {
      window.clearInterval(typingHeartbeatRef.current);
      typingHeartbeatRef.current = null;
    }
    if (id) await updateTyping(false, id);
  };

  const startTypingHeartbeat = id => {
    if (!id) return;
    if (typingHeartbeatRef.current) window.clearInterval(typingHeartbeatRef.current);
    typingHeartbeatRef.current = window.setInterval(() => {
      if (conversationIdRef.current !== id || !bodyRef.current.trim()) {
        stopTypingHeartbeat(id);
        return;
      }
      updateTyping(true, id);
    }, 1500);
  };

  const handleBodyChange = e => {
    const value = e.target.value;
    setBody(value);
    bodyRef.current = value;
    const id = conversationIdRef.current;
    if (!value.trim()) {
      stopTypingHeartbeat(id);
      return;
    }
    updateTyping(true, id);
    startTypingHeartbeat(id);
  };

  const openConversation = async (user, existingId = null) => {
    setBusy(true);
    setError('');
    try {
      const id = existingId || await getOrCreateDirectConversation(user.username);
      await ensureTypingChannel(id);
      setSelected(user);
      setConversationId(id);
      conversationIdRef.current = id;
      setQuery('');
      setResults([]);
      setOpen(true);
      if (!audioRef.current) audioRef.current = createPingContext();
      refreshConversations();
    } catch (e) {
      setError(e.message || 'Could not open conversation.');
    } finally {
      setBusy(false);
    }
  };

  const openMessenger = () => {
    setOpen(true);
    setError('');
    refreshConversations();
    if (!audioRef.current) audioRef.current = createPingContext();
  };

  const leaveConversation = async () => {
    const id = conversationIdRef.current;
    await stopTypingHeartbeat(id);
    await markCurrentConversationRead(id);
    if (id) setConversations(current => current.map(c => c.conversation_id === id ? { ...c, unread_count: 0 } : c));
    setSelected(null);
    setConversationId(null);
    conversationIdRef.current = null;
    setMessages([]);
    setBody('');
    bodyRef.current = '';
    setOtherReadAt(null);
    refreshConversations();
  };

  const closeMessenger = async () => {
    const id = conversationIdRef.current;
    await stopTypingHeartbeat(id);
    await markCurrentConversationRead(id);
    if (id) setConversations(current => current.map(c => c.conversation_id === id ? { ...c, unread_count: 0 } : c));
    setOpen(false);
  };

  const send = async e => {
    e.preventDefault();
    if (!body.trim() || !conversationId || busy) return;
    setBusy(true);
    setError('');
    try {
      const msg = await sendDirectMessage(conversationId, body);
      setMessages(v => v.some(m => m.id === msg.id) ? v : [...v, msg]);
      setBody('');
      bodyRef.current = '';
      await stopTypingHeartbeat(conversationId);
      playMessagePing(audioRef, false);
      refreshConversations();
    } catch (e) {
      setError(e.message || 'Could not send message.');
    } finally {
      setBusy(false);
    }
  };

  if (!session) return null;

  const currentTyping = Boolean(conversationId && typingByConversation[conversationId]);
  const lastMine = [...messages].reverse().find(m => m.sender_id === session.user.id);
  const isLastMineRead = Boolean(lastMine?.created_at && otherReadAt && new Date(otherReadAt).getTime() >= new Date(lastMine.created_at).getTime());
  const conversationStatus = currentTyping ? 'typing…' : isLastMineRead ? 'Read' : lastMine ? 'Sent' : 'Online chat';

  return <>
    <button className="dm-fab" onClick={openMessenger} aria-label="Messages">
      <span className="dm-fab-icon">⌁</span>
      <span>Messages</span>
      {unreadCount > 0 && <b className="dm-unread-dot">{unreadCount > 9 ? '9+' : unreadCount}</b>}
    </button>

    {open && <div className="dm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) closeMessenger(); }}>
      <section className="dm-panel">
        <header className="dm-header">
          <div className="dm-header-identity">
            <span className="dm-header-handle">@{ownUsername}</span>
            <span className="dm-header-title">Messages</span>
            {selected && <div className="dm-chatting-with">
              <span>chatting with</span>
              <strong>{selected.display_name || `@${selected.username}`}</strong>
              <small>@{selected.username}</small>
              <em className={currentTyping ? 'typing-status' : ''}>{conversationStatus}</em>
            </div>}
          </div>
          <button className="dm-close" onClick={closeMessenger} aria-label="Close messages">×</button>
        </header>

        {error && <div className="dm-error">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}

        {!selected ? <>
          <div className="dm-search">
            <span>@</span>
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Message someone by @username…" />
          </div>
          {query.trim() && <div className="dm-results">
            {results.map(user => <button key={user.user_id} onClick={() => openConversation(user)} disabled={busy}>
              <div className="dm-avatar">{(user.display_name || user.username || 'U').slice(0, 1).toUpperCase()}</div>
              <div><strong>{user.display_name || user.username}</strong><span>@{user.username}</span></div>
              <b>→</b>
            </button>)}
            {!results.length && <p className="dm-empty">No one found for @{query.replace(/^@/, '')}.</p>}
          </div>}
          <div className="dm-section-title">Recent conversations</div>
          <div className="dm-conversation-list">
            {conversations.map(c => {
              const isTyping = Boolean(typingByConversation[c.conversation_id]);
              return <button
                key={c.conversation_id}
                className={`dm-conversation ${Number(c.unread_count) && !(c.conversation_id === conversationId && open) ? 'unread' : ''}`}
                onClick={() => openConversation({ username: c.other_username, display_name: c.other_display_name, avatar_url: c.other_avatar_url }, c.conversation_id)}
              >
                <div className="dm-avatar">{(c.other_display_name || c.other_username || 'U').slice(0, 1).toUpperCase()}</div>
                <div className="dm-conversation-copy">
                  <strong>{c.other_display_name || `@${c.other_username}`}</strong>
                  <span>@{c.other_username}</span>
                  <small className={isTyping ? 'dm-preview-typing' : ''}>{isTyping ? 'typing…' : (c.last_message || 'Start a conversation')}</small>
                </div>
                <div className="dm-conversation-meta">
                  {c.last_message_at && !isTyping && <time>{new Date(c.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}
                  {Number(c.unread_count) > 0 && !(c.conversation_id === conversationId && open) && <b>{c.unread_count > 9 ? '9+' : c.unread_count}</b>}
                </div>
              </button>;
            })}
            {!conversations.length && !query.trim() && <div className="dm-empty">Your conversations will appear here.<br /><span>Search an @username above to start one.</span></div>}
          </div>
        </> : <>
          <div className="dm-thread">
            {messages.length ? messages.map(m => <div className={m.sender_id === session.user.id ? 'dm-message mine' : 'dm-message'} key={m.id}>
              <span>{m.body}</span>
              <small>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{m.sender_id === session.user.id && m.id === lastMine?.id && <b className={`dm-receipt ${isLastMineRead ? 'read' : ''}`}>{isLastMineRead ? '✓✓ Read' : '✓ Sent'}</b>}</small>
            </div>) : <div className="dm-empty">Say hello to @{selected.username} 👋</div>}
            <div ref={endRef} />
          </div>
          {currentTyping && <div className="dm-typing" role="status" aria-live="polite"><i></i><i></i><i></i><span>{selected.display_name || `@${selected.username}`} is typing</span></div>}
          <form className="dm-compose" onSubmit={send}>
            <input value={body} onChange={handleBodyChange} onBlur={() => stopTypingHeartbeat(conversationIdRef.current)} maxLength={5000} placeholder={`Message @${selected.username}…`} autoFocus />
            <button className="primary" disabled={busy || !body.trim()}>{busy ? '…' : 'Send'}</button>
          </form>
          <button className="dm-new" onClick={leaveConversation}>← All conversations</button>
        </>}
      </section>
    </div>}
  </>;
}
