import { useEffect, useState } from 'react';
import PublicProfile from './PublicProfile';

export default function PublicProfileHost({ session }) {
  const [userId, setUserId] = useState(null);
  const [username, setUsername] = useState(null);

  useEffect(() => {
    const open = event => {
      setUserId(event.detail?.userId || null);
      setUsername(event.detail?.username || null);
    };
    window.addEventListener('favourit:open-profile', open);
    return () => window.removeEventListener('favourit:open-profile', open);
  }, []);

  const close = () => {
    setUserId(null);
    setUsername(null);
  };

  const openMessage = name => {
    close();
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('favourit:open-direct-message', { detail: { username: name } })), 0);
  };

  return <PublicProfile userId={userId} username={username} session={session} onClose={close} onMessage={openMessage} />;
}
