import { supabase } from './supabase';

export async function getDealReviews(sellerId) {
  const { data, error } = await supabase
    .from('reviews')
    .select('id, order_id, reviewer_id, seller_id, rating, body, created_at, profiles:reviewer_id(display_name)')
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => ({
    ...row,
    reviewer: row.profiles?.display_name || 'Favourit member',
  }));
}

export async function createReview({ orderId, rating, body = '' }) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('You must be signed in.');

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, buyer_id, seller_id, status')
    .eq('id', orderId)
    .eq('buyer_id', userData.user.id)
    .single();
  if (orderError) throw orderError;
  if (order.status !== 'completed') throw new Error('You can review an order after it is completed.');

  const { data, error } = await supabase
    .from('reviews')
    .insert({
      order_id: order.id,
      reviewer_id: userData.user.id,
      seller_id: order.seller_id,
      rating: Number(rating),
      body: String(body).trim(),
    })
    .select('id, order_id, reviewer_id, seller_id, rating, body, created_at')
    .single();
  if (error) throw error;
  return data;
}
