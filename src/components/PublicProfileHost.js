import { useEffect, useRef, useState } from 'react';
import PublicProfile from './PublicProfile';

export default function PublicProfileHost({ session }) {
  const [target, setTarget] = useState(null);
  const lastTargetRef = useRef(null);
  const openLockRef = useRef(false);

  useEffect(() => {
    const open = event => {
      const nextUserId = event.detail?.userId || null;
      const nextUsername = event.detail?.username || null;
      if (!nextUserId && !nextUsername) return;
      const key = nextUserId ? `id:${nextUserId}` : `username:${String(nextUsername).toLowerCase()}`;
      if (openLockRef.current && lastTargetRef.current === key) return;
      lastTargetRef.current = key;
      openLockRef.current = true;
      setTarget({ userId: nextUserId, username: nextUsername });
    };
    window.addEventListener('favourit:open-profile', open);
    return () => window.removeEventListener('favourit:open-profile', open);
  }, []);

  const close = () => {
    openLockRef.current = false;
    lastTargetRef.current = null;
    setTarget(null);
  };

  const openMessage = name => {
    close();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('favourit:open-direct-message', { detail: { username: name } }));
    }, 0);
  };

  if (!target) return null;
  return <PublicProfile userId={target.userId} username={target.username} session={session} onClose={close} onMessage={openMessage} />;
}
