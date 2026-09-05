import { supabase } from './supabase';
import { resolveServiceCategory } from '../data/serviceCategories';

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
  category: resolveServiceCategory(row.category)?.label || row.category,
  delivery: `${row.delivery_days} days`,
  deliveryDays: row.delivery_days,
  status: row.status,
  createdAt: row.created_at || null,
});

async function getSellerNames(rows) {
  const sellerIds = [...new Set((rows || []).map(row => row.seller_id).filter(Boolean))];
  if (!sellerIds.length) return {};
  const { data: profiles, error } = await supabase.from('profiles').select('id, display_name').in('id', sellerIds);
  if (error) throw error;
  return Object.fromEntries((profiles || []).map(profile => [profile.id, profile.display_name]));
}

export async function getPublishedDeals() {
  const { data, error } = await supabase
    .from('deals')
    .select('id, seller_id, title, description, category, price_fav, delivery_days, status, created_at')
    .eq('status', 'published')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  const profileMap = await getSellerNames(rows);
  return rows.map(row => normalizeDeal(row, profileMap[row.seller_id]));
}

export async function getDealById(dealId) {
  if (!dealId) return null;
  const { data: row, error } = await supabase
    .from('deals')
    .select('id, seller_id, title, description, category, price_fav, delivery_days, status, created_at')
    .eq('id', dealId)
    .eq('status', 'published')
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const profileMap = await getSellerNames([row]);
  return normalizeDeal(row, profileMap[row.seller_id]);
}

export async function createDeal({ title, description, category, price, delivery }) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('You must be signed in to publish a deal.');

  const numericPrice = Number(price);
  const deliveryDays = Number.parseInt(String(delivery).match(/\d+/)?.[0] || '', 10);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) throw new Error('Enter a valid FAV price.');
  if (!Number.isInteger(deliveryDays) || deliveryDays < 1 || deliveryDays > 30) {
    throw new Error('Choose a delivery time between 1 and 30 days.');
  }

  const selectedCategory = resolveServiceCategory(category);
  if (!selectedCategory) throw new Error('Choose an approved Favourit service category.');

  const { data, error } = await supabase.rpc('create_deal', {
    p_title: title.trim(),
    p_description: description.trim(),
    p_category: selectedCategory.label,
    p_price_fav: Math.round(numericPrice * MICRO_FAV),
    p_delivery_days: deliveryDays,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Deal was not created.');
  return normalizeDeal(row, userData.user.user_metadata?.display_name);
}
