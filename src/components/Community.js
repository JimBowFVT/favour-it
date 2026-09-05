import { useEffect, useMemo, useState } from 'react';
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
  getCommunityGroupMembers,
  moderateCommunityGroupMember,
} from '../lib/social';
import { supabase } from '../lib/supabase';
import './Community.css';

const GROUP_ICONS = { designers: '✦', developers: '⌘', 'video-editors': '▣', musicians: '♫', marketers: '↗', photographers: '◉', writers: '✎', entrepreneurs: '◇' };
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
  const userId = person?.user_id || person?.id;
  if (!userId && !person?.username) return;
  window.dispatchEvent(new CustomEvent('favourit:open-profile', { detail: { userId, username: person?.username } }));
}

function openMessage(person) {
  if (!person?.username) return;
  window.dispatchEvent(new CustomEvent('favourit:open-direct-message', { detail: { username: person.username } }));
}

function openCommunityChat(group) {
  if (!group?.id || !group?.is_joined) return;
  window.dispatchEvent(new CustomEvent('favourit:open-community-chat', { detail: { groupId: group.id } }));
}

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
      {status === 'incoming' && <><button className="primary small" onClick={() => onConnect?.('accept')} type="button">Accept</button><button className="secondary small" onClick={() => onConnect?.('reject')} type="button">Decline</button></>}
      {status === 'outgoing' && <button className="secondary small" onClick={onCancel} type="button">Pending</button>}
      {!status && <><button className="primary small" onClick={() => onConnect?.()} type="button">Connect</button><button className="secondary small" onClick={() => openMessage(person)} type="button">Message</button></>}
    </div>
  </article>;
}

function GroupCard({ group, onDetails, onToggle }) {
  return <article className="community-group-card">
    <div className="group-icon">{GROUP_ICONS[group.slug] || '◇'}</div>
    <div className="group-card-main"><div className="group-card-title"><h3>{group.name}</h3><span>Public</span></div><p>{group.description}</p><small>{Number(group.member_count || 0).toLocaleString()} members</small></div>
    <div className="group-card-actions">
      <button className={group.is_joined ? 'secondary small' : 'primary small'} onClick={() => onToggle(group)} type="button">{group.is_joined ? 'Joined ✓' : 'Join'}</button>
      {group.is_joined && <button className="text-button" onClick={() => openCommunityChat(group)} type="button">Chat →</button>}
      <button className="text-button" onClick={() => onDetails(group)} type="button">Details</button>
    </div>
  </article>;
}

export default function Community() {
  const [tab, setTab] = useState('discover');
  const [graph, setGraph] = useState(EMPTY_GRAPH);
  const [people, setPeople] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupMembers, setGroupMembers] = useState([]);
  const [search, setSearch] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshSocial = async () => {
    const data = await getMySocialGraph();
    const normalized = normalizeGraph(data);
    setGraph(normalized);
    return normalized;
  };

  const refreshGroups = async () => {
    const data = await listCommunityGroups();
    const safe = Array.isArray(data) ? data : [];
    setGroups(safe);
    return safe;
  };

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const [social, groupData, userResult] = await Promise.all([
          getMySocialGraph(),
          listCommunityGroups(),
          supabase?.auth?.getUser?.() || Promise.resolve({ data: { user: null } }),
        ]);
        if (!active) return;
        setGraph(normalizeGraph(social));
        setGroups(Array.isArray(groupData) ? groupData : []);
        setCurrentUserId(userResult?.data?.user?.id || '');
      } catch (e) {
        if (active) setError(e.message || 'Could not load Community.');
      } finally { if (active) setLoading(false); }
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
      } catch (e) { setError(e.message || 'Could not search people.'); }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [search, tab]);

  const statusFor = id => {
    if (graph.friends.some(person => (person.id || person.user_id) === id)) return 'friends';
    if (graph.incoming.some(person => person.user_id === id)) return 'incoming';
    if (graph.outgoing.some(person => person.user_id === id)) return 'outgoing';
    return '';
  };

  const action = async fn => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await fn();
      await refreshSocial();
      window.dispatchEvent(new CustomEvent('favourit:friend-request-updated'));
    } catch (e) { setError(e.message || 'Something went wrong.'); }
    finally { setBusy(false); }
  };

  const toggleGroup = async group => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (group.is_joined) await leaveCommunityGroup(group.id);
      else await joinCommunityGroup(group.id);
      const fresh = await refreshGroups();
      const updated = fresh.find(item => item.id === group.id);
      if (selectedGroup?.id === group.id) {
        setSelectedGroup(updated || null);
        if (updated?.is_joined) setGroupMembers(await getCommunityGroupMembers(group.id) || []);
        else setGroupMembers([]);
      }
    } catch (e) { setError(e.message || 'Could not update community membership.'); }
    finally { setBusy(false); }
  };

  const openDetails = async group => {
    setSelectedGroup(group);
    setGroupMembers([]);
    setError('');
    if (!group.is_joined) return;
    try {
      const members = await getCommunityGroupMembers(group.id);
      setGroupMembers(Array.isArray(members) ? members : []);
    } catch (e) { setError(e.message || 'Could not load community members.'); }
  };

  const removeMember = async member => {
    if (!selectedGroup || busy) return;
    if (!window.confirm(`Remove @${member.username || 'this member'} from ${selectedGroup.name}?`)) return;
    setBusy(true); setError('');
    try {
      await moderateCommunityGroupMember(selectedGroup.id, member.user_id, 'remove');
      setGroupMembers(await getCommunityGroupMembers(selectedGroup.id) || []);
      await refreshGroups();
    } catch (e) { setError(e.message || 'Could not remove member.'); }
    finally { setBusy(false); }
  };

  const discoverPeople = useMemo(() => people.slice(0, 12), [people]);

  if (loading) return <section className="page-section community-page"><div className="community-empty"><h2>Loading Community…</h2><p>Getting your people, requests and communities ready.</p></div></section>;

  if (selectedGroup) {
    const liveGroup = groups.find(group => group.id === selectedGroup.id) || selectedGroup;
    const joined = Boolean(liveGroup.is_joined);
    const me = groupMembers.find(member => member.user_id === currentUserId);
    const isModerator = Boolean(me?.is_moderator);
    return <section className="page-section community-page">
      <button className="back-button" onClick={() => { setSelectedGroup(null); setGroupMembers([]); }} type="button">← Back to Community</button>
      <div className="community-group-hero">
        <div className="group-icon hero">{GROUP_ICONS[liveGroup.slug] || '◇'}</div>
        <div><div className="eyebrow">PUBLIC COMMUNITY</div><h1>{liveGroup.name}</h1><p>{liveGroup.description}</p><span className="group-meta">{Number(liveGroup.member_count || 0).toLocaleString()} members · Public</span></div>
        <div className="community-person-actions">
          <button className={joined ? 'secondary' : 'primary'} onClick={() => toggleGroup(liveGroup)} disabled={busy} type="button">{joined ? 'Leave group' : 'Join group'}</button>
          {joined && <button className="primary" onClick={() => openCommunityChat(liveGroup)} type="button">Open chat in Messages →</button>}
        </div>
      </div>
      {error && <div className="community-error">{error}</div>}
      <div className="community-chat-layout">
        <div className="community-panel">
          <div className="eyebrow">COMMUNITY CHAT</div>
          <h2>One chat, inside Messages.</h2>
          <p className="panel-copy">Community chats now use the same messaging system as private chats, so media, deal cards, replies, forwarding, starring, reporting and translation all work in one place.</p>
          {joined ? <button className="primary" onClick={() => openCommunityChat(liveGroup)} type="button">Open {liveGroup.name} chat →</button> : <button className="primary" onClick={() => toggleGroup(liveGroup)} type="button">Join to open chat</button>}
        </div>
        <aside className="community-members">
          <div className="panel-heading"><h2>Members</h2><span>{groupMembers.length}</span></div>
          {joined ? groupMembers.slice(0, 50).map(member => <div className="member-row-wrap" key={member.user_id}>
            <button className="member-row" onClick={() => openProfile(member)} type="button"><Avatar person={member} /><div><strong>@{member.username || 'member'}</strong>{member.is_moderator && <span className="moderator-badge">Moderator</span>}<small>{member.display_name || 'Favourit member'}</small></div></button>
            {isModerator && !member.is_current_user && <button className="member-remove" onClick={() => removeMember(member)} disabled={busy} type="button">Remove</button>}
          </div>) : <div className="community-empty"><p>Join the community to see its members and chat.</p></div>}
        </aside>
      </div>
    </section>;
  }

  return <section className="page-section community-page">
    <div className="page-title community-title"><div><div className="eyebrow">COMMUNITY</div><h1>People make <span>Favourit.</span></h1><p>Find people to work with, build trusted connections and join communities around your skills.</p></div><button className="secondary" onClick={() => setTab('friends')} type="button">Your network · {graph.friends.length}</button></div>
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
      <div className="groups-grid">{groups.slice(0, 6).map(group => <GroupCard key={group.id} group={group} onDetails={openDetails} onToggle={toggleGroup} />)}</div>
    </>}

    {tab === 'friends' && <div className="community-panel-grid"><div className="community-panel wide"><div className="panel-heading"><div><div className="eyebrow">YOUR NETWORK</div><h2>Friends</h2></div><span>{graph.friends.length}</span></div>{graph.friends.length ? graph.friends.map(person => <PersonCard key={person.id || person.user_id} person={person} status="friends" onRemove={() => action(() => removeFriend(person.id || person.user_id))} />) : <div className="community-empty"><h2>No friends yet.</h2><p>Discover people and send your first connection request.</p><button className="primary" onClick={() => setTab('discover')} type="button">Discover people</button></div>}</div></div>}

    {tab === 'groups' && <><div className="community-section-heading"><div><div className="eyebrow">SKILL COMMUNITIES</div><h2>Find your people</h2></div><span>{groups.length} public groups</span></div><div className="groups-grid full">{groups.map(group => <GroupCard key={group.id} group={group} onDetails={openDetails} onToggle={toggleGroup} />)}</div></>}

    {tab === 'requests' && <div className="community-panel-grid"><div className="community-panel wide"><div className="panel-heading"><div><div className="eyebrow">CONNECTIONS</div><h2>Friend requests</h2></div><span>{graph.incoming.length}</span></div>{graph.incoming.length ? graph.incoming.map(request => <PersonCard key={request.id} person={request} status="incoming" onConnect={value => action(() => respondFriendRequest(request.id, value))} />) : <div className="community-empty"><h2>No pending requests.</h2><p>New friend requests will appear here automatically.</p></div>}{graph.outgoing.length > 0 && <div className="outgoing-requests"><h3>Sent requests</h3>{graph.outgoing.map(request => <div className="outgoing-row" key={request.id}><Avatar person={request} onClick={() => openProfile(request)} /><button className="outgoing-user" onClick={() => openProfile(request)} type="button">@{request.username || 'member'}</button><button className="secondary small" onClick={() => action(() => cancelFriendRequest(request.id))} type="button">Cancel</button></div>)}</div>}</div></div>}
  </section>;
}
