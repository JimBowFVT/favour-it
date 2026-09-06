import { supabase } from './supabase';

function throwSellerOrderError(error, fallback) {
  const message = String(error?.message || '');
  if (/seller access required/i.test(message)) throw new Error('Only the seller for this order can change its delivery status.');
  if (/not ready to start/i.test(message)) throw new Error('This order is no longer waiting to be started.');
  if (/cannot be delivered/i.test(message)) throw new Error('This order cannot be marked delivered from its current status.');
  throw new Error(message || fallback);
}

export async function startOrder(orderId) {
  if (!orderId) throw new Error('A valid order is required.');
  const { data, error } = await supabase.rpc('start_order', { p_order_id: orderId });
  if (error) throwSellerOrderError(error, 'Could not start this order.');
  return Array.isArray(data) ? data[0] : data;
}

export async function deliverOrder(orderId) {
  if (!orderId) throw new Error('A valid order is required.');
  const { data, error } = await supabase.rpc('deliver_order', { p_order_id: orderId });
  if (error) throwSellerOrderError(error, 'Could not mark this order delivered.');
  return Array.isArray(data) ? data[0] : data;
}
