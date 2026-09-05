import { useEffect, useMemo, useState } from 'react';
import { getMySocialGraph, searchCommunityPeople, sendFriendRequest, respondFriendRequest, cancelFriendRequest, removeFriend, listCommunityGroups, joinCommunityGroup, leaveCommunityGroup, getCommunityGroupMessages, sendCommunityGroupMessage, deleteOwnCommunityGroupMessage, toggleCommunityGroupMessageStar, getCommunityGroupMembers, reportCommunityGroupMessage, moderateCommunityGroupMessage, moderateCommunityGroupMember } from '../lib/social';
import { getMyDirectConversations, getOrCreateDirectConversation, sendDirectMessage } from '../lib/directMessaging';
import { supabase } from '../lib/supabase';
import './Community.css';
import './CommunityMessageActions.css';

const GROUP_ICONS = { designers: '✦', developers: '⌘', 'video-editors': '▣', musicians: '♫', marketers: '↗', photographers: '◉', writers: '✎', entrepreneurs: '◇' };
const REPORT_CATEGORIES = ['Harassment or bullying', 'Spam or scam', 'Hate or discrimination', 'Sexual content', 'Violence or threats', 'Impersonation', 'Illegal activity', 'Other'];

function initials(name = 'Favourit member') {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || 'FV';
}

function Avatar({ person, large = false, onClick }) {
  const content = person?.avatar_url ? <img className={`community-avatar ${large ? 'large' : ''}`} src={person.avatar_url} alt="" /> : <div className={`community-avatar ${large ? 'large' : ''}`}>{initials(person?.display_name || person?.username)}</div>;
  if (!onClick) return content;
  return <button className="community-avatar-button" onClick={onClick} aria-label={`Open @${person?.username || 'member'} profile`} type="button">{content}</button>;
}

const openProfile = (person) => {
  const id = person?.id || person?.user_id;
  if (id) window.dispatchEvent(new CustomEvent('favourit:open-profile', { detail: { userId: id } }));
};

const openMessage = (person) => {
  if (person?.username) window.dispatchEvent(new CustomEvent('favourit:open-direct-message', { detail: { username: person.username } }));
};

function PersonCard({ person, status, onConnect, onCancel, onRemove }) {
  return <article className="community-person-card">
    <Avatar person={person} large onClick={() => openProfile(person)} />
    <div className="community-person-copy">
      <button className="community-person-name" onClick={() => openProfile(person)} type="button">{person.display_name || person.username || 'Favourit member'}</button>
      <button className="community-person-handle" onClick={() => openProfile(person)} type="button">@{person.username || 'member'}</button>
      <p>{person.bio || 'Favourit member · Open to new collaborations.'}</p>
    </div>
    <div className="community-person-actions">
      {status === 'friends' && <><span className="community-status success">Friends ✓</span><button className="secondary small" onClick={() => openMessage(person)} type="button">Message</button>{onRemove && <button className="text-button small" onClick={onRemove} type="button">Remove friend</button>}</>}
      {status === 'incoming' && <><button className="primary small" onClick={() => onConnect('accept')} type="button">Accept</button><button className="secondary small" onClick={() => onConnect('reject')} type="button">Decline</button></>}
      {status === 'outgoing' && <button className="secondary small" onClick={onCancel} type="button">Pending</button>}
      {!status && <><button className="primary small" onClick={() => onConnect()} type="button">Connect</button><button className="secondary small" onClick={() => openMessage(person)} type="button">Message</button></>}
    </div>
  </article>;
}

function GroupCard({ group, onOpen, onToggle }) {
  return <article className="community-group-card">
    <div className="group-icon">{GROUP_ICONS[group.slug] || '◇'}</div>
    <div className="group-card-main"><div className="group-card-title"><h3>{group.name}</h3><span>Public</span></div><p>{group.description}</p><small>{Number(group.member_count || 0).toLocaleString()} members</small></div>
    <div className="group-card-actions"><button className={group.is_joined ? 'secondary small' : 'primary small'} onClick={() => onToggle(group)} type="button">{group.is_joined ? 'Joined ✓' : 'Join'}</button><button className="text-button" onClick={() => onOpen(group)} type="button">Chat →</button></div>
  </article>;
}

function getPreferredLanguage() {
  try {
    return localStorage.getItem('favourit_language') || localStorage.getItem('favourit:language') || navigator.language || 'en';
  } catch (_) { return 'en'; }
}

async function translateText(text, targetLanguage) {
  const target = String(targetLanguage || 'en').split('-')[0].toLowerCase();
  if (!text || !target || target === 'en' && /^[\x00-\x7F]*$/.test(text)) return text;
  const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${encodeURIComponent(target)}`);
  if (!response.ok) throw new Error('Translation service is unavailable.');
  const data = await response.json();
  const translated = data?.responseData?.translatedText;
  if (!translated) throw new Error('Could not translate this message.');
  return translated;
}

export default function Community() {
  const [tab, setTab] = useState('discover');
  const [people, setPeople] = useState([]);
  const [graph, setGraph] = useState({ friends: [], incoming: [], outgoing: [], blocked: [] });
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupMessages, setGroupMessages] = useState([]);
  const [groupMembers, setGroupMembers] = useState([]);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [menuMessageId, setMenuMessageId] = useState(null);
  const [forwardMessage, setForwardMessage] = useState(null);
  const [directConversations, setDirectConversations] = useState([]);
  const [forwardSearch, setForwardSearch] = useState('');
  const [reportMessage, setReportMessage] = useState(null);
  const [reportCategory, setReportCategory] = useState(REPORT_CATEGORIES[0]);
  const [reportDetails, setReportDetails] = useState('');
  const [translation, setTranslation] = useState(null);
  const [translationBusy, setTranslationBusy] = useState(false);

  const refreshSocial = async () => {
    const data = await getMySocialGraph();
    setGraph({ friends: data?.friends || [], incoming: data?.incoming || [], outgoing: data?.outgoing || [], blocked: data?.blocked || [] });
  };

  const refreshGroups = async () => {
    const data = await listCommunityGroups();
    setGroups(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    Promise.all([
      refreshSocial(),
      refreshGroups(),
      supabase?.auth?.getUser().then(({ data }) => setCurrentUserId(data?.user?.id || '')).catch(() => {}),
    ]).catch((e) => setError(e.message || 'Could not load Community.'));
  }, []);

  useEffect(() => {
    const timer = setTimeout(async () => {
      try { setPeople(await searchCommunityPeople(search.trim())); }
      catch (e) { setError(e.message || 'Could not search people.'); }
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!selectedGroup) return undefined;
    const joined = groups.find((g) => g.id === selectedGroup.id)?.is_joined;
    if (!joined) return undefined;
    const refresh = async () => {
      try { setGroupMessages(await getCommunityGroupMessages(selectedGroup.id)); }
      catch (e) { setError(e.message || 'Could not refresh group chat.'); }
    };
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [selectedGroup, groups]);

  useEffect(() => {
    const closeMenu = () => setMenuMessageId(null);
    if (!menuMessageId) return undefined;
    document.addEventListener('click', closeMenu);
    return () => document.removeEventListener('click', closeMenu);
  }, [menuMessageId]);

  const statusFor = (id) => {
    if (graph.friends.some((p) => p.id === id || p.user_id === id)) return 'friends';
    if (graph.incoming.some((p) => p.user_id === id)) return 'incoming';
    if (graph.outgoing.some((p) => p.user_id === id)) return 'outgoing';
    return '';
  };

  const discoverPeople = useMemo(() => people.slice(0, 6), [people]);
  const recommendedPeople = useMemo(() => graph.friends.slice(0, 8), [graph.friends]);
  const filteredForwardConversations = useMemo(() => {
    const term = forwardSearch.trim().toLowerCase();
    if (!term) return directConversations;
    return directConversations.filter((c) => `${c.other_username || ''} ${c.other_display_name || ''}`.toLowerCase().includes(term));
  }, [directConversations, forwardSearch]);

  const action = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); await refreshSocial(); }
    catch (e) { setError(e.message || 'Something went wrong.'); }
    finally { setBusy(false); }
  };

  const openGroup = async (group) => {
    setSelectedGroup(group); setError(''); setBusy(true); setMenuMessageId(null);
    try {
      const [messages, members] = group.is_joined ? await Promise.all([getCommunityGroupMessages(group.id), getCommunityGroupMembers(group.id)]) : [[], []];
      setGroupMessages(messages || []); setGroupMembers(members || []);
    } catch (e) { setError(e.message || 'Could not open group.'); }
    finally { setBusy(false); }
  };

  const toggleGroup = async (group) => {
    setBusy(true); setError('');
    try {
      if (group.is_joined) await leaveCommunityGroup(group.id); else await joinCommunityGroup(group.id);
      await refreshGroups();
      if (!group.is_joined) {
        const [members, messages] = await Promise.all([getCommunityGroupMembers(group.id), getCommunityGroupMessages(group.id)]);
        setGroupMembers(members || []); setGroupMessages(messages || []);
      } else { setGroupMessages([]); setGroupMembers([]); }
    } catch (e) { setError(e.message || 'Could not update group membership.'); }
    finally { setBusy(false); }
  };

  const postToGroup = async (e) => {
    e.preventDefault();
    if (!selectedGroup || !message.trim() || busy) return;
    setBusy(true); setError('');
    try {
      await sendCommunityGroupMessage(selectedGroup.id, message.trim(), replyTo?.id || null);
      setMessage(''); setReplyTo(null); setGroupMessages(await getCommunityGroupMessages(selectedGroup.id));
    } catch (e) { setError(e.message || 'Could not send message.'); }
    finally { setBusy(false); }
  };

  const startReply = (item) => {
    if (item.is_deleted) return;
    setReplyTo(item); setMenuMessageId(null);
    window.setTimeout(() => document.querySelector('.group-chat-composer input')?.focus(), 0);
  };

  const copyMessage = async (item) => {
    if (!item?.body || item.is_deleted) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(item.body);
      else { const area = document.createElement('textarea'); area.value = item.body; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove(); }
    } catch (_) { setError('Could not copy the message.'); }
    setMenuMessageId(null);
  };

  const toggleStar = async (item) => {
    if (!item?.id) return;
    setBusy(true); setError('');
    try {
      await toggleCommunityGroupMessageStar(item.id);
      setGroupMessages(await getCommunityGroupMessages(selectedGroup.id));
    } catch (e) { setError(e.message || 'Could not update star.'); }
    finally { setBusy(false); setMenuMessageId(null); }
  };

  const deleteOwnMessage = async (item) => {
    if (item.sender_id !== currentUserId || item.is_deleted) return;
    const age = Date.now() - new Date(item.created_at).getTime();
    if (age > 15 * 60 * 1000) { setError('Messages can only be deleted within 15 minutes.'); setMenuMessageId(null); return; }
    setBusy(true); setError('');
    try { await deleteOwnCommunityGroupMessage(item.id); setGroupMessages(await getCommunityGroupMessages(selectedGroup.id)); }
    catch (e) { setError(e.message || 'Could not delete the message.'); }
    finally { setBusy(false); setMenuMessageId(null); }
  };

  const openForward = async (item) => {
    setMenuMessageId(null); setForwardSearch(''); setForwardMessage(item);
    try { setDirectConversations(await getMyDirectConversations()); } catch (e) { setError(e.message || 'Could not load your chats.'); }
  };

  const forwardTo = async (person) => {
    if (!forwardMessage?.body || !person?.other_username && !person?.username) return;
    setBusy(true); setError('');
    try {
      const username = person.other_username || person.username;
      const conversationId = person.conversation_id || await getOrCreateDirectConversation(username);
      await sendDirectMessage(conversationId, forwardMessage.body);
      setForwardMessage(null);
    } catch (e) { setError(e.message || 'Could not send the message.'); }
    finally { setBusy(false); }
  };

  const reportMessageOpen = (item) => {
    setReportMessage(item); setReportCategory(REPORT_CATEGORIES[0]); setReportDetails(''); setMenuMessageId(null);
  };

  const submitReport = async () => {
    if (!reportMessage) return;
    setBusy(true); setError('');
    try {
      await reportCommunityGroupMessage(reportMessage.id, reportCategory, reportDetails.trim());
      setReportMessage(null); setReportDetails('');
    } catch (e) { setError(e.message || 'Could not submit the report.'); }
    finally { setBusy(false); }
  };

  const translateMessage = async (item) => {
    if (!item?.body || item.is_deleted) return;
    setMenuMessageId(null); setTranslation({ item, text: '' }); setTranslationBusy(true);
    try {
      const text = await translateText(item.body, getPreferredLanguage());
      setTranslation({ item, text });
    } catch (e) { setTranslation({ item, text: e.message || 'Could not translate this message.' }); }
    finally { setTranslationBusy(false); }
  };

  const removeMember = async (member) => {
    if (!window.confirm(`Remove @${member.username || 'this member'} from the group?`)) return;
    setBusy(true); setError('');
    try {
      await moderateCommunityGroupMember(selectedGroup.id, member.user_id, 'remove');
      const [members, messages] = await Promise.all([getCommunityGroupMembers(selectedGroup.id), getCommunityGroupMessages(selectedGroup.id)]);
      setGroupMembers(members || []); setGroupMessages(messages || []); await refreshGroups();
    } catch (e) { setError(e.message || 'Could not remove member.'); }
    finally { setBusy(false); }
  };

  const renderMessageMenu = (item) => {
    if (item.is_deleted) return null;
    const mine = item.sender_id === currentUserId;
    const canDelete = mine && Date.now() - new Date(item.created_at).getTime() <= 15 * 60 * 1000;
    return <div className="community-message-menu-wrap" onClick={(e) => e.stopPropagation()}>
      <button className="community-message-more" type="button" aria-label="Message options" onClick={() => setMenuMessageId(menuMessageId === item.id ? null : item.id)}>•••</button>
      {menuMessageId === item.id && <div className="community-message-menu">
        <button type="button" onClick={() => startReply(item)}>↩ <span>Reply</span></button>
        <button type="button" onClick={() => openForward(item)}>↗ <span>Forward</span></button>
        <button type="button" onClick={() => copyMessage(item)}>⧉ <span>Copy</span></button>
        <button type="button" onClick={() => toggleStar(item)}>★ <span>{item.is_starred ? 'Unstar' : 'Star'}</span></button>
        {mine ? <button type="button" disabled={!canDelete} className={!canDelete ? 'disabled' : 'danger'} onClick={() => deleteOwnMessage(item)}>⌫ <span>{canDelete ? 'Delete' : 'Delete · 15 min passed'}</span></button> : <button type="button" onClick={() => translateMessage(item)}>文 <span>Translate</span></button>}
        {!mine && <button type="button" className="danger" onClick={() => reportMessageOpen(item)}>⚑ <span>Report</span></button>}
      </div>}
    </div>;
  };

  if (selectedGroup) {
    const joined = groups.find((g) => g.id === selectedGroup.id)?.is_joined;
    const me = groupMembers.find((member) => member.user_id === currentUserId);
    const isModerator = Boolean(me?.is_moderator);

    return <section className="page-section community-page">
      <button className="back-button" onClick={() => { setSelectedGroup(null); setGroupMessages([]); setGroupMembers([]); setReplyTo(null); setMenuMessageId(null); }} type="button">← Back to Community</button>
      <div className="community-group-hero"><div className="group-icon hero">{GROUP_ICONS[selectedGroup.slug] || '◇'}</div><div><div className="eyebrow">PUBLIC COMMUNITY</div><h1>{selectedGroup.name}</h1><p>{selectedGroup.description}</p><span className="group-meta">{Number(selectedGroup.member_count || 0).toLocaleString()} members · Public</span></div><button className={joined ? 'secondary' : 'primary'} onClick={() => toggleGroup(selectedGroup)} type="button">{joined ? 'Leave group' : 'Join group'}</button></div>
      {error && <div className="community-error">{error}</div>}
      <div className="community-chat-layout">
        <div className="community-group-chat">
          <div className="group-chat-header"><div><strong>Community chat</strong><span>Member-only group conversation · moderated.</span></div><span className="moderated-pill">Moderated</span></div>
          <div className="group-chat-messages">
            {joined ? (groupMessages.length ? groupMessages.map((item) => <div className={`group-message ${item.is_deleted ? 'deleted' : ''}`} key={item.id}>
              <Avatar person={item} onClick={() => openProfile(item)} />
              <div className="group-message-body">
                <div className="group-message-head"><button className="group-message-user" onClick={() => openProfile(item)} type="button">{item.display_name || item.username || 'Member'}</button><button className="group-message-handle" onClick={() => openProfile(item)} type="button">@{item.username || 'member'}</button>{item.is_moderator && <span className="moderator-badge">Moderator</span>}<time>{new Date(item.created_at).toLocaleString([], { hour: '2-digit', minute: '2-digit' })}</time>{renderMessageMenu(item)}</div>
                {item.reply_to_message_id && <button className="community-reply-preview" type="button" onClick={() => document.getElementById(`group-message-${item.reply_to_message_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><strong>@{item.reply_to_username || 'member'}</strong><span>{item.reply_to_body || 'Message deleted.'}</span></button>}
                <p id={`group-message-${item.id}`}>{item.body}</p>
                {item.is_starred && <span className="community-starred">★ Starred</span>}
                {item.is_deleted && item.sender_id !== currentUserId && isModerator && <button className="group-message-action" onClick={() => reportMessageOpen(item)} type="button">Report</button>}
                {!item.is_deleted && isModerator && item.sender_id !== currentUserId && <button className="group-message-action danger" onClick={() => moderateCommunityGroupMessage(item.id, 'delete', 'Removed by community moderation.').then(() => getCommunityGroupMessages(selectedGroup.id)).then(setGroupMessages).catch((e) => setError(e.message || 'Could not moderate message.'))} disabled={busy} type="button">Remove</button>}
              </div>
            </div>) : <div className="community-empty"><h2>No messages yet.</h2><p>Be the first person to start the conversation.</p></div>) : <div className="community-empty"><h2>Join the community first.</h2><p>This group chat is available to members. Join the group to participate.</p><button className="primary" onClick={() => toggleGroup(selectedGroup)} type="button">Join {selectedGroup.name}</button></div>}
          </div>
          {joined && <form className="group-chat-composer" onSubmit={postToGroup}>
            {replyTo && <div className="community-reply-bar"><div><small>Replying to @{replyTo.username || 'member'}</small><span>{replyTo.body}</span></div><button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">×</button></div>}
            <div className="community-composer-row"><input value={message} maxLength={2000} onChange={(e) => setMessage(e.target.value)} placeholder={replyTo ? 'Write your reply…' : 'Share something with the group…'} /><button className="primary" disabled={!message.trim() || busy} type="submit">Send</button></div>
          </form>}
        </div>
        <aside className="community-members"><div className="panel-heading"><h2>Members</h2><span>{groupMembers.length}</span></div>{groupMembers.slice(0, 12).map((member) => <div className="member-row-wrap" key={member.user_id}><button className="member-row" onClick={() => openProfile(member)} type="button"><Avatar person={member} /><div><strong>@{member.username || 'member'}</strong>{member.is_moderator && <span className="moderator-badge">Moderator</span>}<small>{member.display_name || 'Favourit member'}</small></div></button>{isModerator && member.user_id !== currentUserId && <button className="member-remove" onClick={() => removeMember(member)} disabled={busy} type="button">Remove</button>}</div>)}{groupMembers.length > 12 && <small className="members-more">+ {groupMembers.length - 12} more members</small>}</aside>
      </div>

      {forwardMessage && <div className="community-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setForwardMessage(null)}><div className="community-action-modal"><div className="community-modal-header"><div><div className="eyebrow">FORWARD MESSAGE</div><h2>Send to a chat</h2></div><button type="button" onClick={() => setForwardMessage(null)}>×</button></div><div className="community-forward-preview">{forwardMessage.body}</div><input className="community-modal-search" value={forwardSearch} onChange={(e) => setForwardSearch(e.target.value)} placeholder="Search your chats…" />{filteredForwardConversations.length ? <div className="community-forward-list">{filteredForwardConversations.map((chat) => <button className="community-forward-row" key={chat.conversation_id} onClick={() => forwardTo(chat)} disabled={busy} type="button"><Avatar person={{ avatar_url: chat.other_avatar_url, display_name: chat.other_display_name, username: chat.other_username }} /><span><strong>{chat.other_display_name || chat.other_username}</strong><small>@{chat.other_username}</small></span></button>)}</div> : <p className="community-modal-empty">No direct chats yet.</p>}{recommendedPeople.length > 0 && <><div className="community-modal-section-title">Recommended chats</div><div className="community-forward-list">{recommendedPeople.map((person) => <button className="community-forward-row" key={person.id || person.user_id} onClick={() => forwardTo(person)} disabled={busy} type="button"><Avatar person={person} /><span><strong>{person.display_name || person.username}</strong><small>@{person.username}</small></span></button>)}</div></>}</div></div>}
      {reportMessage && <div className="community-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setReportMessage(null)}><div className="community-action-modal"><div className="community-modal-header"><div><div className="eyebrow">REPORT MESSAGE</div><h2>Tell us what happened</h2></div><button type="button" onClick={() => setReportMessage(null)}>×</button></div><div className="community-report-target"><strong>@{reportMessage.username || 'member'}</strong><span>{reportMessage.body}</span></div><label className="community-modal-label">What rule did this break?<select value={reportCategory} onChange={(e) => setReportCategory(e.target.value)}>{REPORT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label><label className="community-modal-label">Additional details<textarea value={reportDetails} maxLength={2000} onChange={(e) => setReportDetails(e.target.value)} placeholder="Tell the Favourit team what you saw…" /></label><div className="community-modal-actions"><button className="secondary" onClick={() => setReportMessage(null)} type="button">Cancel</button><button className="primary" disabled={busy} onClick={submitReport} type="button">{busy ? 'Sending…' : 'Submit report'}</button></div></div></div>}
      {translation && <div className="community-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setTranslation(null)}><div className="community-action-modal"><div className="community-modal-header"><div><div className="eyebrow">TRANSLATION</div><h2>Translated message</h2></div><button type="button" onClick={() => setTranslation(null)}>×</button></div><div className="community-report-target"><strong>Original</strong><span>{translation.item.body}</span></div><div className="community-translation-result">{translationBusy ? 'Translating…' : translation.text}</div><small className="community-translation-note">Target language: {getPreferredLanguage()}</small></div></div>}
    </section>;
  }

  return <section className="page-section community-page">
    <div className="page-title community-title"><div><div className="eyebrow">COMMUNITY</div><h1>People make <span>Favourit.</span></h1><p>Find people to work with, build trusted connections and join communities around your skills.</p></div><button className="secondary" onClick={() => setTab('friends')} type="button">Your network · {graph.friends.length}</button></div>
    <div className="community-tabs"><button className={tab === 'discover' ? 'active' : ''} onClick={() => setTab('discover')} type="button">Discover</button><button className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')} type="button">Friends <span>{graph.friends.length}</span></button><button className={tab === 'groups' ? 'active' : ''} onClick={() => setTab('groups')} type="button">Groups <span>{groups.length}</span></button><button className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')} type="button">Requests {graph.incoming.length > 0 && <span className="count-badge">{graph.incoming.length}</span>}</button></div>
    {error && <div className="community-error">{error}</div>}
    {tab === 'discover' && <><div className="community-search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people by @username, name or skill…" /></div><div className="community-section-heading"><div><div className="eyebrow">NETWORK</div><h2>{search ? 'People matching your search' : 'People you may want to work with'}</h2></div><span>{discoverPeople.length} people</span></div>{discoverPeople.length ? <div className="people-grid">{discoverPeople.map((person) => { const personId = person.id || person.user_id; return <PersonCard key={personId} person={person} status={statusFor(personId)} onConnect={(value) => action(async () => { if (value === 'accept' || value === 'reject') { const request = graph.incoming.find((item) => item.user_id === personId); if (request) await respondFriendRequest(request.id, value); } else await sendFriendRequest(personId); })} onCancel={() => action(async () => { const request = graph.outgoing.find((item) => item.user_id === personId); if (request) await cancelFriendRequest(request.id); })} />; })}</div> : <div className="community-empty"><h2>{search ? 'No people found.' : 'No discoverable members yet.'}</h2><p>{search ? 'Try another name, @username or skill.' : 'As more members join Favourit, we will surface people who may be a good fit to work with.'}</p></div>}<div className="community-section-heading group-heading"><div><div className="eyebrow">COMMUNITIES</div><h2>Groups you can join</h2></div><button className="text-button" onClick={() => setTab('groups')} type="button">View all →</button></div><div className="groups-grid">{groups.slice(0, 6).map((group) => <GroupCard key={group.id} group={group} onOpen={openGroup} onToggle={toggleGroup} />)}</div></>}
    {tab === 'friends' && <div className="community-panel-grid"><div className="community-panel wide"><div className="panel-heading"><div><div className="eyebrow">YOUR NETWORK</div><h2>Friends</h2></div><span>{graph.friends.length}</span></div>{graph.friends.length ? graph.friends.map((person) => <PersonCard key={person.id || person.user_id} person={person} status="friends" onRemove={() => action(() => removeFriend(person.id || person.user_id))} />) : <div className="community-empty"><h2>No friends yet.</h2><p>Discover people you may want to work with and send your first connection request.</p><button className="primary" onClick={() => setTab('discover')} type="button">Discover people</button></div>}</div></div>}
    {tab === 'groups' && <><div className="community-section-heading"><div><div className="eyebrow">SKILL COMMUNITIES</div><h2>Find your people</h2></div><span>{groups.length} public groups</span></div><div className="groups-grid full">{groups.map((group) => <GroupCard key={group.id} group={group} onOpen={openGroup} onToggle={toggleGroup} />)}</div></>}
    {tab === 'requests' && <div className="community-panel-grid"><div className="community-panel wide"><div className="panel-heading"><div><div className="eyebrow">CONNECTIONS</div><h2>Friend requests</h2></div><span>{graph.incoming.length}</span></div>{graph.incoming.length ? graph.incoming.map((request) => <PersonCard key={request.id} person={request} status="incoming" onConnect={(value) => action(() => respondFriendRequest(request.id, value))} />) : <div className="community-empty"><h2>No pending requests.</h2><p>When someone wants to connect with you, their request will appear here.</p></div>}{graph.outgoing.length > 0 && <div className="outgoing-requests"><h3>Sent requests</h3>{graph.outgoing.map((request) => <div className="outgoing-row" key={request.id}><Avatar person={request} onClick={() => openProfile(request)} /><button className="outgoing-user" onClick={() => openProfile(request)} type="button">@{request.username || 'member'}</button><button className="secondary small" onClick={() => action(() => cancelFriendRequest(request.id))} type="button">Cancel</button></div>)}</div>}</div></div>}
  </section>;
}
