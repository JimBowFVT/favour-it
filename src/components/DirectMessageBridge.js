import { useEffect } from 'react';
import {
  acceptDirectMessageRequest,
  declineDirectMessageRequest,
  getDirectMessages,
  getOrCreateDirectConversation,
  searchUsersByUsername,
} from '../lib/directMessaging';
import { blockUser, getCommunityGroupMessages, listCommunityGroups } from '../lib/social';
import './DirectMessageBridge.css';

const MUTE_KEY = 'favourit:muted-conversations';

function readMuteState() {
  try { return JSON.parse(localStorage.getItem(MUTE_KEY) || '{}') || {}; }
  catch (_) { return {}; }
}
function writeMuteState(next) {
  try { localStorage.setItem(MUTE_KEY, JSON.stringify(next)); } catch (_) {}
  window.dispatchEvent(new CustomEvent('favourit:mute-state-changed', { detail: next }));
}
function isMuted(id) {
  const until = Number(readMuteState()[id] || 0);
  return until === -1 || until > Date.now();
}
function setMuted(id, durationMs) {
  const state = readMuteState();
  if (!durationMs) delete state[id];
  else state[id] = durationMs === -1 ? -1 : Date.now() + durationMs;
  writeMuteState(state);
}

function setReactInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function cleanUsername(value) { return String(value || '').replace(/^@/, '').trim().toLowerCase(); }
function threadUsername() { return cleanUsername(document.querySelector('.dm-thread-header .dm-thread-identity small')?.textContent); }
function threadName() { return String(document.querySelector('.dm-thread-header .dm-thread-identity strong')?.textContent || '').trim(); }
function isCommunityThread() { return String(document.querySelector('.dm-thread-header .dm-thread-identity small')?.textContent || '').trim().toLowerCase() === 'community chat'; }

async function resolveUserId(username) {
  const users = await searchUsersByUsername(username);
  const exact = (Array.isArray(users) ? users : []).find(user => cleanUsername(user.username) === cleanUsername(username));
  return exact?.user_id || exact?.id || null;
}
function reopenAcceptedConversation(username) {
  document.querySelector('.dm-back')?.click();
  window.setTimeout(() => window.dispatchEvent(new CustomEvent('favourit:open-direct-message', { detail: { username } })), 220);
}
async function runRequestAction(action, username) {
  const clean = cleanUsername(username);
  if (!clean) throw new Error('Could not identify this request.');
  const conversationId = await getOrCreateDirectConversation(clean);
  if (action === 'accept') { await acceptDirectMessageRequest(conversationId); reopenAcceptedConversation(clean); return; }
  if (action === 'decline') { await declineDirectMessageRequest(conversationId); document.querySelector('.dm-back')?.click(); return; }
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
  button.type = 'button'; button.className = `dm-request-action dm-request-action-${action}`; button.textContent = label;
  button.addEventListener('click', async event => {
    event.preventDefault(); event.stopPropagation(); if (button.disabled) return;
    const bar = button.closest('.dm-request-actions'); const buttons = [...(bar?.querySelectorAll('button') || [])];
    buttons.forEach(item => { item.disabled = true; });
    const original = button.textContent; button.textContent = action === 'accept' ? 'Accepting…' : action === 'decline' ? 'Declining…' : 'Blocking…';
    try { await runRequestAction(action, await getUsername()); }
    catch (error) { showBridgeError(error); buttons.forEach(item => { item.disabled = false; }); button.textContent = original; }
  });
  return button;
}
function actionBar(getUsername) {
  const bar = document.createElement('div'); bar.className = 'dm-request-actions dm-request-actions-decision';
  bar.append(makeActionButton('Decline', 'decline', getUsername), makeActionButton('Accept', 'accept', getUsername), makeActionButton('Block', 'block', getUsername)); return bar;
}
function unlockComposer() {
  document.querySelectorAll('.dm-composer-shell.dm-request-locked').forEach(composer => { composer.classList.remove('dm-request-locked'); composer.querySelector('.dm-request-decision-shell')?.remove(); });
}
function lockRequestComposer() {
  const banner = document.querySelector('.dm-request-banner'); const composer = document.querySelector('.dm-panel.is-thread .dm-composer-shell');
  if (!banner || !composer) { unlockComposer(); return; }
  if (composer.classList.contains('dm-request-locked')) return;
  composer.classList.add('dm-request-locked');
  const shell = document.createElement('div'); shell.className = 'dm-request-decision-shell';
  const copy = document.createElement('div'); copy.className = 'dm-request-decision-copy';
  const strong = document.createElement('strong'); strong.textContent = 'Message request';
  const small = document.createElement('small'); small.textContent = 'Preview the message above. Accept before replying, decline to keep it in Requests, or block this account.';
  copy.append(strong, small); shell.append(copy, actionBar(async () => threadUsername())); composer.append(shell);
}
function closeFinishModal() { document.querySelectorAll('.dm-finish-backdrop').forEach(node => node.remove()); }
function makeEl(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
function formatWhen(value) { if (!value) return ''; try { return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } }

async function getThreadContext() {
  if (isCommunityThread()) {
    const name = threadName(); const groups = await listCommunityGroups();
    const group = (Array.isArray(groups) ? groups : []).find(item => String(item?.name || '').trim().toLowerCase() === name.toLowerCase());
    if (!group?.id) throw new Error('Could not identify this community conversation.');
    return { type: 'community', id: group.id, label: group.name, group };
  }
  const username = threadUsername(); if (!username) throw new Error('Could not identify this conversation.');
  const id = await getOrCreateDirectConversation(username); return { type: 'direct', id, label: `@${username}`, username };
}
async function getThreadMessages(context) { const messages = context.type === 'community' ? await getCommunityGroupMessages(context.id) : await getDirectMessages(context.id); return Array.isArray(messages) ? messages : []; }
function createModal(title, subtitle = '') {
  closeFinishModal();
  const backdrop = makeEl('div', 'dm-finish-backdrop'); const modal = makeEl('section', 'dm-finish-modal');
  const header = makeEl('header', 'dm-finish-modal-header'); const copy = makeEl('div'); copy.append(makeEl('div', 'eyebrow', 'MESSAGES'), makeEl('h3', '', title)); if (subtitle) copy.append(makeEl('p', '', subtitle));
  const close = makeEl('button', 'dm-finish-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.addEventListener('click', closeFinishModal); header.append(copy, close);
  const body = makeEl('div', 'dm-finish-modal-body'); modal.append(header, body); backdrop.append(modal); backdrop.addEventListener('mousedown', event => { if (event.target === backdrop) closeFinishModal(); });
  document.querySelector('.dm-panel')?.append(backdrop); return { backdrop, modal, body };
}
function messageHaystack(message) {
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  return [message?.body, message?.username, message?.display_name, message?.reply_to_body, message?.deal?.title, message?.deal?.seller_name, ...attachments.map(item => item?.file_name)].filter(Boolean).join(' ').toLowerCase();
}
function focusRenderedMessage(message) {
  const rows = [...document.querySelectorAll('.dm-messages .dm-message-row')];
  let row = rows.find(item => item.dataset.messageId === String(message?.id || ''));
  if (!row) {
    const body = String(message?.body || '').trim();
    row = body ? rows.find(item => String(item.querySelector('.dm-message-line p')?.textContent || '').trim() === body) : null;
  }
  if (!row) return false;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' }); row.classList.remove('dm-search-hit');
  window.requestAnimationFrame(() => row.classList.add('dm-search-hit')); window.setTimeout(() => row.classList.remove('dm-search-hit'), 1800); return true;
}
async function openConversationSearch() {
  const { body } = createModal('Search conversation', 'Search message text, people, shared deals and media filenames.'); body.append(makeEl('div', 'dm-finish-loading', 'Loading conversation…'));
  try {
    const context = await getThreadContext(); const messages = await getThreadMessages(context); body.replaceChildren();
    const search = makeEl('input', 'dm-finish-search'); search.type = 'search'; search.placeholder = `Search ${context.label}…`; search.autocomplete = 'off';
    const meta = makeEl('div', 'dm-finish-result-meta'); const results = makeEl('div', 'dm-finish-results'); body.append(search, meta, results);
    const render = () => {
      const term = search.value.trim().toLowerCase(); const matches = term ? messages.filter(item => !item?.is_deleted && messageHaystack(item).includes(term)) : [];
      meta.textContent = term ? `${matches.length} result${matches.length === 1 ? '' : 's'}` : `${messages.length} messages available to search`; results.replaceChildren();
      if (!term) { const hint = makeEl('div', 'dm-finish-empty'); hint.append(makeEl('strong', '', 'Type to search this conversation'), makeEl('small', '', 'Tip: Ctrl/Cmd + F opens this search while a chat is open.')); results.append(hint); return; }
      if (!matches.length) { results.append(makeEl('div', 'dm-finish-empty', 'No matching messages.')); return; }
      matches.slice(-100).reverse().forEach(message => {
        const row = makeEl('button', 'dm-finish-result'); row.type = 'button'; const top = makeEl('span', 'dm-finish-result-top');
        top.append(makeEl('strong', '', message.username ? `@${message.username}` : 'Message'), makeEl('time', '', formatWhen(message.created_at)));
        const snippet = message.body || message.deal?.title || (message.attachments?.length ? `${message.attachments.length} media item${message.attachments.length === 1 ? '' : 's'}` : 'Message');
        row.append(top, makeEl('small', '', String(snippet).slice(0, 220))); row.addEventListener('click', () => { closeFinishModal(); window.setTimeout(() => focusRenderedMessage(message), 50); }); results.append(row);
      });
    };
    search.addEventListener('input', render); render(); window.setTimeout(() => search.focus(), 30);
  } catch (error) { body.replaceChildren(makeEl('div', 'dm-finish-error', error?.message || 'Could not search this conversation.')); }
}
function renderInfoSection(parent, title, items, renderItem, emptyText) {
  const section = makeEl('section', 'dm-finish-info-section'); const heading = makeEl('div', 'dm-finish-info-heading'); heading.append(makeEl('h4', '', title), makeEl('span', '', String(items.length))); section.append(heading);
  if (!items.length) section.append(makeEl('div', 'dm-finish-empty small', emptyText)); else items.slice(0, 40).forEach(item => section.append(renderItem(item))); parent.append(section);
}
async function openConversationInfo() {
  const { body } = createModal('Conversation details', 'Search, shared items, safety and notification controls.'); body.append(makeEl('div', 'dm-finish-loading', 'Loading details…'));
  try {
    const context = await getThreadContext(); const messages = await getThreadMessages(context); const active = messages.filter(item => !item?.is_deleted);
    const starred = active.filter(item => item?.is_starred); const media = active.flatMap(message => (Array.isArray(message?.attachments) ? message.attachments : []).map(asset => ({ asset, message })));
    const deals = active.filter(message => message?.deal).map(message => ({ deal: message.deal, message })); body.replaceChildren();
    const summary = makeEl('div', 'dm-finish-summary'); [['Messages', active.length], ['Starred', starred.length], ['Media', media.length], ['Deals', deals.length]].forEach(([label, value]) => { const card = makeEl('div'); card.append(makeEl('strong', '', String(value)), makeEl('small', '', label)); summary.append(card); }); body.append(summary);
    const controls = makeEl('section', 'dm-finish-info-section'); const heading = makeEl('div', 'dm-finish-info-heading'); heading.append(makeEl('h4', '', 'Notifications'), makeEl('span', '', isMuted(context.id) ? 'Muted' : 'On')); controls.append(heading);
    const muteRow = makeEl('div', 'dm-finish-mute-row');
    const presets = [['1 hour', 3600000], ['8 hours', 28800000], ['Until I turn it on', -1], ['Unmute', 0]];
    presets.forEach(([label, duration]) => { const button = makeEl('button', 'dm-finish-chip', label); button.type='button'; button.addEventListener('click', () => { setMuted(context.id, duration); closeFinishModal(); window.setTimeout(openConversationInfo, 40); }); muteRow.append(button); });
    controls.append(muteRow); body.append(controls);
    if (context.type === 'direct') {
      const profile = makeEl('button', 'dm-finish-profile-button', `Open ${context.label} profile →`); profile.type = 'button'; profile.addEventListener('click', () => { closeFinishModal(); window.dispatchEvent(new CustomEvent('favourit:open-profile', { detail: { username: context.username } })); }); body.append(profile);
      const block = makeEl('button', 'dm-finish-danger-button', `Block ${context.label}`); block.type='button'; block.addEventListener('click', async () => { if (!window.confirm(`Block ${context.label}?`)) return; try { const userId = await resolveUserId(context.username); if (!userId) throw new Error('Could not identify this account.'); await blockUser(userId); closeFinishModal(); document.querySelector('.dm-back')?.click(); } catch (error) { showBridgeError(error); } }); body.append(block);
    }
    renderInfoSection(body, 'Starred messages', starred, message => { const row = makeEl('button', 'dm-finish-info-row'); row.type='button'; row.append(makeEl('strong', '', message.body || message.deal?.title || 'Starred message'), makeEl('small', '', `${message.username ? `@${message.username} · ` : ''}${formatWhen(message.created_at)}`)); row.addEventListener('click', () => { closeFinishModal(); window.setTimeout(() => focusRenderedMessage(message), 50); }); return row; }, 'No starred messages in this conversation.');
    renderInfoSection(body, 'Shared media', media, item => { const row = makeEl('div', 'dm-finish-info-row static'); row.append(makeEl('strong', '', item.asset?.file_name || item.asset?.media_type || 'Media'), makeEl('small', '', `${item.message?.username ? `@${item.message.username} · ` : ''}${formatWhen(item.message?.created_at)}`)); return row; }, 'No media has been shared here yet.');
    renderInfoSection(body, 'Shared deals', deals, item => { const row = makeEl('button', 'dm-finish-info-row'); row.type='button'; row.append(makeEl('strong', '', item.deal?.title || 'Shared deal'), makeEl('small', '', `${item.deal?.seller_name || 'Favourit deal'} · ${formatWhen(item.message?.created_at)}`)); row.addEventListener('click', () => { closeFinishModal(); if (item.deal?.id) window.dispatchEvent(new CustomEvent('favourit:open-deal', { detail: { dealId: item.deal.id } })); }); return row; }, 'No deals have been shared here yet.');
  } catch (error) { body.replaceChildren(makeEl('div', 'dm-finish-error', error?.message || 'Could not load conversation details.')); }
}
function ensureThreadTools() {
  const header = document.querySelector('.dm-panel.is-thread .dm-thread-header'); if (!header) return; if (header.querySelector('.dm-finish-header-actions')) return;
  const actions = makeEl('div', 'dm-finish-header-actions');
  const search = makeEl('button', 'dm-finish-header-button', '⌕'); search.type='button'; search.title='Search conversation'; search.setAttribute('aria-label','Search conversation'); search.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); openConversationSearch(); });
  const info = makeEl('button', 'dm-finish-header-button', 'ⓘ'); info.type='button'; info.title='Conversation details'; info.setAttribute('aria-label','Conversation details'); info.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); openConversationInfo(); }); actions.append(search, info);
  const close = header.querySelector('.dm-close'); if (close) header.insertBefore(actions, close); else header.append(actions);
}

export default function DirectMessageBridge() {
  useEffect(() => {
    const openMessage = event => {
      const username = cleanUsername(event.detail?.username); if (!username) return;
      document.querySelector('.dm-fab')?.click(); window.setTimeout(() => { const input = document.querySelector('.dm-search input'); if (!input) return; setReactInputValue(input, `@${username}`); window.setTimeout(() => { const target = [...document.querySelectorAll('.dm-search-results > button, .dm-results > button')].find(button => (button.textContent || '').toLowerCase().includes(`@${username}`)); target?.click(); }, 320); }, 80);
    };
    const syncUi = () => { lockRequestComposer(); ensureThreadTools(); if (!document.querySelector('.dm-panel.is-thread')) closeFinishModal(); };
    const onKeyDown = event => {
      if (event.key === 'Escape' && document.querySelector('.dm-finish-backdrop')) { event.preventDefault(); closeFinishModal(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && document.querySelector('.dm-panel.is-thread')) { event.preventDefault(); openConversationSearch(); }
    };
    window.addEventListener('favourit:open-direct-message', openMessage); document.addEventListener('keydown', onKeyDown);
    const observer = new MutationObserver(syncUi); observer.observe(document.body, { childList:true, subtree:true }); syncUi();
    return () => { window.removeEventListener('favourit:open-direct-message', openMessage); document.removeEventListener('keydown', onKeyDown); observer.disconnect(); unlockComposer(); closeFinishModal(); };
  }, []);
  return null;
}
