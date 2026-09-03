import { supabase } from './supabase';

const normalizeOrder = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    buyerId: row.buyer_id || row.buyerId || null,
    sellerId: row.seller_id || row.sellerId || null,
    dealId: row.deal_id || row.dealId || null,
    title: row.title || 'Favourit order',
    seller: row.seller_name || row.seller || 'Favourit seller',
    category: row.category || 'Service',
    amount: Number(row.amount_fav || row.amount || 0) / 1000000,
    fee: Number(row.fee_fav || row.fee || 0) / 1000000,
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
    .select('id, buyer_id, seller_id, deal_id, amount_fav, fee_fav, status, created_at, updated_at, deals(title, category)')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows = data || [];
  const sellerIds = [...new Set(rows.map(row => row.seller_id).filter(Boolean))];
  let profileMap = {};

  if (sellerIds.length) {
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', sellerIds);
    if (profileError) throw profileError;
    profileMap = Object.fromEntries((profiles || []).map(profile => [profile.id, profile.display_name]));
  }

  return rows.map(row => normalizeOrder({
    ...row,
    title: row.deals?.title,
    category: row.deals?.category,
    seller_name: profileMap[row.seller_id],
  }));
}
