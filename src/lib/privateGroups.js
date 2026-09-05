import { supabase } from './supabase';

function call(name, args = {}) {
  if (!supabase) throw new Error('Favourit backend is not configured yet.');
  return supabase.rpc(name, args).then(({ data, error }) => {
    if (error) throw error;
    return data;
  });
}

export const getMyPrivateGroups = () => call('get_my_private_groups').then(data => Array.isArray(data) ? data : []);
export const createPrivateGroup = (name, memberIds) => call('create_private_group', {
  p_name: String(name || '').trim(),
  p_member_ids: Array.isArray(memberIds) ? memberIds.filter(Boolean) : [],
});
export const sendPrivateGroupMessage = (groupId, body, replyToMessageId = null) => call('send_private_group_message', {
  p_group_id: groupId,
  p_body: String(body || '').trim(),
  p_reply_to_message_id: replyToMessageId || null,
});
export const leavePrivateGroup = groupId => call('leave_private_group', { p_group_id: groupId });
