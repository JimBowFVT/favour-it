import { supabase } from './supabase';

export async function getMyMiddlemanAssignments() {
  const { data, error } = await supabase
    .from('order_middlemen')
    .select('order_id, middleman_id, assigned_by, assigned_at, active, unassigned_at')
    .eq('middleman_id', (await supabase.auth.getUser()).data.user?.id || '')
    .eq('active', true)
    .order('assigned_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getAssignedOrder(orderId) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, deal_id, buyer_id, seller_id, amount_fav, fee_fav, status, created_at, updated_at, completed_at')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getAssignedOrderConversation(orderId) {
  const { data, error } = await supabase
    .from('order_conversations')
    .select('order_id, conversation_id, created_at')
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getAssignedConversationMessages(conversationId) {
  const { data, error } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_id, body, created_at, updated_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function markMiddlemanConversationRead(conversationId) {
  const { data, error } = await supabase.rpc('mark_conversation_read', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  return data;
}

export async function middlemanCancelOrder(orderId, reason) {
  const cleanReason = String(reason || '').trim();
  if (cleanReason.length < 10 || cleanReason.length > 2000) {
    throw new Error('Please provide a cancellation reason between 10 and 2000 characters.');
  }
  const { data, error } = await supabase.rpc('middleman_cancel_order', {
    p_order_id: orderId,
    p_reason: cleanReason,
  });
  if (error) throw error;
  return data;
}

export async function middlemanResolveDispute(disputeId, resolution, note = '') {
  if (!['refund_buyer', 'release_seller', 'none'].includes(resolution)) {
    throw new Error('Invalid mediation resolution.');
  }
  const { error } = await supabase.rpc('resolve_dispute', {
    p_dispute_id: disputeId,
    p_resolution: resolution,
    p_note: String(note || '').trim(),
  });
  if (error) throw error;
}
