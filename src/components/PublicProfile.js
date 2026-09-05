import { useEffect, useRef, useState } from 'react';
import { blockUser, respondFriendRequest, sendFriendRequest, unblockUser } from '../lib/social';
import { getPublicProfile, getPublicProfileByUsername, reportUser } from '../lib/publicProfile';
import './PublicProfile.css';

const GROUP_ICONS = { designers: '✦', developers: '⌘', 'video-editors': '▣', musicians: '♫', marketers: '↗', photographers: '◉', writers: '✎', entrepreneurs: '◇' };
const initials = name => String(name || 'Favourit member').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase() || 'FV';
function Avatar({ person, large = false }) { return person?.avatar_url ? <img className={`public-profile-avatar ${large ? 'large' : ''}`} src={person.avatar_url} alt="" /> : <div className={`public-profile-avatar ${large ? 'large' : ''}`}>{initials(person?.display_name || person?.username)}</div>; }

export default function PublicProfile({ userId, username, session, onClose, onMessage }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const requestIdRef = useRef(0);

  const load = async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');
    setMenuOpen(false);
    try {
      const next = userId ? await getPublicProfile(userId) : await getPublicProfileByUsername(username);
      if (requestId !== requestIdRef.current) return;
      if (!next) throw new Error('User not found.');
      setProfile(next);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err.message || 'Could not load this profile.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (userId || username) load();
    else { requestIdRef.current += 1; setProfile(null); setLoading(false); }
    return () => { requestIdRef.current += 1; };
  }, [userId, username]);

  const action = async fn => {
    setBusy(true);
    setError('');
    try { await fn(); await load(); setMenuOpen(false); }
    catch (err) { setError(err.message || 'Could not update this profile.'); }
    finally { setBusy(false); }
  };

  if (!userId && !username) return null;
  const stats = profile?.stats || {};
  const isSelf = profile?.id === session?.user?.id;
  const friendStatus = profile?.friend_status;
  const blocked = Boolean(profile?.blocked_by_me || profile?.blocked_me);
  const joinedGroups = Array.isArray(profile?.groups) ? profile.groups : [];

  const report = async () => {
    const reason = window.prompt('Why are you reporting this account?');
    if (!reason?.trim()) return;
    const details = window.prompt('Optional details:') || '';
    setBusy(true); setError('');
    try { await reportUser(profile.id, reason.trim(), details.trim()); window.alert('Report submitted. A moderator will review it.'); setMenuOpen(false); }
    catch (err) { setError(err.message || 'Could not submit report.'); }
    finally { setBusy(false); }
  };

  const renderConnectionActions = () => {
    if (isSelf) return null;
    let connectionAction = null;
    if (friendStatus === 'friends') connectionAction = <span className="connection-state">Friends ✓</span>;
    else if (friendStatus === 'incoming') connectionAction = <><button className="primary" disabled={busy || blocked} onClick={() => action(() => respondFriendRequest(profile.id, 'accept'))}>Accept</button><button className="secondary" disabled={busy || blocked} onClick={() => action(() => respondFriendRequest(profile.id, 'reject'))}>Decline</button></>;
    else if (friendStatus === 'outgoing') connectionAction = <button className="secondary" disabled>Request sent</button>;
    else if (!blocked) connectionAction = <button className="primary" disabled={busy} onClick={() => action(() => sendFriendRequest(profile.id))}>Connect</button>;
    return <>{connectionAction}{!blocked && <button className="secondary" disabled={busy} onClick={() => onMessage?.(profile.username)}>Message</button>}<div className="public-profile-menu-wrap"><button className="profile-more" onClick={() => setMenuOpen(value => !value)} aria-label="More actions">•••</button>{menuOpen && <div className="public-profile-menu">{profile.blocked_by_me ? <button disabled={busy} onClick={() => action(() => unblockUser(profile.id))}>Unblock</button> : <button className="danger" disabled={busy} onClick={() => { if (window.confirm(`Block @${profile.username}? Your existing conversation will be kept.`)) action(() => blockUser(profile.id)); }}>Block</button>}<button disabled={busy} onClick={report}>Report</button></div>}</div></>;
  };

  return <div className="public-profile-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose?.(); }}>
    <section className="public-profile-card" role="dialog" aria-modal="true" aria-labelledby="public-profile-title">
      <button className="public-profile-close" onClick={onClose} aria-label="Close profile">×</button>
      {loading ? <div className="public-profile-loading"><div className="public-profile-spinner" /><span>Loading profile…</span></div> : error ? <div className="public-profile-empty"><h2>Profile unavailable</h2><p>{error}</p><button className="secondary" onClick={load}>Try again</button></div> : <>
        <header className="public-profile-header"><div className="public-profile-identity"><Avatar person={profile} large /><div><div className="eyebrow">FAVOURIT MEMBER</div><h1 id="public-profile-title">{profile.display_name || profile.username}</h1><div className="public-profile-handle">@{profile.username} {profile.is_verified && <span className="verified-badge">✓ Verified</span>}</div><p>{profile.bio || 'This member has not added a bio yet.'}</p><small>Member since {new Date(profile.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</small></div></div><div className="public-profile-header-actions">{renderConnectionActions()}</div></header>
        {profile.blocked_by_me && <div className="public-profile-notice">You blocked this member. Your existing conversation and messages are still kept. Unblock them from the ••• menu to reconnect.</div>}
        {profile.blocked_me && <div className="public-profile-notice">This member has blocked you. Some interactions are unavailable.</div>}
        <div className="public-profile-stats"><div><strong>{Number(stats.rating || 0).toFixed(1)}</strong><span>Rating · {stats.review_count || 0} reviews</span></div><div><strong>{stats.completed_deals || 0}</strong><span>Completed deals</span></div><div><strong>{stats.published_deals || 0}</strong><span>Services available</span></div></div>
        <section className="public-profile-section"><div className="public-profile-section-heading"><div><div className="eyebrow">SERVICES</div><h2>What {String(profile.display_name || profile.username).split(' ')[0]} offers</h2></div><span>{profile.deals?.length || 0}</span></div>{profile.deals?.length ? <div className="public-profile-deals">{profile.deals.map(deal => <article className="public-deal-card" key={deal.id}><span className="public-deal-category">{deal.category}</span><h3>{deal.title}</h3><p>{deal.description}</p><footer><strong>{Number(deal.price_fav || 0).toLocaleString()} FAV</strong><span>{deal.delivery_days} day{deal.delivery_days === 1 ? '' : 's'}</span></footer></article>)}</div> : <div className="public-profile-muted">No public services yet.</div>}</section>
        <div className="public-profile-two-column"><section className="public-profile-section"><div className="eyebrow">REVIEWS</div><h2>Client feedback</h2>{profile.reviews?.length ? <div className="public-review-list">{profile.reviews.map(review => <article className="public-review" key={review.id}><Avatar person={review.reviewer} /><div><div className="public-review-top"><strong>{review.reviewer?.display_name || review.reviewer?.username}</strong><span>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span></div><p>{review.body || 'No written feedback.'}</p><small>{new Date(review.created_at).toLocaleDateString()}</small></div></article>)}</div> : <div className="public-profile-muted">No reviews yet.</div>}</section><section className="public-profile-section"><div className="eyebrow">COMMUNITY</div><h2>Skill communities</h2>{joinedGroups.length ? <div className="public-profile-groups">{joinedGroups.map(group => <div className="public-profile-group" key={group.id}><span>{GROUP_ICONS[group.slug] || '◇'}</span><div><strong>{group.name}</strong><small>{group.description}</small></div></div>)}</div> : <div className="public-profile-muted">Not a member of any public skill community yet.</div>}</section></div>
      </>}
    </section>
  </div>;
}
