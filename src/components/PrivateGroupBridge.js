import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { getMySocialGraph } from '../lib/social';
import { getDirectMessages, deleteOwnDirectMessage, toggleDirectMessageStar, reportDirectMessage } from '../lib/directMessaging';
import { createPrivateGroup, getMyPrivateGroups, leavePrivateGroup, sendPrivateGroupMessage } from '../lib/privateGroups';
import { translateMessageText } from '../lib/translation';
import { normalizeLanguageCode } from '../data/languages';
import './PrivateGroupBridge.css';

const MUTE_KEY = 'favourit:muted-conversations';
const REPORT_REASON = 'Private group message';

function initials(value = 'Favourit member') {
  return String(value).split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'FV';
}
function time(value) {
  if (!value) return '';
  try { return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; }
}
function storedLanguage() {
  try { return normalizeLanguageCode(localStorage.getItem('favourit_language') || localStorage.getItem('favourit:language') || navigator.language || 'en'); }
  catch (_) { return 'en'; }
}
function readMutes() {
  try { return JSON.parse(localStorage.getItem(MUTE_KEY) || '{}') || {}; } catch (_) { return {}; }
}
function muted(id) {
  const until = Number(readMutes()[id] || 0);
  return until === -1 || until > Date.now();
}
function toggleMute(id) {
  const next = readMutes();
  if (muted(id)) delete next[id];
  else next[id] = -1;
  try { localStorage.setItem(MUTE_KEY, JSON.stringify(next)); } catch (_) {}
  window.dispatchEvent(new CustomEvent('favourit:mute-state-changed', { detail: next }));
}
function avatar(person) {
  if (person?.avatar_url) return <img className="private-group-avatar" src={person.avatar_url} alt="" />;
  return <span className="private-group-avatar">{initials(person?.display_name || person?.username)}</span>;
}

export default function PrivateGroupBridge({ session }) {
  const [host, setHost] = useState(null);
  const [panel, setPanel] = useState(null);
  const [groups, setGroups] = useState([]);
  const [friends, setFriends] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [selectedFriends, setSelectedFriends] = useState([]);
  const [friendSearch, setFriendSearch] = useState('');
  const [chat, setChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [search, setSearch] = useState('');
  const [translations, setTranslations] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [muteVersion, setMuteVersion] = useState(0);

  const refreshGroups = async () => {
    const rows = await getMyPrivateGroups();
    setGroups(Array.isArray(rows) ? rows : []);
    return Array.isArray(rows) ? rows : [];
  };

  useEffect(() => {
    if (!session?.user?.id) return undefined;
    const sync = () => {
      const root = document.querySelector('.dm-panel.is-inbox');
      const groupsButton = [...document.querySelectorAll('.dm-sections-v2 button')].find(button => String(button.textContent || '').trim().startsWith('Groups'));
      const active = Boolean(root && groupsButton?.classList.contains('active'));
      if (!active) {
        if (host) host.classList.remove('private-groups-host');
        setHost(null);
        setPanel(root || null);
        return;
      }
      const empty = [...root.querySelectorAll('.dm-empty')].find(node => String(node.textContent || '').includes('private group')) || root.querySelector('.dm-empty');
      if (empty) empty.classList.add('private-groups-host');
      setHost(empty || null);
      setPanel(root);
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    sync();
    return () => {
      observer.disconnect();
      document.querySelectorAll('.private-groups-host').forEach(node => node.classList.remove('private-groups-host'));
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) return undefined;
    refreshGroups().catch(() => {});
    const timer = window.setInterval(() => refreshGroups().catch(() => {}), 7000);
    return () => window.clearInterval(timer);
  }, [session?.user?.id]);

  useEffect(() => {
    if (!chat?.conversation_id) return undefined;
    let active = true;
    const load = async () => {
      try {
        const rows = await getDirectMessages(chat.conversation_id);
        if (!active) return;
        setMessages(Array.isArray(rows) ? rows : []);
        try { await supabase?.rpc('mark_conversation_read', { p_conversation_id: chat.conversation_id }); } catch (_) {}
        refreshGroups().catch(() => {});
      } catch (e) {
        if (active) setError(e.message || 'Could not load this group chat.');
      }
    };
    load();
    const timer = window.setInterval(load, 1800);
    return () => { active = false; window.clearInterval(timer); };
  }, [chat?.conversation_id]);

  useEffect(() => {
    const handler = () => setMuteVersion(value => value + 1);
    window.addEventListener('favourit:mute-state-changed', handler);
    return () => window.removeEventListener('favourit:mute-state-changed', handler);
  }, []);

  const filteredFriends = useMemo(() => {
    const term = friendSearch.trim().toLowerCase();
    return friends.filter(person => !term || `${person.display_name || ''} ${person.username || ''}`.toLowerCase().includes(term));
  }, [friends, friendSearch]);

  const visibleMessages = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return messages;
    return messages.filter(message => `${message.body || ''} ${message.username || ''} ${message.display_name || ''}`.toLowerCase().includes(term));
  }, [messages, search]);

  const openCreate = async () => {
    setError('');
    setName('');
    setSelectedFriends([]);
    setFriendSearch('');
    try {
      const graph = await getMySocialGraph();
      setFriends(Array.isArray(graph?.friends) ? graph.friends : []);
      setCreateOpen(true);
    } catch (e) { setError(e.message || 'Could not load your friends.'); }
  };

  const createGroup = async event => {
    event.preventDefault();
    if (busy || name.trim().length < 2 || !selectedFriends.length) return;
    setBusy(true);
    setError('');
    try {
      const groupId = await createPrivateGroup(name.trim(), selectedFriends);
      const fresh = await refreshGroups();
      const group = fresh.find(item => item.group_id === groupId);
      setCreateOpen(false);
      if (group) setChat(group);
    } catch (e) { setError(e.message || 'Could not create the group.'); }
    finally { setBusy(false); }
  };

  const send = async event => {
    event.preventDefault();
    if (!chat?.group_id || !body.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await sendPrivateGroupMessage(chat.group_id, body.trim(), replyTo?.id || null);
      setBody('');
      setReplyTo(null);
      setMessages(await getDirectMessages(chat.conversation_id));
      await refreshGroups();
    } catch (e) { setError(e.message || 'Could not send this message.'); }
    finally { setBusy(false); }
  };

  const star = async message => {
    if (busy || message.is_deleted) return;
    setBusy(true);
    try { await toggleDirectMessageStar(message.id); setMessages(await getDirectMessages(chat.conversation_id)); }
    catch (e) { setError(e.message || 'Could not update the star.'); }
    finally { setBusy(false); }
  };

  const remove = async message => {
    if (busy || message.is_deleted) return;
    setBusy(true);
    try { await deleteOwnDirectMessage(message.id); setMessages(await getDirectMessages(chat.conversation_id)); }
    catch (e) { setError(e.message || 'Could not delete this message.'); }
    finally { setBusy(false); }
  };

  const report = async message => {
    const details = window.prompt('Optional details for this report:') || '';
    setBusy(true);
    try { await reportDirectMessage(message.id, REPORT_REASON, details.trim()); }
    catch (e) { setError(e.message || 'Could not submit the report.'); }
    finally { setBusy(false); }
  };

  const translate = async message => {
    if (!message?.body || message.is_deleted) return;
    const result = await translateMessageText(message.body, storedLanguage());
    setTranslations(current => ({ ...current, [message.id]: result }));
  };

  const leave = async () => {
    if (!chat?.group_id || !window.confirm(`Leave ${chat.name}?`)) return;
    setBusy(true);
    try {
      await leavePrivateGroup(chat.group_id);
      setChat(null);
      setMessages([]);
      await refreshGroups();
    } catch (e) { setError(e.message || 'Could not leave this group.'); }
    finally { setBusy(false); }
  };

  const groupsPortal = host ? createPortal(<div className="private-groups-list">
    <div className="private-groups-toolbar">
      <div><strong>Private groups</strong><small>Group chats with friends, separate from public Communities.</small></div>
      <button className="primary small" type="button" onClick={openCreate}>+ New group</button>
    </div>
    {groups.length ? groups.map(group => <button className="private-group-row" type="button" key={group.group_id} onClick={() => { setError(''); setSearch(''); setChat(group); }}>
      <span className="private-group-icon">{initials(group.name)}</span>
      <span className="dm-list-copy"><strong>{group.name}{muted(group.conversation_id) && <i className="private-group-muted">🔕</i>}</strong><small>{group.last_message || `${Number(group.member_count || 0)} members`}</small></span>
      <span className="dm-list-meta"><time>{time(group.last_message_at)}</time>{Number(group.unread_count || 0) > 0 && <b>{Number(group.unread_count) > 9 ? '9+' : group.unread_count}</b>}</span>
    </button>) : <div className="private-groups-zero"><strong>No private groups yet.</strong><span>Create one with your friends when you need a focused conversation.</span></div>}
  </div>, host) : null;

  const overlayPortal = panel ? createPortal(<>
    {chat && <section className="private-group-thread" aria-label={`${chat.name} private group chat`}>
      <header className="private-group-thread-header">
        <button type="button" className="dm-back" onClick={() => { setChat(null); setMessages([]); setReplyTo(null); }}>←</button>
        <div className="private-group-thread-title"><span className="private-group-icon">{initials(chat.name)}</span><span><strong>{chat.name}</strong><small>Private group · {Number(chat.member_count || 0)} members</small></span></div>
        <button type="button" className="private-group-header-action" onClick={() => { toggleMute(chat.conversation_id); setMuteVersion(value => value + 1); }}>{muted(chat.conversation_id) ? '🔕 Muted' : '🔔'}</button>
        <button type="button" className="private-group-header-action danger" onClick={leave} disabled={busy}>Leave</button>
      </header>
      <label className="private-group-search"><span>⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search this group…" /></label>
      {error && <div className="dm-error">{error}</div>}
      <div className="private-group-messages">
        {visibleMessages.map(message => {
          const mine = message.sender_id === session.user.id;
          const canDelete = mine && !message.is_deleted && Date.now() - new Date(message.created_at).getTime() <= 15 * 60 * 1000;
          const translation = translations[message.id];
          return <div className={`private-group-message ${mine ? 'mine' : ''} ${message.is_deleted ? 'deleted' : ''}`} key={message.id}>
            {!mine && avatar(message)}
            <div className="private-group-bubble">
              <div className="private-group-message-head"><strong>{mine ? 'You' : `@${message.username || 'member'}`}</strong><time>{time(message.created_at)}</time>{message.is_starred && <span>★</span>}</div>
              {message.reply_to_message_id && <small className="private-group-reply">↩ @{message.reply_to_username || 'member'} · {message.reply_to_body || 'Message'}</small>}
              <p>{message.body || (message.is_deleted ? 'Message deleted.' : '')}</p>
              {translation && <div className={`private-group-translation ${translation.failed ? 'failed' : ''}`}>{translation.failed ? "Couldn't translate" : translation.text}</div>}
              {!message.is_deleted && <div className="private-group-actions">
                <button type="button" onClick={() => setReplyTo(message)}>Reply</button>
                {message.body && <button type="button" onClick={() => navigator.clipboard?.writeText(message.body).catch(() => {})}>Copy</button>}
                <button type="button" onClick={() => star(message)}>{message.is_starred ? 'Unstar' : 'Star'}</button>
                {!mine && message.body && <button type="button" onClick={() => translate(message)}>Translate</button>}
                {!mine && <button type="button" onClick={() => report(message)}>Report</button>}
                {mine && <button type="button" disabled={!canDelete} onClick={() => remove(message)}>{canDelete ? 'Delete' : 'Delete expired'}</button>}
              </div>}
            </div>
          </div>;
        })}
        {!visibleMessages.length && <div className="private-groups-zero"><strong>{search ? 'No matching messages.' : 'Start the group conversation.'}</strong><span>{search ? 'Try another search.' : 'Only group members can see messages here.'}</span></div>}
      </div>
      {replyTo && <div className="private-group-reply-bar"><span>Replying to @{replyTo.username || 'member'} · {replyTo.body || 'Message'}</span><button type="button" onClick={() => setReplyTo(null)}>×</button></div>}
      <form className="private-group-composer" onSubmit={send}>
        <input value={body} maxLength={5000} onChange={event => setBody(event.target.value)} placeholder={`Message ${chat.name}…`} />
        <button className="primary" type="submit" disabled={!body.trim() || busy}>Send</button>
      </form>
    </section>}

    {createOpen && <div className="private-group-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCreateOpen(false); }}>
      <form className="private-group-modal" onSubmit={createGroup}>
        <header><div><div className="eyebrow">PRIVATE GROUP</div><h3>New group chat</h3><p>Choose friends to start a private conversation. Up to 20 people including you.</p></div><button type="button" onClick={() => setCreateOpen(false)}>×</button></header>
        <label>Group name<input value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="Project team" autoFocus /></label>
        <input className="private-group-friend-search" value={friendSearch} onChange={event => setFriendSearch(event.target.value)} placeholder="Search your friends…" />
        <div className="private-group-friends">
          {filteredFriends.length ? filteredFriends.map(person => {
            const id = person.user_id || person.id;
            const checked = selectedFriends.includes(id);
            return <button type="button" className={checked ? 'selected' : ''} key={id} onClick={() => setSelectedFriends(current => checked ? current.filter(value => value !== id) : current.length < 19 ? [...current, id] : current)}>
              {avatar(person)}<span><strong>{person.display_name || person.username}</strong><small>@{person.username || 'member'}</small></span><b>{checked ? '✓' : '+'}</b>
            </button>;
          }) : <div className="private-groups-zero"><strong>No friends found.</strong><span>Add friends in Community before creating a private group.</span></div>}
        </div>
        {error && <div className="dm-error">{error}</div>}
        <footer><span>{selectedFriends.length} selected</span><button className="primary" type="submit" disabled={busy || name.trim().length < 2 || !selectedFriends.length}>{busy ? 'Creating…' : 'Create group'}</button></footer>
      </form>
    </div>}
  </>, panel) : null;

  return <>{groupsPortal}{overlayPortal}</>;
}
