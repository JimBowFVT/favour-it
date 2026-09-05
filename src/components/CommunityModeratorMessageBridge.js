import { useEffect, useRef } from 'react';
import { getCommunityGroupMessages, listCommunityGroups, moderateCommunityGroupMessage } from '../lib/social';
import './CommunityModeratorMessageBridge.css';

function isCommunityThread() {
  return String(document.querySelector('.dm-thread-header .dm-thread-identity small')?.textContent || '').trim().toLowerCase() === 'community chat';
}

function threadName() {
  return String(document.querySelector('.dm-thread-header .dm-thread-identity strong')?.textContent || '').trim();
}

export default function CommunityModeratorMessageBridge() {
  const syncingRef = useRef(false);
  const groupCacheRef = useRef(new Map());

  useEffect(() => {
    let active = true;

    const resolveGroup = async name => {
      const key = String(name || '').trim().toLowerCase();
      if (!key) return null;
      if (groupCacheRef.current.has(key)) return groupCacheRef.current.get(key);
      const groups = await listCommunityGroups();
      const group = (Array.isArray(groups) ? groups : []).find(item => String(item?.name || '').trim().toLowerCase() === key) || null;
      if (group) groupCacheRef.current.set(key, group);
      return group;
    };

    const sync = async () => {
      if (!active || syncingRef.current || !isCommunityThread()) return;
      const menu = document.querySelector('.dm-panel.is-thread .dm-message-menu');
      const row = menu?.closest('.dm-message-row');
      if (!menu || !row || row.classList.contains('mine') || row.classList.contains('deleted') || menu.querySelector('.community-moderator-remove-message')) return;
      const messageId = row.dataset.messageId;
      if (!messageId) return;

      syncingRef.current = true;
      try {
        const group = await resolveGroup(threadName());
        if (!group?.id || !active || !document.body.contains(menu)) return;
        const messages = await getCommunityGroupMessages(group.id);
        const message = (Array.isArray(messages) ? messages : []).find(item => String(item?.id || '') === String(messageId));
        if (!message?.is_moderator || message?.is_deleted || !active || !document.body.contains(menu)) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'community-moderator-remove-message';
        button.textContent = 'Remove as moderator';
        button.addEventListener('click', async event => {
          event.preventDefault();
          event.stopPropagation();
          if (button.disabled) return;
          if (!window.confirm('Remove this message from the Community chat?')) return;
          button.disabled = true;
          button.textContent = 'Removing…';
          try {
            await moderateCommunityGroupMessage(messageId, 'delete', 'Removed by a community moderator.');
            button.textContent = 'Removed';
            row.classList.add('community-message-moderation-pending');
            window.setTimeout(() => row.querySelector('.dm-more')?.click(), 120);
          } catch (error) {
            button.disabled = false;
            button.textContent = 'Remove as moderator';
            const panel = document.querySelector('.dm-panel');
            if (panel) {
              panel.querySelector('.community-moderator-error')?.remove();
              const notice = document.createElement('div');
              notice.className = 'dm-error community-moderator-error';
              notice.textContent = error?.message || 'Could not remove this message.';
              panel.prepend(notice);
            }
          }
        });
        menu.append(button);
      } catch (_) {
        // The normal report/delete controls remain available if moderator state cannot be loaded.
      } finally {
        syncingRef.current = false;
      }
    };

    const observer = new MutationObserver(() => { sync().catch(() => {}); });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    sync().catch(() => {});

    const refreshCache = () => groupCacheRef.current.clear();
    window.addEventListener('favourit:community-updated', refreshCache);
    return () => {
      active = false;
      observer.disconnect();
      window.removeEventListener('favourit:community-updated', refreshCache);
    };
  }, []);

  return null;
}
