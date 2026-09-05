import { useEffect } from 'react';
import { acceptDirectMessageRequest, declineDirectMessageRequest, getOrCreateDirectConversation, searchUsersByUsername } from '../lib/directMessaging';
import { blockUser } from '../lib/social';

function setReactInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function cleanUsername(value) {
  return String(value || '').replace(/^@/, '').trim().toLowerCase();
}

function threadUsername() {
  return cleanUsername(document.querySelector('.dm-thread-header .dm-thread-identity small')?.textContent);
}

function waitForThreadUsername(timeout = 1800) {
  return new Promise(resolve => {
    const started = Date.now();
    const check = () => {
      const username = threadUsername();
      if (username) return resolve(username);
      if (Date.now() - started >= timeout) return resolve('');
      window.setTimeout(check, 40);
    };
    check();
  });
}

async function resolveUserId(username) {
  const users = await searchUsersByUsername(username);
  const exact = (Array.isArray(users) ? users : []).find(user => cleanUsername(user.username) === cleanUsername(username));
  return exact?.user_id || exact?.id || null;
}

async function runRequestAction(action, username) {
  const clean = cleanUsername(username);
  if (!clean) throw new Error('Could not identify this request.');
  const conversationId = await getOrCreateDirectConversation(clean);
  if (action === 'accept') {
    await acceptDirectMessageRequest(conversationId);
    window.dispatchEvent(new CustomEvent('favourit:open-direct-message', { detail: { username: clean } }));
    return;
  }
  if (action === 'decline') {
    await declineDirectMessageRequest(conversationId);
    document.querySelector('.dm-back')?.click();
    return;
  }
  if (action === 'block') {
    const userId = await resolveUserId(clean);
    if (!userId) throw new Error('Could not find this account.');
    await blockUser(userId);
    document.querySelector('.dm-back')?.click();
  }
}

function makeActionButton(label, action, getUsername) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `dm-request-action dm-request-action-${action}`;
  button.textContent = label;
  button.addEventListener('click', async event => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) return;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = action === 'accept' ? 'Accepting…' : action === 'decline' ? 'Declining…' : 'Blocking…';
    try {
      const username = await getUsername();
      await runRequestAction(action, username);
    } catch (error) {
      const host = document.querySelector('.dm-panel');
      if (host) {
        const existing = host.querySelector('.dm-bridge-error');
        existing?.remove();
        const message = document.createElement('div');
        message.className = 'dm-error dm-bridge-error';
        message.textContent = error?.message || 'Could not update this request.';
        host.prepend(message);
      }
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
  return button;
}

function actionBar(getUsername, compact = false) {
  const bar = document.createElement('div');
  bar.className = `dm-request-actions${compact ? ' compact' : ''}`;
  bar.append(
    makeActionButton('Accept', 'accept', getUsername),
    makeActionButton('Decline', 'decline', getUsername),
    makeActionButton('Block', 'block', getUsername),
  );
  return bar;
}

export default function DirectMessageBridge() {
  useEffect(() => {
    const openMessage = event => {
      const username = cleanUsername(event.detail?.username);
      if (!username) return;
      document.querySelector('.dm-fab')?.click();
      window.setTimeout(() => {
        const input = document.querySelector('.dm-search input');
        if (!input) return;
        setReactInputValue(input, `@${username}`);
        window.setTimeout(() => {
          const target = [...document.querySelectorAll('.dm-search-results > button, .dm-results > button')].find(button => (button.textContent || '').toLowerCase().includes(`@${username}`));
          target?.click();
        }, 320);
      }, 80);
    };

    const enhanceRequests = () => {
      const requestList = document.querySelector('.dm-request-list');
      if (requestList) {
        [...requestList.querySelectorAll('.dm-list-row')].forEach(row => {
          if (row.dataset.requestActionsAdded === '1') return;
          row.dataset.requestActionsAdded = '1';
          const holder = document.createElement('div');
          holder.className = 'dm-request-row-actions';
          holder.append(actionBar(async () => {
            row.click();
            return waitForThreadUsername();
          }, true));
          row.insertAdjacentElement('afterend', holder);
        });
      }

      const banner = document.querySelector('.dm-request-banner');
      if (banner && banner.dataset.requestActionsAdded !== '1') {
        banner.dataset.requestActionsAdded = '1';
        banner.append(actionBar(async () => threadUsername()));
      }
    };

    window.addEventListener('favourit:open-direct-message', openMessage);
    const observer = new MutationObserver(enhanceRequests);
    observer.observe(document.body, { childList: true, subtree: true });
    enhanceRequests();
    return () => {
      window.removeEventListener('favourit:open-direct-message', openMessage);
      observer.disconnect();
    };
  }, []);

  return null;
}
