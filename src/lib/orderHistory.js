import { supabase } from './supabase';

export async function getOrderStatusHistory(orderId) {
  const { data, error } = await supabase
    .from('order_status_history')
    .select('id, order_id, from_status, to_status, changed_by, note, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}
