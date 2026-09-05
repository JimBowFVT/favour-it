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
  listCommunityGroups,
  getCommunityGroupMessages,
  sendCommunityGroupMessage,
  deleteOwnCommunityGroupMessage,
  toggleCommunityGroupMessageStar,
  reportCommunityGroupMessage,
} from '../lib/social';
import { getMyFavoriteDeals } from '../lib/favorites';
import { uploadMessageMedia, MAX_MESSAGE_MEDIA_FILES } from '../lib/messageMedia';
import { translateMessageText } from '../lib/translation';
import { normalizeLanguageCode } from '../data/languages';
import { DealMessageCard, DraftRichContent, MessageRichContent } from './MessageRichContent';
import './DirectMessaging.css';
import './DirectMessagingV2.css';
import './DirectMessagingRich.css';

const TYPING_TTL_MS = 5000;
const REPORT_CATEGORIES = ['Harassment or bullying', 'Spam or scam', 'Hate or discrimination', 'Sexual content', 'Violence or threats', 'Impersonation', 'Illegal activity', 'Other'];
const GROUP_ICONS = { designers: '✦', developers: '⌘', 'video-editors': '▣', musicians: '♫', marketers: '↗', photographers: '◉', writers: '✎', entrepreneurs: '◇' };

const initials = name => String(name || 'Favourit member').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase() || 'FV';
const formatTime = value => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
function storedLanguage() {
  try { return normalizeLanguageCode(localStorage.getItem('favourit_language') || localStorage.getItem('favourit:language') || navigator.language || 'en'); }
  catch (_) { return 'en'; }
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

export default function DirectMessagingV2({ session, preferredLanguage }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState('people');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [communities, setCommunities] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedType, setSelectedType] = useState('direct');
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [draftAttachments, setDraftAttachments] = useState([]);
  const [draftDeal, setDraftDeal] = useState(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dealPickerOpen, setDealPickerOpen] = useState(false);
  const [starredDeals, setStarredDeals] = useState([]);
  const [dealSearch, setDealSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [otherReadAt, setOtherReadAt] = useState(null);
  const [typingByConversation, setTypingByConversation] = useState({});
  const [menuId, setMenuId] = useState(null);
  const [forwardItem, setForwardItem] = useState(null);
  const [forwardSearch, setForwardSearch] = useState('');
  const [reportItem, setReportItem] = useState(null);
  const [reportCategory, setReportCategory] = useState(REPORT_CATEGORIES[0]);
  const [reportDetails, setReportDetails] = useState('');
  const [translations, setTranslations] = useState({});
  const [translationBusyId, setTranslationBusyId] = useState('');
  const [translationLanguage, setTranslationLanguage] = useState(normalizeLanguageCode(preferredLanguage || storedLanguage()));

  const audioRef = useRef(null);
  const endRef = useRef(null);
  const bodyRef = useRef('');
  const conversationRef = useRef(null);
  const typingChannelsRef = useRef(new Map());
  const typingLastSeenRef = useRef(new Map());
  const touchStartRef = useRef({ id: '', x: 0 });
  const fileInputRef = useRef(null);

  const peopleConversations = useMemo(() => conversations.filter(item => !item.is_message_request), [conversations]);
  const messageRequests = useMemo(() => conversations.filter(item => item.is_message_request), [conversations]);
  const requestUnread = useMemo(() => messageRequests.reduce((sum, item) => sum + Number(item.unread_count || 0), 0), [messageRequests]);

  useEffect(() => { conversationRef.current = conversationId; }, [conversationId]);
  useEffect(() => { bodyRef.current = body; }, [body]);
  useEffect(() => { setTranslationLanguage(normalizeLanguageCode(preferredLanguage || storedLanguage())); }, [preferredLanguage]);
  useEffect(() => {
    const handler = event => setTranslationLanguage(normalizeLanguageCode(event.detail?.language || storedLanguage()));
    window.addEventListener('favourit:language-changed', handler);
    return () => window.removeEventListener('favourit:language-changed', handler);
  }, []);

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
    if (!id || selectedType !== 'direct' || !bodyRef.current.trim()) return;
    ensureTypingChannel(id).then(channel => {
      const entry = typingChannelsRef.current.get(id);
      if (!channel || !entry?.subscribed) return;
      entry.channel.send({ type: 'broadcast', event: 'typing', payload: { conversation_id: id, user_id: session.user.id, typing_at: Date.now() } }).catch(() => {});
    }).catch(() => {});
  };

  const refreshPeople = async () => {
    const safe = await getMyDirectConversations();
    const list = Array.isArray(safe) ? safe : [];
    setConversations(list);
    if (selectedType === 'direct' && conversationRef.current) {
      const current = list.find(item => item.conversation_id === conversationRef.current);
      if (current) setSelected({
        user_id: current.other_user_id,
        username: current.other_username,
        display_name: current.other_display_name,
        avatar_url: current.other_avatar_url,
        is_friend: current.is_friend,
        is_online: current.is_online,
        last_seen_at: current.last_seen_at,
        is_message_request: current.is_message_request,
      });
    }
    return list;
  };

  const refreshCommunities = async () => {
    const data = await listCommunityGroups();
    const joined = (Array.isArray(data) ? data : []).filter(group => group.is_joined);
    setCommunities(joined);
    return joined;
  };

  const refreshInbox = async () => {
    try { await Promise.all([refreshPeople(), refreshCommunities()]); }
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
    if (type === 'direct') {
      const data = await getDirectMessages(id);
      setMessages(Array.isArray(data) ? data : []);
      await markRead(id);
      await refreshReadState(id);
      await ensureTypingChannel(id);
    } else {
      const data = await getCommunityGroupMessages(id);
      setMessages(Array.isArray(data) ? data : []);
    }
  };

  useEffect(() => {
    if (!session?.user?.id) return undefined;
    refreshInbox();
    const timer = window.setInterval(refreshPeople, 7000);
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
  }, [conversations, session?.user?.id]);

  useEffect(() => {
    if (!conversationId || !selected) return undefined;
    let active = true;
    const refresh = async () => {
      try { await loadThread(conversationId, selectedType); }
      catch (e) { if (active) setError(e.message || 'Could not load conversation.'); }
    };
    refresh();
    const timer = window.setInterval(refresh, selectedType === 'direct' ? 1800 : 2200);
    return () => { active = false; window.clearInterval(timer); };
  }, [conversationId, selectedType]);

  useEffect(() => {
    if (!supabase || !session?.user?.id) return undefined;
    const channel = supabase
      .channel(`direct-inbox-v2-${session.user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        if (payload.new.sender_id !== session.user.id) {
          if (payload.new.conversation_id !== conversationRef.current) playPing(audioRef, true);
          refreshPeople().catch(() => {});
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

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, typingByConversation, draftAttachments, draftDeal]);
  useEffect(() => () => {
    typingChannelsRef.current.forEach(({ channel }) => { try { supabase?.removeChannel(channel); } catch (_) {} });
    try { audioRef.current?.close(); } catch (_) {}
  }, []);

  const resetComposer = () => {
    setBody('');
    bodyRef.current = '';
    setReplyTo(null);
    setDraftAttachments([]);
    setDraftDeal(null);
    setAttachMenuOpen(false);
  };

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
        is_message_request: row.is_message_request,
      } : user);
      setSelectedType('direct');
      setConversationId(id);
      conversationRef.current = id;
      setSection(row?.is_message_request ? 'requests' : 'people');
      setQuery('');
      setResults([]);
      resetComposer();
      setOpen(true);
    } catch (e) {
      setError(e.message || 'Could not open conversation.');
    } finally { setBusy(false); }
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
      is_message_request: item.is_message_request,
    });
    setSelectedType('direct');
    setConversationId(item.conversation_id);
    conversationRef.current = item.conversation_id;
    setSection(item.is_message_request ? 'requests' : 'people');
    setMenuId(null);
    resetComposer();
    setOpen(true);
  };

  const openCommunity = group => {
    setSelected(group);
    setSelectedType('community');
    setConversationId(group.id);
    conversationRef.current = group.id;
    setSection('communities');
    setMenuId(null);
    resetComposer();
    setOpen(true);
  };

  useEffect(() => {
    const directHandler = event => { if (event.detail?.username) openDirect({ username: event.detail.username }); };
    const communityHandler = async event => {
      const groupId = event.detail?.groupId;
      if (!groupId) return;
      try {
        const joined = await refreshCommunities();
        const group = joined.find(item => item.id === groupId);
        if (!group) { setOpen(true); setError('Join this community before opening its chat.'); setSection('communities'); return; }
        openCommunity(group);
      } catch (e) { setOpen(true); setError(e.message || 'Could not open community chat.'); }
    };
    window.addEventListener('favourit:open-direct-message', directHandler);
    window.addEventListener('favourit:open-community-chat', communityHandler);
    return () => {
      window.removeEventListener('favourit:open-direct-message', directHandler);
      window.removeEventListener('favourit:open-community-chat', communityHandler);
    };
  }, [busy]);

  const leaveThread = async () => {
    if (conversationId && selectedType === 'direct') await markRead(conversationId);
    setSelected(null);
    setSelectedType('direct');
    setConversationId(null);
    conversationRef.current = null;
    setMessages([]);
    resetComposer();
    setOtherReadAt(null);
    setOpen(true);
    refreshInbox();
  };

  const closeMessenger = async () => {
    if (conversationId && selectedType === 'direct') await markRead(conversationId);
    setOpen(false);
    setSelected(null);
    setConversationId(null);
    conversationRef.current = null;
    setMessages([]);
    resetComposer();
    setOtherReadAt(null);
    setForwardItem(null);
  };

  const send = async event => {
    event.preventDefault();
    const hasContent = Boolean(body.trim() || draftAttachments.length || draftDeal?.id);
    if (!hasContent || !conversationId || busy || uploading) return;
    setBusy(true);
    setError('');
    try {
      const assetIds = draftAttachments.map(item => item.asset_id).filter(Boolean);
      const dealId = draftDeal?.id || null;
      if (selectedType === 'direct') {
        await sendDirectMessage(conversationId, body.trim(), replyTo?.id || null, assetIds, dealId);
        playPing(audioRef, false);
      } else {
        await sendCommunityGroupMessage(conversationId, body.trim(), replyTo?.id || null, assetIds, dealId);
      }
      resetComposer();
      await loadThread(conversationId, selectedType);
      await refreshInbox();
    } catch (e) {
      setError(e.message || 'Could not send message.');
    } finally { setBusy(false); }
  };

  const handleBody = event => {
    const value = event.target.value;
    setBody(value);
    bodyRef.current = value;
    if (selectedType === 'direct' && value.trim()) announceTyping(conversationId);
  };

  const selectMediaFiles = async event => {
    const chosen = Array.from(event.target.files || []);
    event.target.value = '';
    if (!chosen.length) return;
    const remaining = MAX_MESSAGE_MEDIA_FILES - draftAttachments.length;
    if (remaining <= 0) return setError(`You can attach up to ${MAX_MESSAGE_MEDIA_FILES} media items.`);
    const files = chosen.slice(0, remaining);
    setUploading(true);
    setAttachMenuOpen(false);
    setError('');
    const uploaded = [];
    try {
      for (const file of files) uploaded.push(await uploadMessageMedia(file));
      setDraftAttachments(current => [...current, ...uploaded].slice(0, MAX_MESSAGE_MEDIA_FILES));
      if (chosen.length > remaining) setError(`Only the first ${remaining} media item${remaining === 1 ? '' : 's'} were added.`);
    } catch (e) {
      setDraftAttachments(current => [...current, ...uploaded].slice(0, MAX_MESSAGE_MEDIA_FILES));
      setError(e.message || 'Could not upload media.');
    } finally { setUploading(false); }
  };

  const openDealPicker = async () => {
    setAttachMenuOpen(false);
    setDealPickerOpen(true);
    setDealSearch('');
    try { setStarredDeals(await getMyFavoriteDeals()); }
    catch (e) { setError(e.message || 'Could not load starred deals.'); }
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
      if (selectedType === 'direct') await deleteOwnDirectMessage(item.id);
      else await deleteOwnCommunityGroupMessage(item.id);
      await loadThread(conversationId, selectedType);
    } catch (e) { setError(e.message || 'Could not delete message.'); }
    finally { setBusy(false); setMenuId(null); }
  };

  const starMessage = async item => {
    if (busy || item.is_deleted) return;
    setBusy(true);
    setError('');
    try {
      if (selectedType === 'direct') await toggleDirectMessageStar(item.id);
      else await toggleCommunityGroupMessageStar(item.id);
      await loadThread(conversationId, selectedType);
    } catch (e) { setError(e.message || 'Could not update star.'); }
    finally { setBusy(false); setMenuId(null); }
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
    setReportItem(item);
    setReportCategory(REPORT_CATEGORIES[0]);
    setReportDetails('');
    setMenuId(null);
  };

  const submitReport = async () => {
    if (!reportItem || busy) return;
    setBusy(true);
    setError('');
    try {
      if (selectedType === 'direct') await reportDirectMessage(reportItem.id, reportCategory, reportDetails.trim());
      else await reportCommunityGroupMessage(reportItem.id, reportCategory, reportDetails.trim());
      setReportItem(null);
      setReportDetails('');
      setReportCategory(REPORT_CATEGORIES[0]);
    } catch (e) { setError(e.message || 'Could not submit report.'); }
    finally { setBusy(false); }
  };

  const translate = async item => {
    if (!item?.body || item.is_deleted) return;
    setMenuId(null);
    setTranslationBusyId(item.id);
    const result = await translateMessageText(item.body, translationLanguage);
    setTranslations(current => ({ ...current, [item.id]: result }));
    setTranslationBusyId('');
  };

  const prepareForward = target => {
    if (!forwardItem || forwardItem.is_deleted) return;
    if (target.type === 'direct') {
      const item = conversations.find(row => row.conversation_id === target.id);
      if (!item) return;
      setSelected({
        user_id: item.other_user_id,
        username: item.other_username,
        display_name: item.other_display_name,
        avatar_url: item.other_avatar_url,
        is_friend: item.is_friend,
        is_online: item.is_online,
        last_seen_at: item.last_seen_at,
        is_message_request: item.is_message_request,
      });
      setSelectedType('direct');
      setConversationId(item.conversation_id);
      conversationRef.current = item.conversation_id;
      setSection(item.is_message_request ? 'requests' : 'people');
    } else {
      const group = communities.find(item => item.id === target.id);
      if (!group) return;
      setSelected(group);
      setSelectedType('community');
      setConversationId(group.id);
      conversationRef.current = group.id;
      setSection('communities');
    }
    setBody(forwardItem.body || '');
    bodyRef.current = forwardItem.body || '';
    setDraftAttachments(Array.isArray(forwardItem.attachments) ? forwardItem.attachments : []);
    setDraftDeal(forwardItem.deal || null);
    setReplyTo(null);
    setForwardItem(null);
    setForwardSearch('');
    setMenuId(null);
    setOpen(true);
  };

  const openDeal = deal => {
    if (!deal?.id) return;
    setOpen(false);
    window.dispatchEvent(new CustomEvent('favourit:open-deal', { detail: { dealId: deal.id } }));
  };

  const onTouchStart = (item, event) => { touchStartRef.current = { id: item.id, x: event.touches?.[0]?.clientX || 0 }; };
  const onTouchEnd = (item, event) => {
    const start = touchStartRef.current;
    const endX = event.changedTouches?.[0]?.clientX || 0;
    if (start.id === item.id && endX - start.x > 60 && !item.is_deleted) setReplyTo(item);
    touchStartRef.current = { id: '', x: 0 };
  };

  const unread = conversations.reduce((sum, item) => sum + (item.conversation_id === conversationId && open ? 0 : Number(item.unread_count || 0)), 0);
  const currentTyping = Boolean(selectedType === 'direct' && conversationId && typingByConversation[conversationId]);
  const friendOnline = Boolean(selectedType === 'direct' && selected?.is_friend && selected?.is_online);
  const lastMine = [...messages].reverse().find(item => item.sender_id === session.user.id);
  const isRead = Boolean(lastMine?.created_at && otherReadAt && new Date(otherReadAt).getTime() >= new Date(lastMine.created_at).getTime());
  const lastSeen = selectedType === 'direct' && selected?.is_friend && selected?.last_seen_at
    ? `Last seen ${new Date(selected.last_seen_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    : '';
  const conversationMeta = selectedType === 'community'
    ? `${Number(selected?.member_count || 0).toLocaleString()} members`
    : currentTyping ? 'typing…' : friendOnline ? 'Online' : lastSeen || (selected?.is_message_request ? 'Message request' : isRead ? 'Read' : lastMine ? 'Sent' : '');

  const forwardTargets = useMemo(() => {
    const term = forwardSearch.trim().toLowerCase();
    const targets = [
      ...conversations.map(item => ({ type: 'direct', id: item.conversation_id, label: item.other_display_name || `@${item.other_username}`, subtitle: `@${item.other_username}`, avatar_url: item.other_avatar_url })),
      ...communities.map(group => ({ type: 'community', id: group.id, label: group.name, subtitle: 'Community', icon: GROUP_ICONS[group.slug] || '◇' })),
    ];
    if (!term) return targets;
    return targets.filter(target => `${target.label} ${target.subtitle}`.toLowerCase().includes(term));
  }, [conversations, communities, forwardSearch]);

  const filteredDeals = useMemo(() => {
    const term = dealSearch.trim().toLowerCase();
    if (!term) return starredDeals;
    return starredDeals.filter(deal => `${deal.title || ''} ${deal.category || ''} ${deal.seller_name || ''}`.toLowerCase().includes(term));
  }, [starredDeals, dealSearch]);

  const renderConversationRows = rows => rows.length ? rows.map(item => (
    <button className="dm-list-row" key={item.conversation_id} onClick={() => openExisting(item)} type="button">
      <Avatar person={item} />
      <span className="dm-list-copy">
        <strong>{item.other_display_name || item.other_username}{item.is_friend && item.is_online && <i className="online-dot" />}</strong>
        <small>{typingByConversation[item.conversation_id] ? 'typing…' : item.last_message || `@${item.other_username}`}</small>
      </span>
      <span className="dm-list-meta"><time>{formatTime(item.last_message_at)}</time>{Number(item.unread_count || 0) > 0 && <b>{Number(item.unread_count) > 9 ? '9+' : item.unread_count}</b>}</span>
    </button>
  )) : null;

  if (!session) return null;

  return <>
    <button className="dm-fab" onClick={openMessenger} aria-label="Messages">
      <span className="dm-fab-icon">⌁</span><span>Messages</span>
      {unread > 0 && <b className="dm-unread-dot">{unread > 9 ? '9+' : unread}</b>}
    </button>

    <input ref={fileInputRef} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" onChange={selectMediaFiles} />

    {open && <div className="dm-overlay" onMouseDown={event => { if (event.target === event.currentTarget) closeMessenger(); }}>
      <section className={`dm-panel ${selected ? 'is-thread' : 'is-inbox'}`}>
        {!selected ? <>
          <header className="dm-header">
            <div><div className="eyebrow">FAVOURIT</div><h2>Messages</h2><p>People, message requests, group chats and communities.</p></div>
            <button className="dm-close" onClick={closeMessenger} type="button" aria-label="Close">×</button>
          </header>
          <div className="dm-sections dm-sections-v2">
            <button className={section === 'people' ? 'active' : ''} onClick={() => setSection('people')} type="button">People <span>{peopleConversations.length}</span></button>
            <button className={section === 'requests' ? 'active' : ''} onClick={() => setSection('requests')} type="button">Requests {messageRequests.length > 0 && <span className="dm-section-request-count">{messageRequests.length > 99 ? '99+' : messageRequests.length}</span>}</button>
            <button className={section === 'groups' ? 'active' : ''} onClick={() => setSection('groups')} type="button">Groups</button>
            <button className={section === 'communities' ? 'active' : ''} onClick={() => setSection('communities')} type="button">Communities <span>{communities.length}</span></button>
          </div>
          {error && <div className="dm-error">{error}</div>}
          {section === 'people' && <>
            <label className="dm-search"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search @username…" /></label>
            {query.trim() && <div className="dm-search-results">{results.map(person => <button key={person.user_id || person.id || person.username} onClick={() => openDirect(person)} type="button"><Avatar person={person} /><span className="dm-list-copy"><strong>{person.display_name || person.username}</strong><small>@{person.username}</small></span></button>)}</div>}
            {!query.trim() && <div className="dm-list">{peopleConversations.length ? renderConversationRows(peopleConversations) : <div className="dm-empty"><h3>No conversations yet.</h3><p>Search for someone by @username to start a private chat.</p></div>}</div>}
          </>}
          {section === 'requests' && <div className="dm-list dm-request-list"><div className="dm-request-explainer"><strong>Message requests</strong><span>Messages from people who are not your friends appear here.</span>{requestUnread > 0 && <b>{requestUnread} unread</b>}</div>{messageRequests.length ? renderConversationRows(messageRequests) : <div className="dm-empty"><h3>No message requests.</h3><p>New messages from people outside your friends list will appear here.</p></div>}</div>}
          {section === 'groups' && <div className="dm-empty"><h3>No private group chats yet.</h3><p>Private group conversations will live here separately from skill communities.</p></div>}
          {section === 'communities' && <div className="dm-list">{communities.length ? communities.map(group => <button className="dm-list-row" key={group.id} onClick={() => openCommunity(group)} type="button"><span className="dm-community-icon">{GROUP_ICONS[group.slug] || '◇'}</span><span className="dm-list-copy"><strong>{group.name}</strong><small>{Number(group.member_count || 0).toLocaleString()} members · Community</small></span></button>) : <div className="dm-empty"><h3>No joined communities.</h3><p>Join a skill community and its chat will appear here automatically.</p></div>}</div>}
        </> : <>
          <header className="dm-thread-header">
            <button className="dm-back" onClick={leaveThread} type="button" aria-label="Back">←</button>
            {selectedType === 'direct' ? <button className="dm-thread-identity" onClick={() => openProfile(selected)} type="button"><Avatar person={selected} large /><span><strong>{selected.display_name || selected.username}</strong><small>@{selected.username}</small><em>{conversationMeta}{friendOnline && <i className="online-dot" />}</em></span></button> : <div className="dm-thread-identity"><span className="dm-community-icon">{GROUP_ICONS[selected.slug] || '◇'}</span><span><strong>{selected.name}</strong><small>Community chat</small><em>{conversationMeta}</em></span></div>}
            <button className="dm-close" onClick={closeMessenger} type="button" aria-label="Close">×</button>
          </header>
          {selectedType === 'direct' && selected?.is_message_request && <div className="dm-request-banner">This conversation is a message request because @{selected.username} is not in your friends list.</div>}
          {error && <div className="dm-error">{error}</div>}
          <div className="dm-messages">
            {messages.map(item => {
              const mine = item.sender_id === session.user.id;
              const canDelete = mine && !item.is_deleted && Date.now() - new Date(item.created_at).getTime() <= 15 * 60 * 1000;
              const translation = translations[item.id];
              return <div className={`dm-message-row ${mine ? 'mine' : ''} ${item.is_deleted ? 'deleted' : ''}`} key={item.id} onTouchStart={event => onTouchStart(item, event)} onTouchEnd={event => onTouchEnd(item, event)}>
                {!mine && selectedType === 'direct' && <Avatar person={item} />}
                <div className="dm-message-wrap">
                  <div className="dm-message-head">{!mine && selectedType === 'direct' && <button type="button" onClick={() => openProfile(item)}>@{item.username || selected.username}</button>}<time>{formatTime(item.created_at)}</time>{item.is_starred && <span className="star-mark">★</span>}</div>
                  {item.reply_to_message_id && <div className="dm-reply-preview">↩ @{item.reply_to_username || 'member'} · {item.reply_to_body || 'Message'}</div>}
                  <MessageRichContent message={item} onOpenDeal={openDeal} />
                  <div className="dm-message-line">
                    {item.body && <p>{item.body}</p>}
                    <button className="dm-more" type="button" onClick={event => { event.stopPropagation(); setMenuId(value => value === item.id ? null : item.id); }}>•••</button>
                    {menuId === item.id && <div className={`dm-message-menu ${item.is_deleted ? 'deleted-only' : ''}`} onClick={event => event.stopPropagation()}>
                      {item.is_deleted ? <button type="button" onClick={() => openReport(item)}>Report</button> : <>
                        <button type="button" onClick={() => { setReplyTo(item); setMenuId(null); }}>Reply</button>
                        <button type="button" onClick={() => { setForwardItem(item); setForwardSearch(''); setMenuId(null); }}>Forward</button>
                        {item.body && <button type="button" onClick={() => copyMessage(item)}>Copy</button>}
                        <button type="button" onClick={() => starMessage(item)}>{item.is_starred ? 'Unstar' : 'Star'}</button>
                        {mine ? <button type="button" disabled={!canDelete} onClick={() => removeMessage(item)}>{canDelete ? 'Delete' : 'Delete expired'}</button> : <>
                          {item.body && <button type="button" onClick={() => translate(item)} disabled={translationBusyId === item.id}>{translationBusyId === item.id ? 'Translating…' : 'Translate'}</button>}
                          <button type="button" onClick={() => openReport(item)}>Report</button>
                        </>}
                      </>}
                    </div>}
                  </div>
                  {translation && <div className={`dm-inline-translation ${translation.failed ? 'failed' : ''}`}>{translation.failed ? "Couldn't translate" : translation.text}</div>}
                </div>
              </div>;
            })}
            {currentTyping && <div className="dm-typing"><span /><span /><span /></div>}
            <div ref={endRef} />
          </div>
          {replyTo && <div className="dm-reply-bar"><div><span>Replying to @{replyTo.username || selected.username || 'member'}</span><small>{replyTo.body || (replyTo.deal ? 'Deal' : replyTo.attachments?.length ? 'Media' : 'Message')}</small></div><button onClick={() => setReplyTo(null)} type="button">×</button></div>}
          <div className="dm-composer-shell">
            <DraftRichContent attachments={draftAttachments} deal={draftDeal} onRemoveAttachment={index => setDraftAttachments(current => current.filter((_, i) => i !== index))} onRemoveDeal={() => setDraftDeal(null)} />
            {uploading && <div className="dm-uploading">Uploading media securely…</div>}
            <form className="dm-composer" onSubmit={send}>
              <div className="dm-plus-wrap">
                <button className="dm-plus" type="button" onClick={() => setAttachMenuOpen(value => !value)} aria-label="Add media or deal">+</button>
                {attachMenuOpen && <div className="dm-attach-menu" onClick={event => event.stopPropagation()}>
                  <button type="button" onClick={() => fileInputRef.current?.click()}>▣ Photos & videos</button>
                  <button type="button" onClick={openDealPicker}>★ Starred deals</button>
                </div>}
              </div>
              <input value={body} maxLength={selectedType === 'community' ? 2000 : 5000} onChange={handleBody} placeholder={selectedType === 'community' ? `Message ${selected.name}…` : `Message @${selected.username}…`} />
              <button className="primary" disabled={(!body.trim() && !draftAttachments.length && !draftDeal) || busy || uploading} type="submit">Send</button>
            </form>
          </div>
        </>}

        {forwardItem && <div className="dm-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setForwardItem(null); }}><div className="dm-modal"><header><div><div className="eyebrow">FORWARD</div><h3>Choose a chat</h3></div><button onClick={() => setForwardItem(null)} type="button">×</button></header><div className="dm-forward-source">{forwardItem.body && <p>{forwardItem.body}</p>}<MessageRichContent message={forwardItem} /></div><p className="dm-forward-target-note">The message will be placed in that chat as a draft with its media/deal. Nothing is sent until you press Send.</p><input className="dm-modal-search" value={forwardSearch} onChange={event => setForwardSearch(event.target.value)} placeholder="Search chats…"/><div className="dm-forward-list">{forwardTargets.map(target => <button key={`${target.type}-${target.id}`} onClick={() => prepareForward(target)} type="button">{target.avatar_url ? <Avatar person={{ avatar_url: target.avatar_url, display_name: target.label }} /> : target.icon ? <span className="dm-community-icon">{target.icon}</span> : <Avatar person={{ display_name: target.label }} />}<span><strong>{target.label}</strong><small>{target.subtitle}</small></span></button>)}</div></div></div>}

        {dealPickerOpen && <div className="dm-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDealPickerOpen(false); }}><div className="dm-modal"><header><div><div className="eyebrow">STARRED DEALS</div><h3>Add a deal</h3></div><button onClick={() => setDealPickerOpen(false)} type="button">×</button></header><input className="dm-modal-search" value={dealSearch} onChange={event => setDealSearch(event.target.value)} placeholder="Search starred deals…"/><div className="dm-rich-modal-list">{filteredDeals.length ? filteredDeals.map(deal => <button className="dm-deal-picker-row" key={deal.id} type="button" onClick={() => { setDraftDeal(deal); setDealPickerOpen(false); }}><DealMessageCard deal={deal} compact /></button>) : <div className="dm-empty"><h3>No starred deals.</h3><p>Star a published deal in Explore first, then share it here.</p></div>}</div></div></div>}

        {reportItem && <div className="dm-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setReportItem(null); }}><div className="dm-modal"><header><div><div className="eyebrow">REPORT</div><h3>Report message</h3></div><button onClick={() => setReportItem(null)} type="button">×</button></header><select value={reportCategory} onChange={event => setReportCategory(event.target.value)}>{REPORT_CATEGORIES.map(category => <option key={category}>{category}</option>)}</select><textarea value={reportDetails} maxLength={2000} onChange={event => setReportDetails(event.target.value)} placeholder="Tell us what happened…" /><div className="dm-modal-actions"><button className="secondary" type="button" onClick={() => setReportItem(null)}>Cancel</button><button className="primary" type="button" onClick={submitReport} disabled={busy}>Submit</button></div></div></div>}
      </section>
    </div>}
  </>;
}
