import { useEffect } from 'react';
import {
  acceptDirectMessageRequest,
  declineDirectMessageRequest,
  getOrCreateDirectConversation,
  searchUsersByUsername,
} from '../lib/directMessaging';
import { blockUser } from '../lib/social';
import './MessageRequestListBridge.css';

const delay = ms => new Promise(resolve => window.setTimeout(resolve, ms));

function cleanUsername(value) {
  return String(value || '').replace(/^@/, '').trim().toLowerCase();
}

function currentThreadUsername() {
  return cleanUsername(document.querySelector('.dm-panel.is-thread .dm-thread-identity small')?.textContent);
}

async function waitForRequestThreadUsername() {
  const deadline = Date.now() + 1600;
  while (Date.now() < deadline) {
    const username = currentThreadUsername();
    if (username && document.querySelector('.dm-panel.is-thread .dm-request-banner')) return username;
    await delay(40);
  }
  throw new Error('Could not identify this message request.');
}

async function resolveUserId(username) {
  const users = await searchUsersByUsername(username);
  const exact = (Array.isArray(users) ? users : []).find(user => cleanUsername(user?.username) === cleanUsername(username));
  return exact?.user_id || exact?.id || null;
}

async function actOnRequest(action, row) {
  if (!row || !document.body.contains(row)) throw new Error('This request is no longer available.');
  row.click();
  const username = await waitForRequestThreadUsername();
  const conversationId = await getOrCreateDirectConversation(username);

  if (action === 'accept') {
    await acceptDirectMessageRequest(conversationId);
    document.querySelector('.dm-back')?.click();
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('favourit:open-direct-message', { detail: { username } })), 180);
    return;
  }

  if (action === 'decline') {
    await declineDirectMessageRequest(conversationId);
    document.querySelector('.dm-back')?.click();
    return;
  }

  const userId = await resolveUserId(username);
  if (!userId) throw new Error('Could not find this account.');
  await blockUser(userId);
  document.querySelector('.dm-back')?.click();
}

function showError(error) {
  const panel = document.querySelector('.dm-panel');
  if (!panel) return;
  panel.querySelector('.dm-request-list-error')?.remove();
  const notice = document.createElement('div');
  notice.className = 'dm-error dm-request-list-error';
  notice.textContent = error?.message || 'Could not update this message request.';
  panel.prepend(notice);
}

function makeButton(label, action, row) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `dm-request-list-action dm-request-list-action-${action}`;
  button.textContent = label;
  button.addEventListener('click', async event => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) return;
    const group = button.closest('.dm-request-row-actions');
    const buttons = [...(group?.querySelectorAll('button') || [])];
    buttons.forEach(item => { item.disabled = true; });
    const original = button.textContent;
    button.textContent = action === 'accept' ? 'Accepting…' : action === 'decline' ? 'Declining…' : 'Blocking…';
    try {
      await actOnRequest(action, row);
    } catch (error) {
      showError(error);
      buttons.forEach(item => { item.disabled = false; });
      button.textContent = original;
    }
  });
  return button;
}

function syncRequestRows() {
  const list = document.querySelector('.dm-panel.is-inbox .dm-request-list');
  if (!list) return;

  [...list.children].forEach(node => {
    if (!(node instanceof HTMLElement) || !node.classList.contains('dm-list-row')) return;
    const next = node.nextElementSibling;
    if (next?.classList.contains('dm-request-row-actions')) return;
    const actions = document.createElement('div');
    actions.className = 'dm-request-row-actions';
    actions.append(
      makeButton('Accept', 'accept', node),
      makeButton('Decline', 'decline', node),
      makeButton('Block', 'block', node),
    );
    node.insertAdjacentElement('afterend', actions);
  });
}

function syncDecisionCopy() {
  const copy = document.querySelector('.dm-request-decision-copy small');
  if (!copy) return;
  copy.textContent = 'Preview the message above. Accept to move it to Chats, decline to dismiss it, or block this account.';
}

export default function MessageRequestListBridge() {
  useEffect(() => {
    const sync = () => {
      syncRequestRows();
      syncDecisionCopy();
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    sync();
    return () => {
      observer.disconnect();
      document.querySelectorAll('.dm-request-row-actions').forEach(node => node.remove());
    };
  }, []);

  return null;
}
