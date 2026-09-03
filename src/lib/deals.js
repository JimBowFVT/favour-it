import { supabase } from './supabase';

const MICRO_FAV = 1000000;

const normalizeDeal = (row, sellerName) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  seller: sellerName || 'Favourit seller',
  sellerId: row.seller_id,
  rating: Number(row.rating || 5),
  reviews: Number(row.reviews || 0),
  price: Number(row.price_fav || 0) / MICRO_FAV,
  category: row.category,
  delivery: `${row.delivery_days} days`,
  deliveryDays: row.delivery_days,
  status: row.status,
});

export async function getPublishedDeals() {
  const { data, error } = await supabase
    .from('deals')
    .select('id, seller_id, title, description, category, price_fav, delivery_days, status, created_at')
    .eq('status', 'published')
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

  return rows.map(row => normalizeDeal(row, profileMap[row.seller_id]));
}

export async function createDeal({ title, description, category, price, delivery }) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('You must be signed in to publish a deal.');

  const numericPrice = Number(price);
  const deliveryDays = Number.parseInt(String(delivery).match(/\d+/)?.[0] || '', 10);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) throw new Error('Enter a valid FAV price.');
  if (!Number.isInteger(deliveryDays) || deliveryDays < 1 || deliveryDays > 30) throw new Error('Choose a delivery time between 1 and 30 days.');

  const { data, error } = await supabase
    .from('deals')
    .insert({
      seller_id: userData.user.id,
      title: title.trim(),
      description: description.trim(),
      category,
      price_fav: Math.round(numericPrice * MICRO_FAV),
      delivery_days: deliveryDays,
      status: 'published',
    })
    .select('id, seller_id, title, description, category, price_fav, delivery_days, status, created_at')
    .single();
  if (error) throw error;

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', userData.user.id)
    .maybeSingle();

  return normalizeDeal(data, profile?.display_name);
}
