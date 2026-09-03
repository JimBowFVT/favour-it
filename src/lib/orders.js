import { supabase } from './supabase';

const MICRO_FAV = 1_000_000;

const normalizeOrder = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title || 'Favourit order',
    seller: row.seller_name || row.seller || 'Favourit seller',
    sellerId: row.seller_id,
    buyerId: row.buyer_id,
    dealId: row.deal_id,
    category: row.category || 'Service',
    amount: Number(row.amount_fav || row.amount || 0) / MICRO_FAV,
    fee: Number(row.fee_fav || row.fee || 0) / MICRO_FAV,
    status: row.status,
    createdAt: row.created_at,
    updated: row.updated_at || row.created_at,
  };
};

function throwOrderError(error, fallback) {
  const message = String(error?.message || '');
  if (/seller must deliver/i.test(message)) {
    throw new Error('The seller must deliver the work before you can release the FAV.');
  }
  if (/insufficient FAV/i.test(message)) {
    throw new Error('You do not have enough available FAV for this order.');
  }
  throw new Error(message || fallback);
}

export async function createOrderAndHoldFav(dealId) {
  if (!dealId) throw new Error('A valid deal is required.');
  const { data, error } = await supabase.rpc('create_order_and_hold_fav', { p_deal_id: dealId });
  if (error) throwOrderError(error, 'Unable to fund this order.');
  return normalizeOrder(Array.isArray(data) ? data[0] : data);
}

export async function releaseOrder(orderId) {
  if (!orderId) throw new Error('A valid order is required.');
  const { data, error } = await supabase.rpc('release_order', { p_order_id: orderId });
  if (error) throwOrderError(error, 'Unable to release this order.');
  return data;
}

export async function refundOrder(orderId) {
  if (!orderId) throw new Error('A valid order is required.');
  const { data, error } = await supabase.rpc('refund_order', { p_order_id: orderId });
  if (error) throwOrderError(error, 'Unable to open a refund dispute.');
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
