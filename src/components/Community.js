import { useEffect, useMemo, useState } from 'react';
import {
  getMySocialGraph,
  searchCommunityPeople,
  sendFriendRequest,
  respondFriendRequest,
  cancelFriendRequest,
  blockUser,
  listCommunityGroups,
  joinCommunityGroup,
  leaveCommunityGroup,
  getCommunityGroupMessages,
  sendCommunityGroupMessage,
  getCommunityGroupMembers,
} from '../lib/social';
import './Community.css';

const GROUP_ICONS = { designers: '✦', developers: '⌘', 'video-editors': '▣', musicians: '♫', marketers: '↗', photographers: '◉', writers: '✎', entrepreneurs: '◇' };

function initials(name = 'Favourit member') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'FV';
}

function Avatar({ person, large = false }) {
  if (person?.avatar_url) return <img className={`community-avatar ${large ? 'large' : ''}`} src={person.avatar_url} alt="" />;
  return <div className={`community-avatar ${large ? 'large' : ''}`}>{initials(person?.display_name || person?.username)}</div>;
}

function PersonCard({ person, status, onConnect, onCancel, onBlock, onMessage }) {
  return (
    <article className="community-person-card">
      <Avatar person={person} large />
      <div className="community-person-copy">
        <strong>{person.display_name || person.username || 'Favourit member'}</strong>
        <span>@{person.username || 'member'}</span>
        <p>{person.bio || 'Favourit member · Open to new collaborations.'}</p>
      </div>
      <div className="community-person-actions">
        {status === 'friends' && <><span className="community-status success">Friends ✓</span>{onMessage && <button className="secondary small" onClick={onMessage}>Message</button>}</>}
        {status === 'incoming' && <button className="primary small" onClick={() => onConnect('accept')}>Accept</button>}
        {status === 'incoming' && <button className="secondary small" onClick={() => onConnect('reject')}>Decline</button>}
        {status === 'outgoing' && <button className="secondary small" onClick={onCancel}>Pending</button>}
        {!status && <button className="primary small" onClick={onConnect}>Connect</button>}
        {status !== 'friends' && <button className="text-button subtle" onClick={onBlock}>Block</button>}
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
        <button className={group.is_joined ? 'secondary small' : 'primary small'} onClick={() => onToggle(group)}>{group.is_joined ? 'Joined ✓' : 'Join'}</button>
        <button className="text-button" onClick={() => onOpen(group)}>Open group →</button>
      </div>
    </article>
  );
}

export default function Community({ onOpenMessages }) {
  const [tab, setTab] = useState('discover');
  const [people, setPeople] = useState([]);
  const [graph, setGraph] = useState({ friends: [], incoming: [], outgoing: [], blocked: [] });
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupMessages, setGroupMessages] = useState([]);
  const [groupMembers, setGroupMembers] = useState([]);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refreshSocial = async () => {
    const data = await getMySocialGraph();
    setGraph({ friends: data?.friends || [], incoming: data?.incoming || [], outgoing: data?.outgoing || [], blocked: data?.blocked || [] });
  };
  const refreshGroups = async () => {
    const data = await listCommunityGroups();
    setGroups(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    let alive = true;
    Promise.all([refreshSocial(), refreshGroups()]).catch(err => alive && setError(err.message || 'Could not load Community.'));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      if (!search.trim()) { setPeople([]); return; }
      try { setPeople(await searchCommunityPeople(search.trim())); } catch (err) { setError(err.message || 'Could not search people.'); }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const statusFor = id => {
    if (graph.friends.some(person => person.id === id || person.user_id === id)) return 'friends';
    if (graph.incoming.some(person => person.user_id === id)) return 'incoming';
    if (graph.outgoing.some(person => person.user_id === id)) return 'outgoing';
    return '';
  };
  const discoverPeople = useMemo(() => people.length ? people : graph.friends.slice(0, 5), [people, graph.friends]);
  const action = async fn => {
    setBusy(true); setError('');
    try { await fn(); await refreshSocial(); }
    catch (err) { setError(err.message || 'Something went wrong.'); }
    finally { setBusy(false); }
  };

  const openGroup = async group => {
    setSelectedGroup(group); setError(''); setBusy(true);
    try {
      const [messages, members] = await Promise.all([getCommunityGroupMessages(group.id), getCommunityGroupMembers(group.id)]);
      setGroupMessages(messages || []); setGroupMembers(members || []);
    } catch (err) { setError(err.message || 'Join the group to view its chat.'); }
    finally { setBusy(false); }
  };
  const toggleGroup = async group => {
    setBusy(true); setError('');
    try { if (group.is_joined) await leaveCommunityGroup(group.id); else await joinCommunityGroup(group.id); await refreshGroups(); }
    catch (err) { setError(err.message || 'Could not update group membership.'); }
    finally { setBusy(false); }
  };
  const postToGroup = async event => {
    event.preventDefault();
    if (!selectedGroup || !message.trim() || busy) return;
    setBusy(true); setError('');
    try { await sendCommunityGroupMessage(selectedGroup.id, message.trim()); setMessage(''); setGroupMessages(await getCommunityGroupMessages(selectedGroup.id)); }
    catch (err) { setError(err.message || 'Could not send message.'); }
    finally { setBusy(false); }
  };

  if (selectedGroup) {
    const joined = groups.find(group => group.id === selectedGroup.id)?.is_joined;
    return (
      <section className="page-section community-page">
        <button className="back-button" onClick={() => { setSelectedGroup(null); setGroupMessages([]); }}>← Back to Community</button>
        <div className="community-group-hero">
          <div className="group-icon hero">{GROUP_ICONS[selectedGroup.slug] || '◇'}</div>
          <div><div className="eyebrow">PUBLIC COMMUNITY</div><h1>{selectedGroup.name}</h1><p>{selectedGroup.description}</p><span className="group-meta">{Number(selectedGroup.member_count || 0).toLocaleString()} members · Public</span></div>
          <button className={joined ? 'secondary' : 'primary'} onClick={() => toggleGroup(selectedGroup)}>{joined ? 'Leave group' : 'Join group'}</button>
        </div>
        {error && <div className="community-error">{error}</div>}
        <div className="community-chat-layout">
          <div className="community-group-chat">
            <div className="group-chat-header"><div><strong>Group chat</strong><span>Keep it helpful, respectful and Favourit-safe.</span></div><span className="moderated-pill">Moderated</span></div>
            <div className="group-chat-messages">
              {groupMessages.length ? groupMessages.map(item => <div className="group-message" key={item.id}><Avatar person={item} /><div><div className="group-message-head"><strong>{item.display_name || item.username || 'Member'}</strong><span>@{item.username || 'member'}</span><time>{new Date(item.created_at).toLocaleString([], { hour: '2-digit', minute: '2-digit' })}</time></div><p>{item.body}</p></div></div>) : <div className="community-empty"><h2>No messages yet.</h2><p>Be the first person to start the conversation.</p></div>}
            </div>
            {joined && <form className="group-chat-composer" onSubmit={postToGroup}><input value={message} maxLength={2000} onChange={e => setMessage(e.target.value)} placeholder="Share something with the group…" /><button className="primary" disabled={!message.trim() || busy}>Send</button></form>}
          </div>
          <aside className="community-members"><div className="panel-heading"><h2>Members</h2><span>{groupMembers.length}</span></div>{groupMembers.slice(0, 12).map(member => <div className="member-row" key={member.user_id}><Avatar person={member} /><div><strong>@{member.username || 'member'}</strong><small>{member.display_name || 'Favourit member'}</small></div></div>)}{groupMembers.length > 12 && <small className="members-more">+ {groupMembers.length - 12} more members</small>}</aside>
        </div>
      </section>
    );
  }

  return (
    <section className="page-section community-page">
      <div className="page-title community-title"><div><div className="eyebrow">COMMUNITY</div><h1>People make <span>Favourit.</span></h1><p>Find people to work with, build trusted connections and join communities around your skills.</p></div><button className="secondary" onClick={() => setTab('friends')}>Your network · {graph.friends.length}</button></div>
      <div className="community-tabs" role="tablist">
        <button className={tab === 'discover' ? 'active' : ''} onClick={() => setTab('discover')}>Discover</button>
        <button className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')}>Friends <span>{graph.friends.length}</span></button>
        <button className={tab === 'groups' ? 'active' : ''} onClick={() => setTab('groups')}>Groups <span>{groups.length}</span></button>
        <button className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')}>Requests {graph.incoming.length > 0 && <span className="count-badge">{graph.incoming.length}</span>}</button>
      </div>
      {error && <div className="community-error">{error}</div>}

      {tab === 'discover' && <>
        <div className="community-search"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search people by @username, name or skill…" /></div>
        <div className="community-section-heading"><div><div className="eyebrow">NETWORK</div><h2>{search ? 'People matching your search' : 'People you may want to work with'}</h2></div><span>{discoverPeople.length} people</span></div>
        {discoverPeople.length ? <div className="people-grid">{discoverPeople.map(person => <PersonCard key={person.id || person.user_id} person={person} status={statusFor(person.id || person.user_id)} onConnect={value => action(async () => { if (value === 'accept' || value === 'reject') { const request = graph.incoming.find(item => item.user_id === (person.id || person.user_id)); if (request) await respondFriendRequest(request.id, value); } else await sendFriendRequest(person.id || person.user_id); })} onCancel={() => action(async () => { const request = graph.outgoing.find(item => item.user_id === (person.id || person.user_id)); if (request) await cancelFriendRequest(request.id); })} onBlock={() => action(() => blockUser(person.id || person.user_id))} />)}</div> : <div className="community-empty"><h2>{search ? 'No people found.' : 'Your network is ready to grow.'}</h2><p>Search for a username, name or skill to find someone to work with.</p></div>}
        <div className="community-section-heading group-heading"><div><div className="eyebrow">COMMUNITIES</div><h2>Groups you can join</h2></div><button className="text-button" onClick={() => setTab('groups')}>View all →</button></div>
        <div className="groups-grid">{groups.slice(0, 6).map(group => <GroupCard key={group.id} group={group} onOpen={openGroup} onToggle={toggleGroup} />)}</div>
      </>}

      {tab === 'friends' && <div className="community-panel-grid"><div className="community-panel wide"><div className="panel-heading"><div><div className="eyebrow">YOUR NETWORK</div><h2>Friends</h2></div><span>{graph.friends.length}</span></div>{graph.friends.length ? graph.friends.map(person => <PersonCard key={person.id} person={person} status="friends" onBlock={() => action(() => blockUser(person.id))} onMessage={() => onOpenMessages?.(person.username)} />) : <div className="community-empty"><h2>No friends yet.</h2><p>Discover people you may want to work with and send your first connection request.</p><button className="primary" onClick={() => setTab('discover')}>Discover people</button></div>}</div></div>}

      {tab === 'groups' && <><div className="community-section-heading"><div><div className="eyebrow">SKILL COMMUNITIES</div><h2>Find your people</h2></div><span>{groups.length} public groups</span></div><div className="groups-grid full">{groups.map(group => <GroupCard key={group.id} group={group} onOpen={openGroup} onToggle={toggleGroup} />)}</div></>}

      {tab === 'requests' && <div className="community-panel-grid"><div className="community-panel wide"><div className="panel-heading"><div><div className="eyebrow">CONNECTIONS</div><h2>Friend requests</h2></div><span>{graph.incoming.length}</span></div>{graph.incoming.length ? graph.incoming.map(request => <PersonCard key={request.id} person={request} status="incoming" onConnect={value => action(() => respondFriendRequest(request.id, value))} onBlock={() => action(() => blockUser(request.user_id))} />) : <div className="community-empty"><h2>No pending requests.</h2><p>When someone wants to connect with you, their request will appear here.</p></div>} {graph.outgoing.length > 0 && <div className="outgoing-requests"><h3>Sent requests</h3>{graph.outgoing.map(request => <div className="outgoing-row" key={request.id}><Avatar person={request} /><span>@{request.username || 'member'}</span><button className="secondary small" onClick={() => action(() => cancelFriendRequest(request.id))}>Cancel</button></div>)}</div>}</div></div>}
    </section>
  );
}
