import { supabase } from './supabase';

export async function getOrderConversation(orderId) {
  const { data: conversationId, error: conversationError } = await supabase.rpc(
    'get_or_create_order_conversation',
    { p_order_id: orderId }
  );
  if (conversationError) throw conversationError;

  const { data, error } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_id, body, created_at, edited_at, profiles:sender_id(display_name)')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(row => ({
    ...row,
    sender: row.profiles?.display_name || 'Favourit member',
  }));
}

export async function sendOrderMessage(orderId, body) {
  const { data, error } = await supabase.rpc('send_order_message', {
    p_order_id: orderId,
    p_body: body,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row;
}
