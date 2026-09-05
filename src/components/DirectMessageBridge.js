import { useEffect } from 'react';

function setReactInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function usernameFromConversation(node) {
  const handle = node?.querySelector('.dm-conversation-copy span')?.textContent?.trim() || node?.querySelector('.dm-conversation-copy small')?.textContent?.trim();
  return handle?.replace(/^@/, '').trim() || '';
}

function openProfile(username) {
  const handle = String(username || '').replace(/^@/, '').trim();
  if (!handle) return;
  window.dispatchEvent(new CustomEvent('favourit:open-profile', { detail: { username: handle } }));
}

export default function DirectMessageBridge() {
  useEffect(() => {
    const openMessage = event => {
      const username = String(event.detail?.username || '').replace(/^@/, '').trim();
      if (!username) return;
      document.querySelector('.dm-fab')?.click();
      window.setTimeout(() => {
        const input = document.querySelector('.dm-search input');
        if (!input) return;
        setReactInputValue(input, `@${username}`);
        window.setTimeout(() => {
          const target = [...document.querySelectorAll('.dm-results > button')].find(button => (button.textContent || '').toLowerCase().includes(`@${username.toLowerCase()}`));
          target?.click();
        }, 320);
      }, 80);
    };

    const profileClick = event => {
      const chattingWith = event.target.closest?.('.dm-chatting-with');
      if (chattingWith) {
        const handle = chattingWith.querySelector('small')?.textContent?.trim()?.replace(/^@/, '');
        if (handle) { event.preventDefault(); event.stopPropagation(); openProfile(handle); }
        return;
      }

      const avatar = event.target.closest?.('.dm-avatar');
      if (avatar) {
        const row = avatar.closest('.dm-conversation');
        const handle = usernameFromConversation(row);
        if (handle) { event.preventDefault(); event.stopPropagation(); openProfile(handle); }
      }
    };

    window.addEventListener('favourit:open-direct-message', openMessage);
    document.addEventListener('click', profileClick, true);
    return () => {
      window.removeEventListener('favourit:open-direct-message', openMessage);
      document.removeEventListener('click', profileClick, true);
    };
  }, []);
  return null;
}
