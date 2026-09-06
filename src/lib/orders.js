import { supabase } from './supabase';

const MICRO_FAV = 1_000_000;

const normalizeOrder = (row) => {
  if (!row) return null;
  const snapshot = row.package_snapshot && typeof row.package_snapshot === 'object' ? row.package_snapshot : {};
  const amountMicro = Number(row.amount_fav || row.amount || 0);
  const sellerFeeMicro = Number(row.seller_fee_fav ?? row.fee_fav ?? row.fee ?? 0);
  const buyerFeeMicro = Number(row.buyer_fee_fav || 0);
  const buyerTotalMicro = Number(row.buyer_total_fav || (amountMicro + buyerFeeMicro));
  return {
    id: row.id,
    title: row.title || snapshot.deal_title || 'Favourit order',
    category: row.category || snapshot.deal_category || '',
    seller: row.seller_name || row.seller || 'Favourit seller',
    sellerUsername: row.seller_username || '',
    sellerId: row.seller_id,
    buyer: row.buyer_name || row.buyer || 'Favourit buyer',
    buyerUsername: row.buyer_username || '',
    buyerId: row.buyer_id,
    dealId: row.deal_id,
    amount: amountMicro / MICRO_FAV,
    fee: sellerFeeMicro / MICRO_FAV,
    sellerFee: sellerFeeMicro / MICRO_FAV,
    sellerPayout: Math.max(0, amountMicro - sellerFeeMicro) / MICRO_FAV,
    buyerFee: buyerFeeMicro / MICRO_FAV,
    buyerTotal: buyerTotalMicro / MICRO_FAV,
    status: row.status,
    packageTier: row.package_tier || snapshot.tier || 'basic',
    packageTitle: snapshot.title || 'Basic',
    packageDescription: snapshot.description || '',
    packageDeliveryDays: Number(snapshot.delivery_days || 0) || null,
    packageRevisions: Number(snapshot.revisions ?? 0),
    serviceType: snapshot.service_type || 'deliverable',
    dealDescription: snapshot.deal_description || '',
    buyerRequirements: snapshot.buyer_requirements || '',
    scopeCapturedAt: snapshot.captured_at || null,
    review: row.review || null,
    createdAt: row.created_at,
    updated: row.updated_at || row.created_at,
  };
};

function throwOrderError(error, fallback) {
  const message = String(error?.message || '');
  if (/seller must deliver/i.test(message)) throw new Error('The seller must deliver the work before you can release the FAV.');
  if (/insufficient FAV/i.test(message)) throw new Error('You do not have enough available FAV for this order and its buyer fee.');
  if (/selected package is not available/i.test(message)) throw new Error('That package is no longer available. Refresh the deal and choose another package.');
  throw new Error(message || fallback);
}

export async function createOrderAndHoldFav(dealId, packageTier = 'basic') {
  if (!dealId) throw new Error('A valid deal is required.');
  const { data, error } = await supabase.rpc('create_order_and_hold_fav_v2', {
    p_deal_id: dealId,
    p_package_tier: packageTier,
  });
  if (error) throwOrderError(error, 'Unable to fund this order.');
  const orderId = typeof data === 'string' ? data : Array.isArray(data) ? data[0]?.id || data[0] : data?.id || data;
  return orderId ? { id: orderId } : null;
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
    .select('id, buyer_id, seller_id, deal_id, amount_fav, fee_fav, buyer_fee_fav, seller_fee_fav, buyer_total_fav, status, package_tier, package_snapshot, created_at, updated_at, deals(title, category)')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows = data || [];
  const participantIds = [...new Set(rows.flatMap(row => [row.seller_id, row.buyer_id]).filter(Boolean))];
  const orderIds = rows.map(row => row.id).filter(Boolean);
  let profileMap = {};
  let reviewMap = {};

  if (participantIds.length) {
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, display_name, username')
      .in('id', participantIds);
    if (profileError) throw profileError;
    profileMap = Object.fromEntries((profiles || []).map(profile => [profile.id, profile]));
  }

  if (orderIds.length) {
    const { data: reviews, error: reviewError } = await supabase
      .from('reviews')
      .select('id, order_id, rating, body, created_at')
      .in('order_id', orderIds);
    if (reviewError) throw reviewError;
    reviewMap = Object.fromEntries((reviews || []).map(review => [review.order_id, review]));
  }

  return rows.map(row => normalizeOrder({
    ...row,
    title: row.deals?.title || row.package_snapshot?.deal_title,
    category: row.deals?.category || row.package_snapshot?.deal_category,
    seller_name: profileMap[row.seller_id]?.display_name,
    seller_username: profileMap[row.seller_id]?.username,
    buyer_name: profileMap[row.buyer_id]?.display_name,
    buyer_username: profileMap[row.buyer_id]?.username,
    review: reviewMap[row.id] || null,
  }));
}

export { normalizeOrder };
