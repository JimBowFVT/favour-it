import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import UsernameGate from './UsernameGate';
import UsernameSection from './UsernameSection';
import './UsernameManager.css';

const USERNAME_ONBOARDING_KEY = 'favourit_username_onboarding_pending';
const USERNAME_GATE_KEY = 'favourit_username_onboarding_gate_pending';

function readPending() {
  try { return JSON.parse(localStorage.getItem(USERNAME_GATE_KEY) || 'null'); }
  catch (_) { return null; }
}

export default function UsernameManager({ status, onChanged }) {
  const [target, setTarget] = useState(null);
  const [pending, setPending] = useState(() => readPending());

  useEffect(() => {
    const syncTarget = () => {
      const next = document.querySelector('.profile-grid .profile-panel:first-child');
      setTarget(current => current === next ? current : next);
      if (next) next.classList.add('username-inline-host');
    };

    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.querySelectorAll('.username-inline-host').forEach(node => node.classList.remove('username-inline-host'));
    };
  }, []);

  useEffect(() => {
    const handleChanged = event => {
      const next = event.detail?.status;
      if (next?.username) onChanged?.(next);
    };
    window.addEventListener('favourit:username-changed', handleChanged);
    return () => window.removeEventListener('favourit:username-changed', handleChanged);
  }, [onChanged]);

  const pendingMatches = useMemo(() => {
    if (!pending) return false;
    const statusEmail = String(status?.email || '').toLowerCase();
    const pendingEmail = String(pending?.email || '').toLowerCase();
    return Boolean((pendingEmail && statusEmail && pendingEmail === statusEmail) || (pending.userId && status?.id && pending.userId === status.id) || (pendingEmail && !statusEmail));
  }, [pending, status?.email, status?.id]);

  if (pendingMatches) {
    return createPortal(<UsernameGate
      displayName={status?.display_name || ''}
      email={status?.email || pending?.email || ''}
      onComplete={profileData => {
        localStorage.removeItem(USERNAME_GATE_KEY);
        localStorage.removeItem(USERNAME_ONBOARDING_KEY);
        setPending(null);
        const next = { ...status, ...profileData, username_chosen: true };
        onChanged?.(next);
      }}
    />, document.body);
  }

  if (!target || !status?.username) return null;
  return createPortal(<UsernameSection status={status} />, target);
}
