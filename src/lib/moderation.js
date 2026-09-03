import { supabase } from './supabase';

export async function assignOrderMiddleman(orderId, middlemanId) {
  const { data, error } = await supabase.rpc('assign_order_middleman', {
    p_order_id: orderId,
    p_middleman_id: middlemanId,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function unassignOrderMiddleman(orderId) {
  const { data, error } = await supabase.rpc('unassign_order_middleman', {
    p_order_id: orderId,
  });
  if (error) throw error;
  return data;
}

export async function getMiddlemanAssignment(orderId) {
  const { data, error } = await supabase
    .from('order_middlemen')
    .select('order_id, middleman_id, assigned_by, assigned_at, active, unassigned_at')
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
