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

export async function grantMiddlemanRole(userId) {
  const { error } = await supabase.rpc('grant_middleman_role', {
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function revokeMiddlemanRole(userId) {
  const { error } = await supabase.rpc('revoke_middleman_role', {
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function listModerators() {
  const { data, error } = await supabase
    .from('moderators')
    .select('user_id, role, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
