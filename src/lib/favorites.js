import { supabase } from './supabase';

export async function getMyFavoriteDealIds() {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) return new Set();

  const { data, error } = await supabase
    .from('favorites')
    .select('deal_id')
    .eq('user_id', userData.user.id);
  if (error) throw error;
  return new Set((data || []).map(row => row.deal_id));
}

export async function getMyFavoriteDeals() {
  const { data, error } = await supabase.rpc('get_my_favorite_deals');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function setFavorite(dealId, favorite) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('You must be signed in.');

  if (favorite) {
    const { error } = await supabase.from('favorites').upsert(
      { user_id: userData.user.id, deal_id: dealId },
      { onConflict: 'user_id,deal_id', ignoreDuplicates: true }
    );
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('favorites')
      .delete()
      .eq('user_id', userData.user.id)
      .eq('deal_id', dealId);
    if (error) throw error;
  }
}
