import { supabase } from './supabase';

export async function markConversationRead(conversationId) {
  if (!conversationId) throw new Error('A valid conversation is required.');
  const { data, error } = await supabase.rpc('mark_conversation_read', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  return Number(data || 0);
}

export async function getConversationReadState(conversationIds = []) {
  const ids = [...new Set((conversationIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('conversation_reads')
    .select('conversation_id, user_id, last_read_at')
    .in('conversation_id', ids);
  if (error) throw error;
  return data || [];
}
