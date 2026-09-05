import { useEffect, useState } from 'react';
import PublicProfile from './PublicProfile';

export default function PublicProfileHost({ session }) {
  const [userId, setUserId] = useState(null); const [username, setUsername] = useState(null);
  useEffect(() => {
    const open = event => { setUserId(event.detail?.userId || null); setUsername(event.detail?.username || null); };
    const openFromDirectChat = event => {
      const target = event.target?.closest?.('.dm-chatting-with');
      if (!target) return;
      const handle = target.querySelector('.dm-chatting-with small')?.textContent?.trim();
      if (handle?.startsWith('@')) { event.preventDefault(); event.stopPropagation(); window.dispatchEvent(new CustomEvent('favourit:open-profile', { detail: { username: handle.slice(1) } })); }
    };
    window.addEventListener('favourit:open-profile', open);
    document.addEventListener('click', openFromDirectChat, true);
    return () => { window.removeEventListener('favourit:open-profile', open); document.removeEventListener('click', openFromDirectChat, true); };
  }, []);
  const close = () => { setUserId(null); setUsername(null); };
  const openMessage = name => { close(); window.setTimeout(() => window.dispatchEvent(new CustomEvent('favourit:open-direct-message', { detail: { username: name } })), 0); };
  return <PublicProfile userId={userId} username={username} session={session} onClose={close} onMessage={openMessage} />;
}
