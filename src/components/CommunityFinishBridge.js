import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getMyUsernameStatus } from '../lib/usernames';
import './CommunityFinishBridge.css';

const COMMUNITY_RULES = [
  'Keep conversations useful and relevant to the community skill.',
  'No spam, scams, harassment, hate, threats or repeated unwanted promotion.',
  'Do not share private information or someone else’s work without permission.',
  'Use Reports for unsafe content; moderators can remove members or messages when needed.',
];

function ensureAnchor(parent, className, afterNode = null) {
  if (!parent) return null;
  let anchor = parent.querySelector(`:scope > .${className}`);
  if (anchor) return anchor;
  anchor = document.createElement('div');
  anchor.className = className;
  if (afterNode?.parentNode === parent) afterNode.insertAdjacentElement('afterend', anchor);
  else parent.append(anchor);
  return anchor;
}

function cleanUsername(value) {
  return String(value || '').replace(/^@/, '').trim().toLowerCase();
}

export default function CommunityFinishBridge() {
  const [rulesHost, setRulesHost] = useState(null);
  const [membersHost, setMembersHost] = useState(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberCount, setMemberCount] = useState(0);
  const [moderatorTools, setModeratorTools] = useState(false);
  const [myUsername, setMyUsername] = useState('');

  useEffect(() => {
    let active = true;
    getMyUsernameStatus()
      .then(status => { if (active) setMyUsername(cleanUsername(status?.username)); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const sync = () => {
      const groupHero = document.querySelector('.community-group-hero');
      const panel = document.querySelector('.community-chat-layout .community-panel');
      const members = document.querySelector('.community-chat-layout .community-members');
      if (!groupHero || !panel || !members) {
        setRulesHost(null);
        setMembersHost(null);
        setMemberSearch('');
        return;
      }

      const rulesAnchor = ensureAnchor(panel, 'community-finish-rules-anchor');
      const heading = members.querySelector(':scope > .panel-heading');
      const memberAnchor = ensureAnchor(members, 'community-finish-members-anchor', heading);
      setRulesHost(rulesAnchor);
      setMembersHost(memberAnchor);
      setModeratorTools(Boolean(members.querySelector('.member-remove')));
      setMemberCount(members.querySelectorAll('.member-row-wrap').length);

      if (myUsername) {
        members.querySelectorAll('.member-row-wrap').forEach(row => {
          const handle = cleanUsername(row.querySelector('.member-row strong')?.textContent);
          const removeButton = row.querySelector('.member-remove');
          if (removeButton) removeButton.classList.toggle('community-self-remove-hidden', handle === myUsername);
        });
      }
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    sync();
    return () => {
      observer.disconnect();
      document.querySelectorAll('.community-finish-rules-anchor,.community-finish-members-anchor').forEach(node => node.remove());
      document.querySelectorAll('.community-self-remove-hidden').forEach(node => node.classList.remove('community-self-remove-hidden'));
    };
  }, [myUsername]);

  useEffect(() => {
    if (!membersHost) return undefined;
    const term = memberSearch.trim().toLowerCase();
    const members = membersHost.parentElement;
    members?.querySelectorAll('.member-row-wrap').forEach(row => {
      const match = !term || String(row.textContent || '').toLowerCase().includes(term);
      row.classList.toggle('community-member-filtered-out', !match);
    });
    return () => members?.querySelectorAll('.member-row-wrap').forEach(row => row.classList.remove('community-member-filtered-out'));
  }, [membersHost, memberSearch]);

  const rulesPortal = rulesHost ? createPortal(<section className="community-finish-rules">
    <div className="community-finish-rules-heading"><div><div className="eyebrow">COMMUNITY STANDARDS</div><h3>Keep the group useful and safe.</h3></div><span>Public</span></div>
    <div className="community-finish-rule-grid">{COMMUNITY_RULES.map((rule, index) => <div key={rule}><b>{index + 1}</b><span>{rule}</span></div>)}</div>
  </section>, rulesHost) : null;

  const membersPortal = membersHost ? createPortal(<div className="community-finish-member-tools">
    <label><span>⌕</span><input value={memberSearch} onChange={event => setMemberSearch(event.target.value)} placeholder={`Search ${memberCount || ''} members…`} /></label>
    {moderatorTools && <small>Moderator tools enabled · member removal is protected by server-side moderator rules.</small>}
  </div>, membersHost) : null;

  return <>{rulesPortal}{membersPortal}</>;
}
