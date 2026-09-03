import { supabase } from './supabase';

export async function searchUsersByUsername(query) {
  const term = String(query || '').trim().replace(/^@/, '').toLowerCase();
  if (!term) return [];
  const { data, error } = await supabase.rpc('search_users_by_username', { p_query: term });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function getOrCreateDirectConversation(username) {
  const handle = String(username || '').trim().replace(/^@/, '');
  const { data, error } = await supabase.rpc('get_or_create_direct_conversation', { p_username: handle });
  if (error) throw error;
  return data;
}

export async function getMyDirectConversations() {
  const { data, error } = await supabase.rpc('get_my_direct_conversations');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function getDirectMessages(conversationId) {
  const { data, error } = await supabase.from('messages').select('id, conversation_id, sender_id, body, created_at, updated_at').eq('conversation_id', conversationId).order('created_at', { ascending: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function sendDirectMessage(conversationId, body) {
  const text = String(body || '').trim();
  if (!text) throw new Error('Message cannot be empty.');
  if (text.length > 5000) throw new Error('Message is too long.');
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw userError || new Error('You must be signed in.');
  const { data, error } = await supabase.from('messages').insert({ conversation_id: conversationId, sender_id: user.id, body: text }).select('id, conversation_id, sender_id, body, created_at, updated_at').single();
  if (error) throw error;
  return data;
}
