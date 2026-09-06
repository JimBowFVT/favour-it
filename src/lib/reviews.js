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
  const numericRating = Number(rating);
  const cleanBody = String(body || '').trim().slice(0, 1200);
  if (!orderId) throw new Error('A valid completed order is required.');
  if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) throw new Error('Choose a rating from 1 to 5 stars.');

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
      rating: numericRating,
      body: cleanBody,
    })
    .select('id, order_id, reviewer_id, seller_id, rating, body, created_at')
    .single();
  if (error) {
    if (String(error.message || '').toLowerCase().includes('duplicate')) throw new Error('You already reviewed this order.');
    throw error;
  }
  return data;
}
