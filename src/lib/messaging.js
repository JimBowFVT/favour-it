import { supabase } from './supabase';

export async function getOrCreateOrderConversation(orderId) {
  const { data, error } = await supabase.rpc('get_or_create_order_conversation', { p_order_id: orderId });
  if (error) throw error;
  return data;
}

export async function getConversationMessages(conversationId) {
  const { data, error } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_id, body, created_at, updated_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function sendMessage(conversationId, body) {
  const text = String(body || '').trim();
  if (!text) throw new Error('Message cannot be empty.');
  if (text.length > 5000) throw new Error('Message is too long.');

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('You must be signed in to send messages.');

  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: userData.user.id, body: text })
    .select('id, conversation_id, sender_id, body, created_at, updated_at')
    .single();
  if (error) throw error;
  return data;
}
