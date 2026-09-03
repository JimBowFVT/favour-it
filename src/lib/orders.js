import { supabase } from './supabase';

const normalizeOrder = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    seller: row.seller_name || row.seller || 'Favourit seller',
    category: row.category || 'Service',
    amount: Number(row.amount_micro_fav || row.amount || 0) / 1000000,
    fee: Number(row.fee_micro_fav || row.fee || 0) / 1000000,
    status: row.status,
    updated: row.updated_at || row.created_at,
  };
};

export async function createOrderAndHoldFav(dealId) {
  const { data, error } = await supabase.rpc('create_order_and_hold_fav', { p_deal_id: dealId });
  if (error) throw error;
  return normalizeOrder(Array.isArray(data) ? data[0] : data);
}

export async function releaseOrder(orderId) {
  const { data, error } = await supabase.rpc('release_order', { p_order_id: orderId });
  if (error) throw error;
  return data;
}

export async function refundOrder(orderId) {
  const { data, error } = await supabase.rpc('refund_order', { p_order_id: orderId });
  if (error) throw error;
  return data;
}

export async function getMyOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select('id, buyer_id, seller_id, deal_id, amount_micro_fav, fee_micro_fav, status, created_at, updated_at, deals(title, category, profiles!orders_seller_id_fkey(display_name))')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => normalizeOrder({
    ...row,
    title: row.deals?.title,
    category: row.deals?.category,
    seller_name: row.deals?.profiles?.display_name,
  }));
}
