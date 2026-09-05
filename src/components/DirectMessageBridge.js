import { useEffect } from 'react';

function setReactInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
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

    window.addEventListener('favourit:open-direct-message', openMessage);
    return () => window.removeEventListener('favourit:open-direct-message', openMessage);
  }, []);

  return null;
}
