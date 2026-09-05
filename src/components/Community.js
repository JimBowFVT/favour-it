import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getMySocialGraph,
  searchCommunityPeople,
  sendFriendRequest,
  respondFriendRequest,
  cancelFriendRequest,
  removeFriend,
  listCommunityGroups,
  joinCommunityGroup,
  leaveCommunityGroup,
  getCommunityGroupMessages,
  sendCommunityGroupMessage,
  deleteOwnCommunityGroupMessage,
  toggleCommunityGroupMessageStar,
  getCommunityGroupMembers,
  reportCommunityGroupMessage,
  moderateCommunityGroupMessage,
  moderateCommunityGroupMember,
} from '../lib/social';
import { getMyDirectConversations, getOrCreateDirectConversation, sendDirectMessage } from '../lib/directMessaging';
import { supabase } from '../lib/supabase';
import './Community.css';
import './CommunityMessageActions.css';

const GROUP_ICONS = { designers: '✦', developers: '⌘', 'video-editors': '▣', musicians: '♫', marketers: '↗', photographers: '◉', writers: '✎', entrepreneurs: '◇' };
const REPORT_CATEGORIES = ['Harassment or bullying', 'Spam or scam', 'Hate or discrimination', 'Sexual content', 'Violence or threats', 'Impersonation', 'Illegal activity', 'Other'];
const EMPTY_GRAPH = { friends: [], incoming: [], outgoing: [], blocked: [] };

function initials(name = 'Favourit member') {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase() || 'FV';
}

function normalizeGraph(data) {
  return {
    friends: Array.isArray(data?.friends) ? data.friends : [],
    incoming: Array.isArray(data?.incoming) ? data.incoming : [],
    outgoing: Array.isArray(data?.outgoing) ? data.outgoing : [],
    blocked: Array.isArray(data?.blocked) ? data.blocked : [],
  };
}

function Avatar({ person, large = false, onClick }) {
  const name = person?.display_name || person?.username || 'Favourit member';
  const content = person?.avatar_url
    ? <img className={`community-avatar ${large ? 'large' : ''}`} src={person.avatar_url} alt="" />
    : <span className={`community-avatar ${large ? 'large' : ''}`}>{initials(name)}</span>;
  if (!onClick) return content;
  return <button className="community-avatar-button" onClick={onClick} type="button" aria-label={`Open @${person?.username || 'member'} profile`}>{content}</button>;
}

function openProfile(person) {
  const userId = person?.user_id || person?.sender_id || person?.id;
  if (!userId && !person?.username) return;
  window.dispatchEvent(new CustomEvent('favourit:open-profile', { detail: { userId, username: person?.username } }));
}

function openMessage(person) {
  if (!person?.username) return;
  window.dispatchEvent(new CustomEvent('favourit:open-direct-message', { detail: { username: person.username } }));
}

function PersonCard({ person, status, onConnect, onCancel, onRemove }) {
  return (
    <article className="community-person-card">
      <Avatar person={person} large onClick={() => openProfile(person)} />
      <div className="community-person-copy">
        <button className="community-person-name" onClick={() => openProfile(person)} type="button">{person.display_name || person.username || 'Favourit member'}</button>
        <button className="community-person-handle" onClick={() => openProfile(person)} type="button">@{person.username || 'member'}</button>
        <p>{person.bio || 'Favourit member · Open to new collaborations.'}</p>
      </div>
      <div className="community-person-actions">
        {status === 'friends' && <>
          <span className="community-status success">Friends ✓</span>
          <button className="secondary small" onClick={() => openMessage(person)} type="button">Message</button>
          {onRemove && <button className="text-button small" onClick={onRemove} type="button">Remove friend</button>}
        </>}
        {status === 'incoming' && <>
          <button className="primary small" onClick={() => onConnect?.('accept')} type="button">Accept</button>
          <button className="secondary small" onClick={() => onConnect?.('reject')} type="button">Decline</button>
        </>}
        {status === 'outgoing' && <button className="secondary small" onClick={onCancel} type="button">Pending</button>}
        {!status && <>
          <button className="primary small" onClick={() => onConnect?.()} type="button">Connect</button>
          <button className="secondary small" onClick={() => openMessage(person)} type="button">Message</button>
        </>}
      </div>
    </article>
  );
}

function GroupCard({ group, onOpen, onToggle }) {
  return (
    <article className="community-group-card">
      <div className="group-icon">{GROUP_ICONS[group.slug] || '◇'}</div>
      <div className="group-card-main">
        <div className="group-card-title"><h3>{group.name}</h3><span>Public</span></div>
        <p>{group.description}</p>
        <small>{Number(group.member_count || 0).toLocaleString()} members</small>
      </div>
      <div className="group-card-actions">
        <button className={group.is_joined ? 'secondary small' : 'primary small'} onClick={() => onToggle(group)} type="button">{group.is_joined ? 'Joined ✓' : 'Join'}</button>
        <button className="text-button" onClick={() => onOpen(group)} type="button">Chat →</button>
      </div>
    </article>
  );
}

function preferredLanguage() {
  try { return localStorage.getItem('favourit_language') || localStorage.getItem('favourit:language') || navigator.language || 'en'; }
  catch (_) { return 'en'; }
}

async function translateText(text) {
  const target = String(preferredLanguage()).split('-')[0].toLowerCase();
  if (!text || (target === 'en' && /^[\x00-\x7F]*$/.test(text))) return text;
  const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${encodeURIComponent(target)}`);
  if (!response.ok) throw new Error('Translation service is unavailable.');
  const data = await response.json();
  return data?.responseData?.translatedText || text;
}

export default function Community() {
  const [tab, setTab] = useState('discover');
  const [graph, setGraph] = useState(EMPTY_GRAPH);
  const [people, setPeople] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupMessages, setGroupMessages] = useState([]);
  const [groupMembers, setGroupMembers] = useState([]);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [currentUserId, setCurrentUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [menuMessageId, setMenuMessageId] = useState(null);
  const [forwardMessage, setForwardMessage] = useState(null);
  const [directConversations, setDirectConversations] = useState([]);
  const [forwardSearch, setForwardSearch] = useState('');
  const [reportMessage, setReportMessage] = useState(null);
  const [reportCategory, setReportCategory] = useState(REPORT_CATEGORIES[0]);
  const [reportDetails, setReportDetails] = useState('');
  const [translation, setTranslation] = useState(null);
  const [translationBusy, setTranslationBusy] = useState(false);
  const touchStartRef = useRef({ id: '', x: 0 });

  const refreshSocial = async () => {
    const data = await getMySocialGraph();
    setGraph(normalizeGraph(data));
  };

  const refreshGroups = async () => {
    const data = await listCommunityGroups();
    setGroups(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const userPromise = supabase?.auth?.getUser?.();
        const [social, groupData, userResult] = await Promise.all([
          getMySocialGraph(),
          listCommunityGroups(),
          userPromise || Promise.resolve({ data: { user: null } }),
        ]);
        if (!active) return;
        setGraph(normalizeGraph(social));
        setGroups(Array.isArray(groupData) ? groupData : []);
        setCurrentUserId(userResult?.data?.user?.id || '');
      } catch (e) {
        if (active) setError(e.message || 'Could not load Community.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const refresh = () => refreshSocial().catch(() => {});
    const openRequests = () => {
      setSelectedGroup(null);
      setTab('requests');
      refresh();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    window.addEventListener('favourit:friend-request-updated', refresh);
    window.addEventListener('favourit:open-community-requests', openRequests);
    return () => {
      window.removeEventListener('favourit:friend-request-updated', refresh);
      window.removeEventListener('favourit:open-community-requests', openRequests);
    };
  }, []);

  useEffect(() => {
    if (tab !== 'discover') return undefined;
    const timer = window.setTimeout(async () => {
      try {
        const data = await searchCommunityPeople(search.trim());
        setPeople(Array.isArray(data) ? data : []);
      } catch (e) {
        setError(e.message || 'Could not search people.');
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [search, tab]);

  useEffect(() => {
    if (!selectedGroup) return undefined;
    const joined = groups.find(group => group.id === selectedGroup.id)?.is_joined;
    if (!joined) return undefined;
    const refresh = async () => {
      try { setGroupMessages(await getCommunityGroupMessages(selectedGroup.id) || []); }
      catch (_) {}
    };
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, [selectedGroup, groups]);

  useEffect(() => {
    if (!menuMessageId) return undefined;
    const close = () => setMenuMessageId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuMessageId]);

  const statusFor = id => {
    if (graph.friends.some(person => (person.id || person.user_id) === id)) return 'friends';
    if (graph.incoming.some(person => person.user_id === id)) return 'incoming';
    if (graph.outgoing.some(person => person.user_id === id)) return 'outgoing';
    return '';
  };

  const action = async fn => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
      await refreshSocial();
      window.dispatchEvent(new CustomEvent('favourit:friend-request-updated'));
    } catch (e) {
      setError(e.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const openGroup = async group => {
    setSelectedGroup(group);
    setMenuMessageId(null);
    setError('');
    if (!group.is_joined) {
      setGroupMessages([]);
      setGroupMembers([]);
      return;
    }
    setBusy(true);
    try {
      const [messages, members] = await Promise.all([
        getCommunityGroupMessages(group.id),
        getCommunityGroupMembers(group.id),
      ]);
      setGroupMessages(Array.isArray(messages) ? messages : []);
      setGroupMembers(Array.isArray(members) ? members : []);
    } catch (e) {
      setError(e.message || 'Could not open this community.');
    } finally {
      setBusy(false);
    }
  };

  const toggleGroup = async group => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (group.is_joined) await leaveCommunityGroup(group.id);
      else await joinCommunityGroup(group.id);
      const fresh = await listCommunityGroups();
      const safeGroups = Array.isArray(fresh) ? fresh : [];
      setGroups(safeGroups);
      const updated = safeGroups.find(item => item.id === group.id);
      if (selectedGroup?.id === group.id) setSelectedGroup(updated || group);
      if (updated?.is_joined) {
        const [messages, members] = await Promise.all([
          getCommunityGroupMessages(group.id),
          getCommunityGroupMembers(group.id),
        ]);
        setGroupMessages(Array.isArray(messages) ? messages : []);
        setGroupMembers(Array.isArray(members) ? members : []);
      } else {
        setGroupMessages([]);
        setGroupMembers([]);
      }
    } catch (e) {
      setError(e.message || 'Could not update community membership.');
    } finally {
      setBusy(false);
    }
  };

  const postToGroup = async event => {
    event.preventDefault();
    if (!selectedGroup || !message.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await sendCommunityGroupMessage(selectedGroup.id, message.trim(), replyTo?.id || null);
      setMessage('');
      setReplyTo(null);
      setGroupMessages(await getCommunityGroupMessages(selectedGroup.id) || []);
    } catch (e) {
      setError(e.message || 'Could not send message.');
    } finally {
      setBusy(false);
    }
  };

  const startReply = item => {
    if (item?.is_deleted) return;
    setReplyTo(item);
    setMenuMessageId(null);
    window.setTimeout(() => document.querySelector('.group-chat-composer input')?.focus(), 0);
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
    } catch (_) {
      setError('Could not copy the message.');
    }
    setMenuMessageId(null);
  };

  const toggleStar = async item => {
    if (!item?.id || busy) return;
    setBusy(true);
    setError('');
    try {
      await toggleCommunityGroupMessageStar(item.id);
      setGroupMessages(await getCommunityGroupMessages(selectedGroup.id) || []);
    } catch (e) {
      setError(e.message || 'Could not update star.');
    } finally {
      setBusy(false);
      setMenuMessageId(null);
    }
  };

  const deleteOwnMessage = async item => {
    if (!item?.id || item.sender_id !== currentUserId || item.is_deleted || busy) return;
    const age = Date.now() - new Date(item.created_at).getTime();
    if (age > 15 * 60 * 1000) {
      setError('Messages can only be deleted within 15 minutes.');
      setMenuMessageId(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await deleteOwnCommunityGroupMessage(item.id);
      setGroupMessages(await getCommunityGroupMessages(selectedGroup.id) || []);
    } catch (e) {
      setError(e.message || 'Could not delete the message.');
    } finally {
      setBusy(false);
      setMenuMessageId(null);
    }
  };

  const moderatorDelete = async item => {
    if (!window.confirm('Remove this message from the community chat?')) return;
    setBusy(true);
    setError('');
    try {
      await moderateCommunityGroupMessage(item.id, 'delete', 'Removed by community moderation.');
      setGroupMessages(await getCommunityGroupMessages(selectedGroup.id) || []);
    } catch (e) {
      setError(e.message || 'Could not moderate this message.');
    } finally {
      setBusy(false);
      setMenuMessageId(null);
    }
  };

  const openForward = async item => {
    setMenuMessageId(null);
    setForwardMessage(item);
    setForwardSearch('');
    try { setDirectConversations(await getMyDirectConversations()); }
    catch (e) { setError(e.message || 'Could not load your chats.'); }
  };

  const forwardTo = async target => {
    if (!forwardMessage?.body || busy) return;
    setBusy(true);
    setError('');
    try {
      const id = target.conversation_id || await getOrCreateDirectConversation(target.username);
      await sendDirectMessage(id, forwardMessage.body);
      setForwardMessage(null);
    } catch (e) {
      setError(e.message || 'Could not forward message.');
    } finally {
      setBusy(false);
    }
  };

  const openReport = item => {
    setReportMessage(item);
    setReportCategory(REPORT_CATEGORIES[0]);
    setReportDetails('');
    setMenuMessageId(null);
  };

  const submitReport = async () => {
    if (!reportMessage || busy) return;
    setBusy(true);
    setError('');
    try {
      await reportCommunityGroupMessage(reportMessage.id, reportCategory, reportDetails.trim());
      setReportMessage(null);
      setReportDetails('');
    } catch (e) {
      setError(e.message || 'Could not submit report.');
    } finally {
      setBusy(false);
    }
  };

  const translateMessage = async item => {
    if (!item?.body || item.is_deleted) return;
    setMenuMessageId(null);
    setTranslation({ item, text: '' });
    setTranslationBusy(true);
    try { setTranslation({ item, text: await translateText(item.body) }); }
    catch (e) { setTranslation({ item, text: e.message || 'Could not translate this message.' }); }
    finally { setTranslationBusy(false); }
  };

  const removeMember = async member => {
    if (!window.confirm(`Remove @${member.username || 'this member'} from the group?`)) return;
    setBusy(true);
    setError('');
    try {
      await moderateCommunityGroupMember(selectedGroup.id, member.user_id, 'remove');
      const [members, messages] = await Promise.all([
        getCommunityGroupMembers(selectedGroup.id),
        getCommunityGroupMessages(selectedGroup.id),
      ]);
      setGroupMembers(Array.isArray(members) ? members : []);
      setGroupMessages(Array.isArray(messages) ? messages : []);
      await refreshGroups();
    } catch (e) {
      setError(e.message || 'Could not remove member.');
    } finally {
      setBusy(false);
    }
  };

  const onTouchStart = (item, event) => {
    touchStartRef.current = { id: item.id, x: event.touches?.[0]?.clientX || 0 };
  };

  const onTouchEnd = (item, event) => {
    const start = touchStartRef.current;
    const endX = event.changedTouches?.[0]?.clientX || 0;
    if (start.id === item.id && endX - start.x > 60) startReply(item);
    touchStartRef.current = { id: '', x: 0 };
  };

  const filteredForwardConversations = useMemo(() => {
    const term = forwardSearch.trim().toLowerCase();
    if (!term) return directConversations;
    return directConversations.filter(item => `${item.other_username || ''} ${item.other_display_name || ''}`.toLowerCase().includes(term));
  }, [directConversations, forwardSearch]);

  if (loading) {
    return <section className="page-section community-page"><div className="community-empty"><h2>Loading Community…</h2><p>Getting your people, requests and communities ready.</p></div></section>;
  }

  if (selectedGroup) {
    const joined = Boolean(groups.find(group => group.id === selectedGroup.id)?.is_joined);
    const me = groupMembers.find(member => member.user_id === currentUserId);
    const isModerator = Boolean(me?.is_moderator);

    return (
      <section className="page-section community-page">
        <button className="back-button" onClick={() => { setSelectedGroup(null); setGroupMessages([]); setGroupMembers([]); setReplyTo(null); }} type="button">← Back to Community</button>
        <div className="community-group-hero">
          <div className="group-icon hero">{GROUP_ICONS[selectedGroup.slug] || '◇'}</div>
          <div>
            <div className="eyebrow">PUBLIC COMMUNITY</div>
            <h1>{selectedGroup.name}</h1>
            <p>{selectedGroup.description}</p>
            <span className="group-meta">{Number(selectedGroup.member_count || 0).toLocaleString()} members · Public</span>
          </div>
          <button className={joined ? 'secondary' : 'primary'} onClick={() => toggleGroup(selectedGroup)} disabled={busy} type="button">{joined ? 'Leave group' : 'Join group'}</button>
        </div>
        {error && <div className="community-error">{error}</div>}

        <div className="community-chat-layout">
          <div className="community-group-chat">
            <div className="group-chat-header">
              <div><strong>Community chat</strong><span>Member-only community conversation · no typing indicators.</span></div>
              <span className="moderated-pill">Moderated</span>
            </div>
            <div className="group-chat-messages">
              {joined ? (groupMessages.length ? groupMessages.map(item => {
                const mine = item.sender_id === currentUserId;
                const canDelete = mine && !item.is_deleted && Date.now() - new Date(item.created_at).getTime() <= 15 * 60 * 1000;
                return (
                  <div className={`group-message ${item.is_deleted ? 'deleted' : ''}`} key={item.id} onTouchStart={event => onTouchStart(item, event)} onTouchEnd={event => onTouchEnd(item, event)}>
                    <Avatar person={item} onClick={() => openProfile(item)} />
                    <div className="group-message-body">
                      <div className="group-message-head">
                        <button className="group-message-user" onClick={() => openProfile(item)} type="button">{item.display_name || item.username || 'Member'}</button>
                        <button className="group-message-handle" onClick={() => openProfile(item)} type="button">@{item.username || 'member'}</button>
                        {item.is_moderator && <span className="moderator-badge">Moderator</span>}
                        <time>{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                        {!item.is_deleted && <div className="community-message-menu-wrap" onClick={event => event.stopPropagation()}>
                          <button className="community-message-more" type="button" aria-label="Message options" onClick={() => setMenuMessageId(value => value === item.id ? null : item.id)}>•••</button>
                          {menuMessageId === item.id && <div className="community-message-menu">
                            <button type="button" onClick={() => startReply(item)}>↩ <span>Reply</span></button>
                            <button type="button" onClick={() => openForward(item)}>↗ <span>Forward</span></button>
                            <button type="button" onClick={() => copyMessage(item)}>⧉ <span>Copy</span></button>
                            <button type="button" onClick={() => toggleStar(item)}>★ <span>{item.is_starred ? 'Unstar' : 'Star'}</span></button>
                            {mine ? (
                              <button className={canDelete ? 'danger' : 'disabled'} disabled={!canDelete} type="button" onClick={() => deleteOwnMessage(item)}>⌫ <span>{canDelete ? 'Delete' : 'Delete expired'}</span></button>
                            ) : <>
                              <button type="button" onClick={() => translateMessage(item)}>文 <span>Translate</span></button>
                              <button className="danger" type="button" onClick={() => openReport(item)}>! <span>Report</span></button>
                              {isModerator && <button className="danger" type="button" onClick={() => moderatorDelete(item)}>× <span>Remove as moderator</span></button>}
                            </>}
                          </div>}
                        </div>}
                      </div>
                      {item.reply_to_message_id && <div className="community-reply-preview"><strong>@{item.reply_to_username || 'member'}</strong><span>{item.reply_to_body || 'Message'}</span></div>}
                      <p>{item.body}</p>
                      {item.is_starred && <span className="community-starred">★ Starred</span>}
                    </div>
                  </div>
                );
              }) : <div className="community-empty"><h2>No messages yet.</h2><p>Be the first person to start the conversation.</p></div>) : (
                <div className="community-empty"><h2>Join the community first.</h2><p>This chat is available to community members.</p><button className="primary" onClick={() => toggleGroup(selectedGroup)} type="button">Join {selectedGroup.name}</button></div>
              )}
            </div>
            {joined && <form className="group-chat-composer" onSubmit={postToGroup}>
              {replyTo && <div className="community-reply-bar"><div><small>Replying to @{replyTo.username || 'member'}</small><span>{replyTo.body}</span></div><button type="button" onClick={() => setReplyTo(null)}>×</button></div>}
              <div className="community-composer-row"><input value={message} maxLength={2000} onChange={event => setMessage(event.target.value)} placeholder="Share something with the community…" /><button className="primary" disabled={!message.trim() || busy} type="submit">Send</button></div>
            </form>}
          </div>

          <aside className="community-members">
            <div className="panel-heading"><h2>Members</h2><span>{groupMembers.length}</span></div>
            {groupMembers.slice(0, 30).map(member => <div className="member-row-wrap" key={member.user_id}>
              <button className="member-row" onClick={() => openProfile(member)} type="button"><Avatar person={member} /><div><strong>@{member.username || 'member'}</strong>{member.is_moderator && <span className="moderator-badge">Moderator</span>}<small>{member.display_name || 'Favourit member'}</small></div></button>
              {isModerator && !member.is_current_user && <button className="member-remove" onClick={() => removeMember(member)} disabled={busy} type="button">Remove</button>}
            </div>)}
          </aside>
        </div>

        {forwardMessage && <div className="community-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setForwardMessage(null); }}><div className="community-action-modal">
          <div className="community-modal-header"><h2>Forward message</h2><button onClick={() => setForwardMessage(null)} type="button">×</button></div>
          <div className="community-forward-preview">{forwardMessage.body}</div>
          <input className="community-modal-search" value={forwardSearch} onChange={event => setForwardSearch(event.target.value)} placeholder="Search your chats…" />
          <div className="community-modal-section-title">Your chats</div>
          <div className="community-forward-list">{filteredForwardConversations.map(item => <button className="community-forward-row" key={item.conversation_id} onClick={() => forwardTo({ conversation_id: item.conversation_id, username: item.other_username })} type="button"><Avatar person={{ username: item.other_username, display_name: item.other_display_name, avatar_url: item.other_avatar_url }} /><span><strong>{item.other_display_name || `@${item.other_username}`}</strong><small>@{item.other_username}</small></span></button>)}</div>
          <div className="community-modal-section-title">Recommended</div>
          <div className="community-forward-list">{graph.friends.slice(0, 8).map(friend => <button className="community-forward-row" key={friend.id || friend.user_id} onClick={() => forwardTo({ username: friend.username })} type="button"><Avatar person={friend} /><span><strong>{friend.display_name || `@${friend.username}`}</strong><small>@{friend.username}</small></span></button>)}</div>
        </div></div>}

        {reportMessage && <div className="community-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setReportMessage(null); }}><div className="community-action-modal">
          <div className="community-modal-header"><h2>Report message</h2><button onClick={() => setReportMessage(null)} type="button">×</button></div>
          <div className="community-report-target"><strong>@{reportMessage.username || 'member'}</strong><span>{reportMessage.body}</span></div>
          <label className="community-modal-label">What rule was broken?<select value={reportCategory} onChange={event => setReportCategory(event.target.value)}>{REPORT_CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></label>
          <label className="community-modal-label">Tell us what happened<textarea maxLength={2000} value={reportDetails} onChange={event => setReportDetails(event.target.value)} placeholder="Add context for the moderation team…" /></label>
          <div className="community-modal-actions"><button className="secondary" onClick={() => setReportMessage(null)} type="button">Cancel</button><button className="primary" onClick={submitReport} disabled={busy} type="button">Submit report</button></div>
        </div></div>}

        {translation && <div className="community-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setTranslation(null); }}><div className="community-action-modal">
          <div className="community-modal-header"><h2>Translation</h2><button onClick={() => setTranslation(null)} type="button">×</button></div>
          <div className="community-report-target"><strong>Original</strong><span>{translation.item.body}</span></div>
          <div className="community-translation-result">{translationBusy ? 'Translating…' : translation.text}</div>
          <small className="community-translation-note">Translated to your selected Favourit/browser language.</small>
        </div></div>}
      </section>
    );
  }

  const discoverPeople = people.slice(0, 12);

  return (
    <section className="page-section community-page">
      <div className="page-title community-title">
        <div><div className="eyebrow">COMMUNITY</div><h1>People make <span>Favourit.</span></h1><p>Find people to work with, build trusted connections and join communities around your skills.</p></div>
        <button className="secondary" onClick={() => setTab('friends')} type="button">Your network · {graph.friends.length}</button>
      </div>

      <div className="community-tabs">
        <button className={tab === 'discover' ? 'active' : ''} onClick={() => setTab('discover')} type="button">Discover</button>
        <button className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')} type="button">Friends <span>{graph.friends.length}</span></button>
        <button className={tab === 'groups' ? 'active' : ''} onClick={() => setTab('groups')} type="button">Groups <span>{groups.length}</span></button>
        <button className={tab === 'requests' ? 'active' : ''} onClick={() => { setTab('requests'); refreshSocial().catch(() => {}); }} type="button">Requests {graph.incoming.length > 0 && <span className="count-badge">{graph.incoming.length > 99 ? '99+' : graph.incoming.length}</span>}</button>
      </div>

      {error && <div className="community-error">{error}</div>}

      {tab === 'discover' && <>
        <div className="community-search"><span>⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search people by @username, name or skill…" /></div>
        <div className="community-section-heading"><div><div className="eyebrow">NETWORK</div><h2>{search ? 'People matching your search' : 'People you may want to work with'}</h2></div><span>{discoverPeople.length} people</span></div>
        {discoverPeople.length ? <div className="people-grid">{discoverPeople.map(person => {
          const personId = person.id || person.user_id;
          const status = statusFor(personId);
          return <PersonCard key={personId} person={person} status={status} onConnect={value => action(async () => {
            if (value === 'accept' || value === 'reject') {
              const request = graph.incoming.find(item => item.user_id === personId);
              if (request) await respondFriendRequest(request.id, value);
            } else await sendFriendRequest(personId);
          })} onCancel={() => action(async () => {
            const request = graph.outgoing.find(item => item.user_id === personId);
            if (request) await cancelFriendRequest(request.id);
          })} />;
        })}</div> : <div className="community-empty"><h2>{search ? 'No people found.' : 'No discoverable members yet.'}</h2><p>{search ? 'Try another name, @username or skill.' : 'More people will appear here as the Favourit community grows.'}</p></div>}
        <div className="community-section-heading group-heading"><div><div className="eyebrow">COMMUNITIES</div><h2>Groups you can join</h2></div><button className="text-button" onClick={() => setTab('groups')} type="button">View all →</button></div>
        <div className="groups-grid">{groups.slice(0, 6).map(group => <GroupCard key={group.id} group={group} onOpen={openGroup} onToggle={toggleGroup} />)}</div>
      </>}

      {tab === 'friends' && <div className="community-panel-grid"><div className="community-panel wide">
        <div className="panel-heading"><div><div className="eyebrow">YOUR NETWORK</div><h2>Friends</h2></div><span>{graph.friends.length}</span></div>
        {graph.friends.length ? graph.friends.map(person => <PersonCard key={person.id || person.user_id} person={person} status="friends" onRemove={() => action(() => removeFriend(person.id || person.user_id))} />) : <div className="community-empty"><h2>No friends yet.</h2><p>Discover people and send your first connection request.</p><button className="primary" onClick={() => setTab('discover')} type="button">Discover people</button></div>}
      </div></div>}

      {tab === 'groups' && <><div className="community-section-heading"><div><div className="eyebrow">SKILL COMMUNITIES</div><h2>Find your people</h2></div><span>{groups.length} public groups</span></div><div className="groups-grid full">{groups.map(group => <GroupCard key={group.id} group={group} onOpen={openGroup} onToggle={toggleGroup} />)}</div></>}

      {tab === 'requests' && <div className="community-panel-grid"><div className="community-panel wide">
        <div className="panel-heading"><div><div className="eyebrow">CONNECTIONS</div><h2>Friend requests</h2></div><span>{graph.incoming.length}</span></div>
        {graph.incoming.length ? graph.incoming.map(request => <PersonCard key={request.id} person={request} status="incoming" onConnect={value => action(() => respondFriendRequest(request.id, value))} />) : <div className="community-empty"><h2>No pending requests.</h2><p>New friend requests will appear here automatically.</p></div>}
        {graph.outgoing.length > 0 && <div className="outgoing-requests"><h3>Sent requests</h3>{graph.outgoing.map(request => <div className="outgoing-row" key={request.id}><Avatar person={request} onClick={() => openProfile(request)} /><button className="outgoing-user" onClick={() => openProfile(request)} type="button">@{request.username || 'member'}</button><button className="secondary small" onClick={() => action(() => cancelFriendRequest(request.id))} type="button">Cancel</button></div>)}</div>}
      </div></div>}
    </section>
  );
}
