import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import UsernameSection from './UsernameSection';
import './UsernameManager.css';

export default function UsernameManager({ status, onChanged }) {
  const [target, setTarget] = useState(null);

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

  if (!target || !status?.username) return null;
  return createPortal(<UsernameSection status={status} />, target);
}
