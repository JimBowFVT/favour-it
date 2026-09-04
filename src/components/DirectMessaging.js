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

const TYPING_TTL_MS = 4500;
const TYPING_HEARTBEAT_MS = 1400;

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
  const conversationIdRef = useRef(null);
  const bodyRef = useRef('');
  const typingChannelsRef = useRef(new Map());
  const typingLastSeenRef = useRef(new Map());
  const typingHeartbeatRef = useRef(null);
  const ownUsername = usernameStatus?.username || session?.user?.user_metadata?.username || 'username';

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const setRemoteTyping = (id, isTyping, timestamp = Date.now()) => {
    if (!id) return;
    if (isTyping) {
      typingLastSeenRef.current.set(id, timestamp);
      setTypingByConversation(current => current[id] ? current : { ...current, [id]: true });
    } else {
      typingLastSeenRef.current.delete(id);
      setTypingByConversation(current => {
        if (!current[id]) return current;
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  };

  const inspectPresence = (id, channel) => {
    try {
      const now = Date.now();
      const state = channel.presenceState();
      const entries = Object.values(state).flat();
      const remote = entries
        .filter(item => item.user_id && item.user_id !== session.user.id && item.typing)
        .map(item => ({ ...item, typing_at: Number(item.typing_at || 0) }))
        .filter(item => item.typing_at > 0 && now - item.typing_at <= TYPING_TTL_MS)
        .sort((a, b) => b.typing_at - a.typing_at)[0];
      setRemoteTyping(id, Boolean(remote), remote?.typing_at || now);
    } catch (_) {}
  };

  const ensureTypingChannel = id => {
    if (!id || !supabase || !session?.user?.id) return null;
    const existing = typingChannelsRef.current.get(id);
    if (existing) return existing.channel;

    const channel = supabase.channel(`direct-typing-${id}`, {
      config: {
        broadcast: { self: false },
        presence: { key: session.user.id },
      },
    });

    channel
      .on('broadcast', { event: 'typing' }, payload => {
        const data = payload?.payload || {};
        if (data.user_id === session.user.id) return;
        setRemoteTyping(id, Boolean(data.typing), Number(data.typing_at || Date.now()));
      })
      .on('presence', { event: 'sync' }, () => inspectPresence(id, channel))
      .on('presence', { event: 'join' }, () => inspectPresence(id, channel))
      .on('presence', { event: 'leave' }, () => inspectPresence(id, channel));

    typingChannelsRef.current.set(id, { channel, subscribed: false });
    channel.subscribe(status => {
      const entry = typingChannelsRef.current.get(id);
      if (!entry || entry.channel !== channel) return;
      if (status === 'SUBSCRIBED') {
        entry.subscribed = true;
        channel.track({ user_id: session.user.id, typing: false, typing_at: 0 }).catch(() => {});
        inspectPresence(id, channel);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        entry.subscribed = false;
      }
    });

    return channel;
  };

  const broadcastTyping = async (id, isTyping) => {
    const entry = typingChannelsRef.current.get(id);
    if (!entry?.channel || !entry.subscribed) return;
    const timestamp = isTyping ? Date.now() : 0;
    const payload = { user_id: session.user.id, typing: Boolean(isTyping), typing_at: timestamp };
    try {
      await entry.channel.track(payload);
      await entry.channel.send({ type: 'broadcast', event: 'typing', payload });
    } catch (_) {}
  };

  const stopTyping = id => {
    if (typingHeartbeatRef.current) {
      window.clearInterval(typingHeartbeatRef.current);
      typingHeartbeatRef.current = null;
    }
    if (id) broadcastTyping(id, false);
  };

  const startTyping = id => {
    if (!id) return;
    if (typingHeartbeatRef.current) window.clearInterval(typingHeartbeatRef.current);
    broadcastTyping(id, true);
    typingHeartbeatRef.current = window.setInterval(() => {
      if (conversationIdRef.current !== id || !bodyRef.current.trim()) {
        stopTyping(id);
        return;
      }
      broadcastTyping(id, true);
    }, TYPING_HEARTBEAT_MS);
  };

  const refreshConversations = async () => {
    try {
      const data = await getMyDirectConversations();
      setConversations(Array.isArray(data) ? data : []);
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

  const markConversationRead = async id => {
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
  }, [session?.user?.id]);

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
    ids.forEach(id => ensureTypingChannel(id));

    typingChannelsRef.current.forEach((entry, id) => {
      if (!ids.has(id)) {
        try { entry.channel.untrack(); } catch (_) {}
        try { supabase.removeChannel(entry.channel); } catch (_) {}
        typingChannelsRef.current.delete(id);
        typingLastSeenRef.current.delete(id);
        setRemoteTyping(id, false);
      }
    });
  }, [conversations, conversationId, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id || !supabase) return undefined;
    const cleanupTimer = window.setInterval(() => {
      const now = Date.now();
      typingLastSeenRef.current.forEach((lastSeen, id) => {
        if (now - lastSeen > TYPING_TTL_MS) setRemoteTyping(id, false);
      });
    }, 1000);

    return () => {
      window.clearInterval(cleanupTimer);
      if (typingHeartbeatRef.current) window.clearInterval(typingHeartbeatRef.current);
      typingHeartbeatRef.current = null;
      typingChannelsRef.current.forEach(entry => {
        try { entry.channel.untrack(); } catch (_) {}
        try { supabase.removeChannel(entry.channel); } catch (_) {}
      });
      typingChannelsRef.current.clear();
      typingLastSeenRef.current.clear();
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
        await markConversationRead(conversationId);
        await refreshReadState(conversationId);
        ensureTypingChannel(conversationId);
      } catch (e) {
        if (active) setError(e.message || 'Could not load messages.');
      }
    };
    load();

    const channel = supabase
      .channel(`direct-chat-${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, payload => {
        const message = payload.new;
        if (message.sender_id === session.user.id) return;
        setMessages(current => current.some(m => m.id === message.id) ? current : [...current, message]);
        playMessagePing(audioRef, true);
        markConversationRead(conversationId);
        refreshConversations();
        refreshReadState(conversationId);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversation_reads', filter: `conversation_id=eq.${conversationId}` }, () => refreshReadState(conversationId))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_reads', filter: `conversation_id=eq.${conversationId}` }, () => refreshReadState(conversationId))
      .subscribe();

    const pollTimer = window.setInterval(() => {
      refreshMessages(conversationId);
      refreshReadState(conversationId);
      const typingChannel = typingChannelsRef.current.get(conversationId)?.channel;
      if (typingChannel) inspectPresence(conversationId, typingChannel);
    }, 2000);
    const readHeartbeat = window.setInterval(() => markConversationRead(conversationId), 2000);

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
    if (!session?.user?.id || !supabase) return undefined;
    const channel = supabase
      .channel(`direct-inbox-${session.user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        if (payload.new.sender_id === session.user.id) return;
        if (payload.new.conversation_id !== conversationIdRef.current) playMessagePing(audioRef, true);
        refreshConversations();
      })
      .subscribe();
    const timer = window.setInterval(refreshConversations, 8000);
    return () => {
      window.clearInterval(timer);
      try { supabase.removeChannel(channel); } catch (_) {}
    };
  }, [session?.user?.id]);

  useEffect(() => { bodyRef.current = body; }, [body]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, typingByConversation]);
  useEffect(() => () => {
    if (typingHeartbeatRef.current) window.clearInterval(typingHeartbeatRef.current);
    try { audioRef.current?.close(); } catch (_) {}
  }, []);

  const unreadCount = conversations.reduce((sum, c) => sum + (c.conversation_id === conversationId && open ? 0 : Number(c.unread_count || 0)), 0);
  const currentTyping = Boolean(conversationId && typingByConversation[conversationId]);
  const lastMine = [...messages].reverse().find(m => m.sender_id === session.user.id);
  const isLastMineRead = Boolean(lastMine?.created_at && otherReadAt && new Date(otherReadAt).getTime() >= new Date(lastMine.created_at).getTime());
  const conversationStatus = currentTyping ? 'typing…' : isLastMineRead ? 'Read' : lastMine ? 'Sent' : 'Online chat';

  const openConversation = async (user, existingId = null) => {
    setBusy(true);
    setError('');
    try {
      const id = existingId || await getOrCreateDirectConversation(user.username);
      ensureTypingChannel(id);
      setSelected(user);
      setConversationId(id);
      conversationIdRef.current = id;
      setQuery('');
      setResults([]);
      setOpen(true);
      if (!audioRef.current) audioRef.current = createPingContext();
      await refreshConversations();
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
    stopTyping(id);
    await markConversationRead(id);
    setSelected(null);
    setConversationId(null);
    conversationIdRef.current = null;
    setMessages([]);
    setBody('');
    bodyRef.current = '';
    setOtherReadAt(null);
    setOpen(true);
    refreshConversations();
  };

  const closeMessenger = async () => {
    const id = conversationIdRef.current;
    stopTyping(id);
    await markConversationRead(id);
    setSelected(null);
    setConversationId(null);
    conversationIdRef.current = null;
    setMessages([]);
    setBody('');
    bodyRef.current = '';
    setOtherReadAt(null);
    setOpen(false);
  };

  const send = async e => {
    e.preventDefault();
    if (!body.trim() || !conversationId || busy) return;
    setBusy(true);
    setError('');
    try {
      const msg = await sendDirectMessage(conversationId, body);
      setMessages(current => current.some(m => m.id === msg.id) ? current : [...current, msg]);
      setBody('');
      bodyRef.current = '';
      stopTyping(conversationId);
      playMessagePing(audioRef, false);
      await refreshConversations();
    } catch (e) {
      setError(e.message || 'Could not send message.');
    } finally {
      setBusy(false);
    }
  };

  const handleBodyChange = e => {
    const value = e.target.value;
    setBody(value);
    bodyRef.current = value;
    if (!conversationId) return;
    if (value.trim()) startTyping(conversationId);
    else stopTyping(conversationId);
  };

  if (!session) return null;

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
                className={`dm-conversation ${Number(c.unread_count) ? 'unread' : ''}`}
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
                  {Number(c.unread_count) > 0 && <b>{Number(c.unread_count) > 9 ? '9+' : c.unread_count}</b>}
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
            <input value={body} onChange={handleBodyChange} maxLength={5000} placeholder={`Message @${selected.username}…`} autoFocus />
            <button className="primary" disabled={busy || !body.trim()}>{busy ? '…' : 'Send'}</button>
          </form>
          <button className="dm-new" onClick={leaveConversation}>← All conversations</button>
        </>}
      </section>
    </div>}
  </>;
}
