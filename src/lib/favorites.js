import { supabase } from './supabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const demoLikeKey = userId => `favourit:liked-demo-deals:${userId}`;

function isUuid(value) {
  return UUID_RE.test(String(value || ''));
}

function readDemoLikes(userId) {
  if (!userId) return new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem(demoLikeKey(userId)) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch (_) {
    return new Set();
  }
}

function writeDemoLikes(userId, ids) {
  if (!userId) return;
  try { localStorage.setItem(demoLikeKey(userId), JSON.stringify([...ids])); }
  catch (_) {}
}

export async function getMyLikedDealIds() {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) return new Set();

  const demoLikes = readDemoLikes(userData.user.id);
  const { data, error } = await supabase.rpc('get_my_liked_deal_ids');
  if (error) throw error;

  const liveLikes = (Array.isArray(data) ? data : []).map(row => String(row.deal_id));
  return new Set([...liveLikes, ...demoLikes]);
}

export async function getMyLikedDeals() {
  const { data, error } = await supabase.rpc('get_my_favorite_deals');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function setDealLiked(dealId, liked) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('You must be signed in.');

  const normalizedId = String(dealId);
  if (!isUuid(normalizedId)) {
    const ids = readDemoLikes(userData.user.id);
    if (liked) ids.add(normalizedId);
    else ids.delete(normalizedId);
    writeDemoLikes(userData.user.id, ids);
    return Boolean(liked);
  }

  const { data, error } = await supabase.rpc('set_deal_liked', {
    p_deal_id: normalizedId,
    p_liked: Boolean(liked),
  });
  if (error) throw error;
  return Boolean(data);
}

// Backward-compatible aliases while the rest of the app migrates from "favorite" wording.
export const getMyFavoriteDealIds = getMyLikedDealIds;
export const getMyFavoriteDeals = getMyLikedDeals;
export const setFavorite = setDealLiked;
