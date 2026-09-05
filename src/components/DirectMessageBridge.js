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

async function resolveUserId(username) {
  const users = await searchUsersByUsername(username);
  const exact = (Array.isArray(users) ? users : []).find(user => cleanUsername(user.username) === cleanUsername(username));
  return exact?.user_id || exact?.id || null;
}

function reopenAcceptedConversation(username) {
  document.querySelector('.dm-back')?.click();
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent('favourit:open-direct-message', { detail: { username } }));
  }, 220);
}

async function runRequestAction(action, username) {
  const clean = cleanUsername(username);
  if (!clean) throw new Error('Could not identify this request.');
  const conversationId = await getOrCreateDirectConversation(clean);

  if (action === 'accept') {
    await acceptDirectMessageRequest(conversationId);
    reopenAcceptedConversation(clean);
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

function showBridgeError(error) {
  const host = document.querySelector('.dm-panel');
  if (!host) return;
  host.querySelector('.dm-bridge-error')?.remove();
  const message = document.createElement('div');
  message.className = 'dm-error dm-bridge-error';
  message.textContent = error?.message || 'Could not update this request.';
  host.prepend(message);
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

    const bar = button.closest('.dm-request-actions');
    const buttons = [...(bar?.querySelectorAll('button') || [])];
    buttons.forEach(item => { item.disabled = true; });
    const original = button.textContent;
    button.textContent = action === 'accept' ? 'Accepting…' : action === 'decline' ? 'Declining…' : 'Blocking…';

    try {
      await runRequestAction(action, await getUsername());
    } catch (error) {
      showBridgeError(error);
      buttons.forEach(item => { item.disabled = false; });
      button.textContent = original;
    }
  });
  return button;
}

function actionBar(getUsername) {
  const bar = document.createElement('div');
  bar.className = 'dm-request-actions dm-request-actions-decision';
  bar.append(
    makeActionButton('Decline', 'decline', getUsername),
    makeActionButton('Accept', 'accept', getUsername),
    makeActionButton('Block', 'block', getUsername),
  );
  return bar;
}

function unlockComposer() {
  document.querySelectorAll('.dm-composer-shell.dm-request-locked').forEach(composer => {
    composer.classList.remove('dm-request-locked');
    composer.querySelector('.dm-request-decision-shell')?.remove();
  });
}

function lockRequestComposer() {
  const banner = document.querySelector('.dm-request-banner');
  const composer = document.querySelector('.dm-panel.is-thread .dm-composer-shell');

  if (!banner || !composer) {
    unlockComposer();
    return;
  }

  if (composer.classList.contains('dm-request-locked')) return;
  composer.classList.add('dm-request-locked');

  const shell = document.createElement('div');
  shell.className = 'dm-request-decision-shell';
  const copy = document.createElement('div');
  copy.className = 'dm-request-decision-copy';
  const strong = document.createElement('strong');
  strong.textContent = 'Message request';
  const small = document.createElement('small');
  small.textContent = 'Preview the message above. Accept before replying, decline to keep it in Requests, or block this account.';
  copy.append(strong, small);
  shell.append(copy, actionBar(async () => threadUsername()));
  composer.append(shell);
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
          const target = [...document.querySelectorAll('.dm-search-results > button, .dm-results > button')]
            .find(button => (button.textContent || '').toLowerCase().includes(`@${username}`));
          target?.click();
        }, 320);
      }, 80);
    };

    const syncRequestUi = () => lockRequestComposer();

    window.addEventListener('favourit:open-direct-message', openMessage);
    const observer = new MutationObserver(syncRequestUi);
    observer.observe(document.body, { childList: true, subtree: true });
    syncRequestUi();

    return () => {
      window.removeEventListener('favourit:open-direct-message', openMessage);
      observer.disconnect();
      unlockComposer();
    };
  }, []);

  return null;
}
