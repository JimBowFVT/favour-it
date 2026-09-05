import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  getDirectMessages,
  getMyDirectConversations,
  getOrCreateDirectConversation,
  searchUsersByUsername,
  sendDirectMessage,
  deleteOwnDirectMessage,
  toggleDirectMessageStar,
  reportDirectMessage,
} from '../lib/directMessaging';
import {
  getMySocialGraph,
  listCommunityGroups,
  getCommunityGroupMessages,
  sendCommunityGroupMessage,
  deleteOwnCommunityGroupMessage,
  toggleCommunityGroupMessageStar,
  reportCommunityGroupMessage,
} from '../lib/social';
import { getMyPrivateGroups, createPrivateGroup, sendPrivateGroupMessage, leavePrivateGroup } from '../lib/privateGroups';
import './DirectMessaging.css';

const TYPING_TTL_MS = 5000;
const REPORT_CATEGORIES = ['Harassment or bullying', 'Spam or scam', 'Hate or discrimination', 'Sexual content', 'Violence or threats', 'Impersonation', 'Illegal activity', 'Other'];
const GROUP_ICONS = { designers: '✦', developers: '⌘', 'video-editors': '▣', musicians: '♫', marketers: '↗', photographers: '◉', writers: '✎', entrepreneurs: '◇' };

const initials = name => String(name || 'Favourit member').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase() || 'FV';
const formatTime = value => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
const preferredLanguage = () => {
  try { return localStorage.getItem('favourit_language') || localStorage.getItem('favourit:language') || navigator.language || 'en'; }
  catch (_) { return 'en'; }
};

async function translateText(text) {
  const target = String(preferredLanguage()).split('-')[0].toLowerCase();
  if (!text || (target === 'en' && /^[\x00-\x7F]*$/.test(text))) return text;
  const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${encodeURIComponent(target)}`);
  if (!response.ok) throw new Error('Translation service is unavailable.');
  const data = await response.json();
  return data?.responseData?.translatedText || text;
}

function Avatar({ person, large = false }) {
  const name = person?.display_name || person?.username || person?.other_display_name || person?.other_username || 'Favourit member';
  const src = person?.avatar_url || person?.other_avatar_url;
  return src
    ? <img className={`dm-avatar ${large ? 'large' : ''}`} src={src} alt="" />
    : <span className={`dm-avatar ${large ? 'large' : ''}`}>{initials(name)}</span>;
}

function openProfile(person) {
  const userId = person?.user_id || person?.sender_id || person?.other_user_id || person?.id;
  const username = person?.username || person?.other_username;
  if (!userId && !username) return;
  window.dispatchEvent(new CustomEvent('favourit:open-profile', { detail: { userId, username } }));
}

function createPingContext() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    return AudioContext ? new AudioContext() : null;
  } catch (_) { return null; }
}

function playPing(ref, incoming = true) {
  try {
    const ctx = ref.current || createPingContext();
    if (!ctx) return;
    ref.current = ctx;
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); return; }
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    const osc = ctx.createOscillator();
    osc.frequency.value = incoming ? 760 : 620;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(incoming ? 0.08 : 0.04, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.17);
  } catch (_) {}
}

export default function DirectMessaging({ session }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState('people');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [privateGroups, setPrivateGroups] = useState([]);
  const [communities, setCommunities] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedType, setSelectedType] = useState('direct');
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [otherReadAt, setOtherReadAt] = useState(null);
  const [typingByConversation, setTypingByConversation] = useState({});
  const [menuId, setMenuId] = useState(null);
  const [forwardItem, setForwardItem] = useState(null);
  const [reportItem, setReportItem] = useState(null);
  const [reportCategory, setReportCategory] = useState(REPORT_CATEGORIES[0]);
  const [reportDetails, setReportDetails] = useState('');
  const [translation, setTranslation] = useState(null);
  const [translationBusy, setTranslationBusy] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupFriends, setGroupFriends] = useState([]);
  const [groupMemberIds, setGroupMemberIds] = useState([]);

  const audioRef = useRef(null);
  const endRef = useRef(null);
  const bodyRef = useRef('');
  const conversationRef = useRef(null);
  const typingChannelsRef = useRef(new Map());
  const typingLastSeenRef = useRef(new Map());
  const touchStartRef = useRef({ id: '', x: 0 });

  useEffect(() => { conversationRef.current = conversationId; }, [conversationId]);
  useEffect(() => { bodyRef.current = body; }, [body]);

  const setRemoteTyping = (id, timestamp = Date.now()) => {
    typingLastSeenRef.current.set(id, Number(timestamp) || Date.now());
    setTypingByConversation(current => current[id] ? current : { ...current, [id]: true });
  };

  const ensureTypingChannel = id => {
    if (!id || !session?.user?.id || !supabase) return Promise.resolve(null);
    const existing = typingChannelsRef.current.get(id);
    if (existing) return existing.ready;

    const channel = supabase.channel(`direct-typing-${id}`, { config: { broadcast: { self: false } } });
    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const entry = { channel, subscribed: false, ready };
    typingChannelsRef.current.set(id, entry);

    channel
      .on('broadcast', { event: 'typing' }, event => {
        const payload = event?.payload || {};
        if (payload.user_id === session.user.id || payload.conversation_id !== id) return;
        setRemoteTyping(id, payload.typing_at);
      })
      .subscribe(status => {
        const current = typingChannelsRef.current.get(id);
        if (!current || current.channel !== channel) return;
        if (status === 'SUBSCRIBED') {
          current.subscribed = true;
          resolveReady(channel);
        } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          typingChannelsRef.current.delete(id);
          try { supabase.removeChannel(channel); } catch (_) {}
          resolveReady(null);
        }
      });

    return ready;
  };

  const announceTyping = id => {
    if (!id || selectedType === 'community' || !bodyRef.current.trim()) return;
    ensureTypingChannel(id).then(channel => {
      const entry = typingChannelsRef.current.get(id);
      if (!channel || !entry?.subscribed) return;
      entry.channel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { conversation_id: id, user_id: session.user.id, typing_at: Date.now() },
      }).catch(() => {});
    }).catch(() => {});
  };

  const refreshPeople = async () => {
    const data = await getMyDirectConversations();
    const safe = Array.isArray(data) ? data : [];
    setConversations(safe);
    if (selectedType === 'direct' && conversationRef.current) {
      const current = safe.find(item => item.conversation_id === conversationRef.current);
      if (current) setSelected({
        user_id: current.other_user_id,
        username: current.other_username,
        display_name: current.other_display_name,
        avatar_url: current.other_avatar_url,
        is_friend: current.is_friend,
        is_online: current.is_online,
        last_seen_at: current.last_seen_at,
      });
    }
    return safe;
  };

  const refreshPrivateGroups = async () => {
    const data = await getMyPrivateGroups();
    const safe = Array.isArray(data) ? data : [];
    setPrivateGroups(safe);
    if (selectedType === 'group' && conversationRef.current) {
      const current = safe.find(group => group.conversation_id === conversationRef.current);
      if (current) setSelected(current);
    }
    return safe;
  };

  const refreshCommunities = async () => {
    const data = await listCommunityGroups();
    const joined = (Array.isArray(data) ? data : []).filter(group => group.is_joined);
    setCommunities(joined);
    return joined;
  };

  const refreshInbox = async () => {
    try { await Promise.all([refreshPeople(), refreshPrivateGroups(), refreshCommunities()]); }
    catch (e) { setError(e.message || 'Could not load messages.'); }
  };

  const markRead = async id => {
    if (!id || !supabase) return;
    try { await supabase.rpc('mark_conversation_read', { p_conversation_id: id }); }
    catch (_) {}
  };

  const refreshReadState = async id => {
    if (!id || !supabase) return;
    try {
      const { data, error: readError } = await supabase.rpc('get_conversation_read_state', { p_conversation_id: id });
      if (!readError) setOtherReadAt(data?.[0]?.other_last_read_at || null);
    } catch (_) {}
  };

  const loadThread = async (id, type = selectedType) => {
    if (!id) return;
    if (type === 'community') {
      const data = await getCommunityGroupMessages(id);
      setMessages(Array.isArray(data) ? data : []);
      return;
    }
    const data = await getDirectMessages(id);
    setMessages(Array.isArray(data) ? data : []);
    await markRead(id);
    if (type === 'direct') await refreshReadState(id);
    await ensureTypingChannel(id);
  };

  useEffect(() => {
    if (!session?.user?.id) return undefined;
    refreshInbox();
    const timer = window.setInterval(() => Promise.all([refreshPeople(), refreshPrivateGroups()]).catch(() => {}), 7000);
    return () => window.clearInterval(timer);
  }, [session?.user?.id]);

  useEffect(() => {
    if (!open || !query.trim() || section !== 'people') {
      setResults([]);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      searchUsersByUsername(query).then(data => setResults(Array.isArray(data) ? data : [])).catch(e => setError(e.message || 'Search failed.'));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [open, query, section]);

  useEffect(() => {
    if (!session?.user?.id) return undefined;
    conversations.forEach(item => ensureTypingChannel(item.conversation_id));
    privateGroups.forEach(item => ensureTypingChannel(item.conversation_id));
    const timer = window.setInterval(() => {
      const now = Date.now();
      typingLastSeenRef.current.forEach((timestamp, id) => {
        if (now - timestamp < TYPING_TTL_MS) return;
        typingLastSeenRef.current.delete(id);
        setTypingByConversation(current => {
          if (!current[id]) return current;
          const next = { ...current };
          delete next[id];
          return next;
        });
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [conversations, privateGroups, session?.user?.id]);

  useEffect(() => {
    if (!conversationId || !selected) return undefined;
    let active = true;
    const refresh = async () => {
      try { await loadThread(conversationId, selectedType); }
      catch (e) { if (active) setError(e.message || 'Could not load conversation.'); }
    };
    refresh();
    const timer = window.setInterval(refresh, selectedType === 'community' ? 2200 : 1800);
    return () => { active = false; window.clearInterval(timer); };
  }, [conversationId, selectedType]);

  useEffect(() => {
    if (!supabase || !session?.user?.id) return undefined;
    const channel = supabase
      .channel(`direct-inbox-${session.user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        if (payload.new.sender_id !== session.user.id) {
          if (payload.new.conversation_id !== conversationRef.current) playPing(audioRef, true);
          Promise.all([refreshPeople(), refreshPrivateGroups()]).catch(() => {});
        }
      })
      .subscribe();
    return () => { try { supabase.removeChannel(channel); } catch (_) {} };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!menuId) return undefined;
    const close = () => setMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, typingByConversation]);
  useEffect(() => () => {
    typingChannelsRef.current.forEach(({ channel }) => { try { supabase?.removeChannel(channel); } catch (_) {} });
    try { audioRef.current?.close(); } catch (_) {}
  }, []);

  const openMessenger = () => {
    setOpen(true);
    setError('');
    refreshInbox();
    if (!audioRef.current) audioRef.current = createPingContext();
  };

  const openDirect = async user => {
    if (!user?.username || busy) return;
    setBusy(true);
    setError('');
    try {
      const id = await getOrCreateDirectConversation(user.username);
      await ensureTypingChannel(id);
      const fresh = await refreshPeople();
      const row = fresh.find(item => item.conversation_id === id);
      setSelected(row ? {
        user_id: row.other_user_id,
        username: row.other_username,
        display_name: row.other_display_name,
        avatar_url: row.other_avatar_url,
        is_friend: row.is_friend,
        is_online: row.is_online,
        last_seen_at: row.last_seen_at,
      } : user);
      setSelectedType('direct');
      setConversationId(id);
      conversationRef.current = id;
      setSection(row?.is_friend ? 'people' : 'requests');
      setQuery('');
      setResults([]);
      setOpen(true);
    } catch (e) {
      setError(e.message || 'Could not open conversation.');
    } finally {
      setBusy(false);
    }
  };

  const openExisting = item => {
    setSelected({
      user_id: item.other_user_id,
      username: item.other_username,
      display_name: item.other_display_name,
      avatar_url: item.other_avatar_url,
      is_friend: item.is_friend,
      is_online: item.is_online,
      last_seen_at: item.last_seen_at,
    });
    setSelectedType('direct');
    setConversationId(item.conversation_id);
    conversationRef.current = item.conversation_id;
    setSection(item.is_friend ? 'people' : 'requests');
    setMenuId(null);
    setOpen(true);
  };

  const openPrivateGroup = group => {
    setSelected(group);
    setSelectedType('group');
    setConversationId(group.conversation_id);
    conversationRef.current = group.conversation_id;
    setSection('groups');
    setMenuId(null);
    setOpen(true);
  };

  const openCommunity = group => {
    setSelected(group);
    setSelectedType('community');
    setConversationId(group.id);
    conversationRef.current = group.id;
    setSection('communities');
    setMenuId(null);
    setOpen(true);
  };

  useEffect(() => {
    const handler = event => {
      if (event.detail?.username) openDirect({ username: event.detail.username });
    };
    window.addEventListener('favourit:open-direct-message', handler);
    return () => window.removeEventListener('favourit:open-direct-message', handler);
  }, [busy]);

  const leaveThread = async () => {
    if (conversationId && selectedType !== 'community') await markRead(conversationId);
    setSelected(null);
    setSelectedType('direct');
    setConversationId(null);
    conversationRef.current = null;
    setMessages([]);
    setBody('');
    bodyRef.current = '';
    setReplyTo(null);
    setOtherReadAt(null);
    setOpen(true);
    refreshInbox();
  };

  const closeMessenger = async () => {
    if (conversationId && selectedType !== 'community') await markRead(conversationId);
    setOpen(false);
    setSelected(null);
    setConversationId(null);
    conversationRef.current = null;
    setMessages([]);
    setBody('');
    bodyRef.current = '';
    setReplyTo(null);
    setOtherReadAt(null);
  };

  const send = async event => {
    event.preventDefault();
    if (!body.trim() || !conversationId || busy) return;
    setBusy(true);
    setError('');
    try {
      if (selectedType === 'direct') {
        await sendDirectMessage(conversationId, body.trim(), replyTo?.id || null);
        playPing(audioRef, false);
      } else if (selectedType === 'group') {
        await sendPrivateGroupMessage(selected.group_id, body.trim(), replyTo?.id || null);
        playPing(audioRef, false);
      } else {
        await sendCommunityGroupMessage(conversationId, body.trim(), replyTo?.id || null);
      }
      setBody('');
      bodyRef.current = '';
      setReplyTo(null);
      await loadThread(conversationId, selectedType);
      await refreshInbox();
    } catch (e) {
      setError(e.message || 'Could not send message.');
    } finally {
      setBusy(false);
    }
  };

  const handleBody = event => {
    const value = event.target.value;
    setBody(value);
    bodyRef.current = value;
    if (selectedType !== 'community' && value.trim()) announceTyping(conversationId);
  };

  const removeMessage = async item => {
    if (busy || item.is_deleted) return;
    const mine = item.sender_id === session.user.id;
    const withinWindow = Date.now() - new Date(item.created_at).getTime() <= 15 * 60 * 1000;
    if (!mine || !withinWindow) {
      setError('Messages can only be deleted by their sender within 15 minutes.');
      setMenuId(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (selectedType === 'community') await deleteOwnCommunityGroupMessage(item.id);
      else await deleteOwnDirectMessage(item.id);
      await loadThread(conversationId, selectedType);
    } catch (e) {
      setError(e.message || 'Could not delete message.');
    } finally {
      setBusy(false);
      setMenuId(null);
    }
  };

  const starMessage = async item => {
    if (busy || item.is_deleted) return;
    setBusy(true);
    setError('');
    try {
      if (selectedType === 'community') await toggleCommunityGroupMessageStar(item.id);
      else await toggleDirectMessageStar(item.id);
      await loadThread(conversationId, selectedType);
    } catch (e) {
      setError(e.message || 'Could not update star.');
    } finally {
      setBusy(false);
      setMenuId(null);
    }
  };

  const copyMessage = async item => {
    if (!item?.body || item.is_deleted) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(item.body);
      else {
        const area = document.createElement('textarea');
        area.value = item.body;
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
    } catch (_) { setError('Could not copy message.'); }
    setMenuId(null);
  };

  const openReport = item => {
    if (!item || item.sender_id === session.user.id) return;
    setReportItem(item);
    setReportCategory(REPORT_CATEGORIES[0]);
    setReportDetails('');
    setMenuId(null);
  };

  const submitReport = async () => {
    if (!reportItem || busy || reportItem.sender_id === session.user.id) return;
    setBusy(true);
    setError('');
    try {
      if (selectedType === 'community') await reportCommunityGroupMessage(reportItem.id, reportCategory, reportDetails.trim());
      else await reportDirectMessage(reportItem.id, reportCategory, reportDetails.trim());
      setReportItem(null);
      setReportDetails('');
      setReportCategory(REPORT_CATEGORIES[0]);
    } catch (e) {
      setError(e.message || 'Could not submit report.');
    } finally {
      setBusy(false);
    }
  };

  const forward = async target => {
    if (!forwardItem || forwardItem.is_deleted || busy) return;
    setBusy(true);
    setError('');
    try {
      if (target.type === 'direct') await sendDirectMessage(target.id, forwardItem.body);
      else if (target.type === 'group') await sendPrivateGroupMessage(target.groupId, forwardItem.body);
      else await sendCommunityGroupMessage(target.id, forwardItem.body);
      setForwardItem(null);
      setMenuId(null);
    } catch (e) {
      setError(e.message || 'Could not forward message.');
    } finally {
      setBusy(false);
    }
  };

  const translate = async item => {
    if (!item?.body || item.is_deleted) return;
    setMenuId(null);
    setTranslation({ item, text: '' });
    setTranslationBusy(true);
    try { setTranslation({ item, text: await translateText(item.body) }); }
    catch (e) { setTranslation({ item, text: e.message || 'Could not translate message.' }); }
    finally { setTranslationBusy(false); }
  };

  const onTouchStart = (item, event) => {
    touchStartRef.current = { id: item.id, x: event.touches?.[0]?.clientX || 0 };
  };

  const onTouchEnd = (item, event) => {
    const start = touchStartRef.current;
    const endX = event.changedTouches?.[0]?.clientX || 0;
    if (start.id === item.id && endX - start.x > 60 && !item.is_deleted) setReplyTo(item);
    touchStartRef.current = { id: '', x: 0 };
  };

  const openCreateGroup = async () => {
    setError('');
    try {
      const graph = await getMySocialGraph();
      setGroupFriends(Array.isArray(graph?.friends) ? graph.friends : []);
      setGroupName('');
      setGroupMemberIds([]);
      setCreateGroupOpen(true);
    } catch (e) { setError(e.message || 'Could not load your friends.'); }
  };

  const toggleGroupFriend = userId => {
    setGroupMemberIds(current => current.includes(userId) ? current.filter(id => id !== userId) : current.length >= 19 ? current : [...current, userId]);
  };

  const createGroup = async () => {
    if (busy || groupName.trim().length < 2 || !groupMemberIds.length) return;
    setBusy(true);
    setError('');
    try {
      const groupId = await createPrivateGroup(groupName.trim(), groupMemberIds);
      const fresh = await refreshPrivateGroups();
      const group = fresh.find(item => item.group_id === groupId);
      setCreateGroupOpen(false);
      setGroupName('');
      setGroupMemberIds([]);
      if (group) openPrivateGroup(group);
    } catch (e) { setError(e.message || 'Could not create group.'); }
    finally { setBusy(false); }
  };

  const leaveCurrentGroup = async () => {
    if (selectedType !== 'group' || !selected?.group_id || busy) return;
    if (!window.confirm(`Leave ${selected.name}?`)) return;
    setBusy(true);
    setError('');
    try {
      await leavePrivateGroup(selected.group_id);
      await leaveThread();
      await refreshPrivateGroups();
    } catch (e) { setError(e.message || 'Could not leave group.'); }
    finally { setBusy(false); }
  };

  const directUnread = conversations.reduce((sum, item) => sum + (item.conversation_id === conversationId && open ? 0 : Number(item.unread_count || 0)), 0);
  const groupUnread = privateGroups.reduce((sum, item) => sum + (item.conversation_id === conversationId && open ? 0 : Number(item.unread_count || 0)), 0);
  const unread = directUnread + groupUnread;
  const currentTyping = Boolean(selectedType !== 'community' && conversationId && typingByConversation[conversationId]);
  const friendOnline = Boolean(selectedType === 'direct' && selected?.is_friend && selected?.is_online);
  const lastMine = [...messages].reverse().find(item => item.sender_id === session.user.id);
  const isRead = Boolean(lastMine?.created_at && otherReadAt && new Date(otherReadAt).getTime() >= new Date(lastMine.created_at).getTime());
  const lastSeen = selectedType === 'direct' && selected?.is_friend && selected?.last_seen_at
    ? `Last seen ${new Date(selected.last_seen_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    : '';
  const conversationMeta = selectedType === 'community'
    ? `${Number(selected?.member_count || 0).toLocaleString()} members`
    : selectedType === 'group'
      ? (currentTyping ? 'typing…' : `${Number(selected?.member_count || 0).toLocaleString()} members`)
      : currentTyping
        ? 'typing…'
        : friendOnline
          ? 'Online'
          : lastSeen || (isRead ? 'Read' : lastMine ? 'Sent' : '');

  const peopleConversations = useMemo(() => conversations.filter(item => Boolean(item.is_friend)), [conversations]);
  const messageRequests = useMemo(() => conversations.filter(item => !item.is_friend), [conversations]);
  const requestUnread = useMemo(() => messageRequests.reduce((sum, item) => sum + Number(item.unread_count || 0), 0), [messageRequests]);

  const forwardTargets = useMemo(() => [
    ...conversations.map(item => ({ type: 'direct', id: item.conversation_id, label: item.other_display_name || `@${item.other_username}`, subtitle: `@${item.other_username}`, avatar_url: item.other_avatar_url })),
    ...privateGroups.map(group => ({ type: 'group', id: group.conversation_id, groupId: group.group_id, label: group.name, subtitle: `${group.member_count} members`, icon: '◎' })),
    ...communities.map(group => ({ type: 'community', id: group.id, label: group.name, subtitle: 'Community', icon: GROUP_ICONS[group.slug] || '◇' })),
  ], [conversations, privateGroups, communities]);

  if (!session) return null;

  return <>
    <button className="dm-fab" onClick={openMessenger} aria-label="Messages">
      <span className="dm-fab-icon">⌁</span><span>Messages</span>
      {unread > 0 && <b className="dm-unread-dot">{unread > 9 ? '9+' : unread}</b>}
    </button>

    {open && <div className="dm-overlay" onMouseDown={event => { if (event.target === event.currentTarget) closeMessenger(); }}>
      <section className={`dm-panel ${selected ? 'is-thread' : 'is-inbox'}`}>
        {!selected ? <>
          <header className="dm-header">
            <div><div className="eyebrow">FAVOURIT</div><h2>Messages</h2><p>People, groups, communities and message requests.</p></div>
            <button className="dm-close" onClick={closeMessenger} type="button" aria-label="Close">×</button>
          </header>
          <div className="dm-sections">
            <button className={section === 'people' ? 'active' : ''} onClick={() => setSection('people')} type="button">People <span>{peopleConversations.length}</span></button>
            <button className={section === 'groups' ? 'active' : ''} onClick={() => setSection('groups')} type="button">Groups <span>{privateGroups.length}</span></button>
            <button className={section === 'communities' ? 'active' : ''} onClick={() => setSection('communities')} type="button">Communities <span>{communities.length}</span></button>
            <button className={section === 'requests' ? 'active requests' : 'requests'} onClick={() => setSection('requests')} type="button">Requests {messageRequests.length > 0 && <span className={requestUnread > 0 ? 'request-alert' : ''}>{requestUnread > 0 ? (requestUnread > 9 ? '9+' : requestUnread) : messageRequests.length}</span>}</button>
          </div>
          {error && <div className="dm-error">{error}</div>}

          {section === 'people' && <>
            <label className="dm-search"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search @username…" /></label>
            {query.trim() && <div className="dm-search-results">{results.map(person => <button key={person.user_id || person.id || person.username} onClick={() => openDirect(person)} type="button"><Avatar person={person} /><span className="dm-list-copy"><strong>{person.display_name || person.username}</strong><small>@{person.username}</small></span></button>)}</div>}
            {!query.trim() && <div className="dm-list">{peopleConversations.length ? peopleConversations.map(item => <button className="dm-list-row" key={item.conversation_id} onClick={() => openExisting(item)} type="button"><Avatar person={item} /><span className="dm-list-copy"><strong>{item.other_display_name || item.other_username}{item.is_online && <i className="online-dot" />}</strong><small>{typingByConversation[item.conversation_id] ? 'typing…' : item.last_message || `@${item.other_username}`}</small></span><span className="dm-list-meta"><time>{formatTime(item.last_message_at)}</time>{Number(item.unread_count || 0) > 0 && <b>{Number(item.unread_count) > 9 ? '9+' : item.unread_count}</b>}</span></button>) : <div className="dm-empty"><h3>No friend chats yet.</h3><p>Search for someone by @username to start a private chat.</p></div>}</div>}
          </>}

          {section === 'groups' && <><div className="dm-section-toolbar"><div><strong>Private groups</strong><small>Chat with up to 20 friends.</small></div><button className="primary small" onClick={openCreateGroup} type="button">+ New group</button></div><div className="dm-list">{privateGroups.length ? privateGroups.map(group => <button className="dm-list-row" key={group.group_id} onClick={() => openPrivateGroup(group)} type="button"><span className="dm-community-icon private">◎</span><span className="dm-list-copy"><strong>{group.name}</strong><small>{typingByConversation[group.conversation_id] ? 'typing…' : group.last_message || `${group.member_count} members`}</small></span><span className="dm-list-meta"><time>{formatTime(group.last_message_at)}</time>{Number(group.unread_count || 0) > 0 && <b>{Number(group.unread_count) > 9 ? '9+' : group.unread_count}</b>}</span></button>) : <div className="dm-empty"><h3>No private groups yet.</h3><p>Create one with your friends and it will stay separate from Community chats.</p><button className="primary small" onClick={openCreateGroup} type="button">Create your first group</button></div>}</div></>}

          {section === 'communities' && <div className="dm-list">{communities.length ? communities.map(group => <button className="dm-list-row" key={group.id} onClick={() => openCommunity(group)} type="button"><span className="dm-community-icon">{GROUP_ICONS[group.slug] || '◇'}</span><span className="dm-list-copy"><strong>{group.name}</strong><small>{Number(group.member_count || 0).toLocaleString()} members · Community</small></span></button>) : <div className="dm-empty"><h3>No joined communities.</h3><p>Join a skill community and its chat will appear here automatically.</p></div>}</div>}

          {section === 'requests' && <div className="dm-list dm-request-list">{messageRequests.length ? messageRequests.map(item => <button className="dm-list-row" key={item.conversation_id} onClick={() => openExisting(item)} type="button"><Avatar person={item} /><span className="dm-list-copy"><strong>{item.other_display_name || item.other_username}</strong><small>{typingByConversation[item.conversation_id] ? 'typing…' : item.last_message || `Message request from @${item.other_username}`}</small></span><span className="dm-list-meta"><time>{formatTime(item.last_message_at)}</time>{Number(item.unread_count || 0) > 0 && <b>{Number(item.unread_count) > 9 ? '9+' : item.unread_count}</b>}</span></button>) : <div className="dm-empty"><h3>No message requests.</h3><p>Chats with people outside your friends list will appear here.</p></div>}</div>}
          </>
        : <>
          <header className="dm-thread-header">
            <button className="dm-back" onClick={leaveThread} type="button" aria-label="Back">←</button>
            {selectedType === 'direct' ? <button className="dm-thread-identity" onClick={() => openProfile(selected)} type="button"><Avatar person={selected} large /><span><strong>{selected.display_name || selected.username}</strong><small>@{selected.username}</small><em>{conversationMeta}</em></span>{selected.is_friend && <i className={`thread-online ${friendOnline ? 'on' : ''}`} />}</button>
            : selectedType === 'group' ? <div className="dm-thread-identity"><span className="dm-community-icon private">◎</span><span><strong>{selected.name}</strong><small>Private group</small><em>{conversationMeta}</em></span></div>
            : <div className="dm-thread-identity"><span className="dm-community-icon">{GROUP_ICONS[selected.slug] || '◇'}</span><span><strong>{selected.name}</strong><small>Community</small><em>{conversationMeta}</em></span></div>}
            {selectedType === 'group' && <button className="dm-leave-group" onClick={leaveCurrentGroup} disabled={busy} type="button">Leave</button>}
            <button className="dm-close" onClick={closeMessenger} type="button" aria-label="Close">×</button>
          </header>
          {error && <div className="dm-error">{error}</div>}
          <div className="dm-messages">
            {messages.map(item => {
              const mine = item.sender_id === session.user.id;
              const canDelete = mine && !item.is_deleted && Date.now() - new Date(item.created_at).getTime() <= 15 * 60 * 1000;
              const deletedReportOnly = Boolean(item.is_deleted && !mine);
              const showActions = !item.is_deleted || deletedReportOnly;
              const sender = { user_id: item.sender_id, username: item.username, display_name: item.display_name, avatar_url: item.avatar_url };
              return <div className={`dm-message-row ${mine ? 'mine' : ''} ${item.is_deleted ? 'deleted' : ''}`} key={item.id} onTouchStart={event => onTouchStart(item, event)} onTouchEnd={event => onTouchEnd(item, event)}>
                {!mine && <Avatar person={sender} />}
                <div className="dm-message-wrap">
                  <div className="dm-message-head">{!mine && <button onClick={() => openProfile(sender)} type="button">{item.display_name || `@${item.username || 'member'}`}</button>}<time>{formatTime(item.created_at)}</time>{!item.is_deleted && item.is_starred && <span className="star-mark">★</span>}</div>
                  {!item.is_deleted && item.reply_to_message_id && <div className="dm-reply-preview">↩ @{item.reply_to_username || 'member'} · {item.reply_to_body || 'Message'}</div>}
                  <div className="dm-message-line"><p>{item.body}</p>{showActions && <><button className="dm-more" type="button" aria-label={deletedReportOnly ? 'Report deleted message' : 'Message options'} onClick={event => { event.stopPropagation(); setMenuId(value => value === item.id ? null : item.id); }}>•••</button>{menuId === item.id && <div className="dm-message-menu" onClick={event => event.stopPropagation()}>
                    {item.is_deleted ? <button type="button" onClick={() => openReport(item)}>Report</button> : <>
                      <button type="button" onClick={() => { setReplyTo(item); setMenuId(null); }}>Reply</button>
                      <button type="button" onClick={() => { setForwardItem(item); setMenuId(null); }}>Forward</button>
                      <button type="button" onClick={() => copyMessage(item)}>Copy</button>
                      <button type="button" onClick={() => starMessage(item)}>{item.is_starred ? 'Unstar' : 'Star'}</button>
                      {mine ? <button type="button" disabled={!canDelete} onClick={() => removeMessage(item)}>{canDelete ? 'Delete' : 'Delete expired'}</button> : <><button type="button" onClick={() => translate(item)}>Translate</button><button type="button" onClick={() => openReport(item)}>Report</button></>}
                    </>}
                  </div>}</>}
                  </div>
                </div>
              </div>;
            })}
            {currentTyping && <div className="dm-typing"><span /><span /><span /></div>}
            <div ref={endRef} />
          </div>
          {replyTo && <div className="dm-reply-bar"><div><span>Replying to @{replyTo.username || 'member'}</span><small>{replyTo.body}</small></div><button onClick={() => setReplyTo(null)} type="button">×</button></div>}
          <form className="dm-composer" onSubmit={send}><input value={body} maxLength={selectedType === 'community' ? 2000 : 5000} onChange={handleBody} placeholder={selectedType === 'community' ? `Message ${selected.name}…` : selectedType === 'group' ? `Message ${selected.name}…` : `Message @${selected.username}…`} /><button className="primary" disabled={!body.trim() || busy} type="submit">Send</button></form>
        </>}

        {createGroupOpen && <div className="dm-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCreateGroupOpen(false); }}><div className="dm-modal dm-create-group"><header><div><div className="eyebrow">PRIVATE GROUP</div><h3>New group</h3></div><button onClick={() => setCreateGroupOpen(false)} type="button">×</button></header><label className="dm-group-name"><span>Group name</span><input value={groupName} maxLength={80} onChange={event => setGroupName(event.target.value)} placeholder="Project crew" /></label><div className="dm-group-picker-head"><strong>Choose friends</strong><small>{groupMemberIds.length}/19 selected</small></div><div className="dm-group-friends">{groupFriends.length ? groupFriends.map(friend => { const id = friend.id || friend.user_id; const checked = groupMemberIds.includes(id); return <button className={checked ? 'selected' : ''} key={id} type="button" onClick={() => toggleGroupFriend(id)}><Avatar person={friend} /><span><strong>{friend.display_name || friend.username}</strong><small>@{friend.username}</small></span><i>{checked ? '✓' : '+'}</i></button>; }) : <div className="dm-empty compact"><p>Add friends first, then you can create a private group with them.</p></div>}</div><div className="dm-modal-actions"><button className="secondary" type="button" onClick={() => setCreateGroupOpen(false)}>Cancel</button><button className="primary" type="button" onClick={createGroup} disabled={busy || groupName.trim().length < 2 || !groupMemberIds.length}>{busy ? 'Creating…' : 'Create group'}</button></div></div></div>}

        {forwardItem && <div className="dm-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setForwardItem(null); }}><div className="dm-modal"><header><div><div className="eyebrow">FORWARD</div><h3>Send to…</h3></div><button onClick={() => setForwardItem(null)} type="button">×</button></header><div className="dm-forward-preview">{forwardItem.body}</div><div className="dm-forward-list">{forwardTargets.map(target => <button key={`${target.type}-${target.id}`} onClick={() => forward(target)} type="button">{target.avatar_url ? <Avatar person={{ avatar_url: target.avatar_url, display_name: target.label }} /> : target.icon ? <span className="dm-community-icon">{target.icon}</span> : <Avatar person={{ display_name: target.label }} />}<span><strong>{target.label}</strong><small>{target.subtitle}</small></span></button>)}</div></div></div>}

        {reportItem && <div className="dm-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setReportItem(null); }}><div className="dm-modal"><header><div><div className="eyebrow">REPORT</div><h3>Report message</h3></div><button onClick={() => setReportItem(null)} type="button">×</button></header><select value={reportCategory} onChange={event => setReportCategory(event.target.value)}>{REPORT_CATEGORIES.map(category => <option key={category}>{category}</option>)}</select><textarea value={reportDetails} maxLength={2000} onChange={event => setReportDetails(event.target.value)} placeholder="Tell us what happened…" /><div className="dm-modal-actions"><button className="secondary" type="button" onClick={() => setReportItem(null)}>Cancel</button><button className="primary" type="button" onClick={submitReport} disabled={busy}>Submit</button></div></div></div>}

        {translation && <div className="dm-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setTranslation(null); }}><div className="dm-modal"><header><div><div className="eyebrow">TRANSLATE</div><h3>Translation</h3></div><button onClick={() => setTranslation(null)} type="button">×</button></header><div className="dm-translation-original">{translation.item.body}</div><div className="dm-translation-result">{translationBusy ? 'Translating…' : translation.text}</div></div></div>}
      </section>
    </div>}
  </>;
}