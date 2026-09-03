import { supabase } from './supabase';

export async function startOrder(orderId) {
  const { data, error } = await supabase.rpc('start_order', { p_order_id: orderId });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function deliverOrder(orderId) {
  const { data, error } = await supabase.rpc('deliver_order', { p_order_id: orderId });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
