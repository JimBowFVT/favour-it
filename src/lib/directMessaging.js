import { supabase } from './supabase';
import { hydrateMessageAttachments } from './messageMedia';

function call(name, args = {}) {
  if (!supabase) throw new Error('Favourit backend is not configured yet.');
  return supabase.rpc(name, args).then(({ data, error }) => { if (error) throw error; return data; });
}

export async function searchUsersByUsername(query) {
  const term = String(query || '').trim().replace(/^@/, '').toLowerCase();
  if (!term) return [];
  const data = await call('search_users_by_username', { p_query: term });
  return Array.isArray(data) ? data : [];
}

export const getOrCreateDirectConversation = username => call('get_or_create_direct_conversation', {
  p_username: String(username || '').trim().replace(/^@/, ''),
});

export async function getMyDirectConversations() {
  const data = await call('get_my_direct_conversations');
  return Array.isArray(data) ? data : [];
}

export async function getDirectMessages(conversationId) {
  const data = await call('get_direct_messages', { p_conversation_id: conversationId });
  return hydrateMessageAttachments(Array.isArray(data) ? data : []);
}

export const sendDirectMessage = (conversationId, body = '', replyToMessageId = null, assetIds = [], dealId = null) => call('send_direct_message', {
  p_conversation_id: conversationId,
  p_body: String(body || ''),
  p_reply_to_message_id: replyToMessageId,
  p_asset_ids: Array.isArray(assetIds) ? assetIds.filter(Boolean) : [],
  p_deal_id: dealId || null,
});

export const deleteOwnDirectMessage = messageId => call('delete_own_direct_message', { p_message_id: messageId });
export const toggleDirectMessageStar = messageId => call('toggle_direct_message_star', { p_message_id: messageId });
export const getMyStarredDirectMessages = () => call('get_my_starred_direct_messages');
export const reportDirectMessage = (messageId, reason, details = '') => call('report_direct_message', { p_message_id: messageId, p_reason: reason, p_details: details });
