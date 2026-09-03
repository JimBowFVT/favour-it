import { supabase } from './supabase';

const MICRO_FAV = 1_000_000;

export async function getMyAccountSummary() {
  const { data, error } = await supabase.rpc('get_my_account_summary');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    ...row,
    availableFav: Number(row.available_fav || 0) / MICRO_FAV,
    heldFav: Number(row.held_fav || 0) / MICRO_FAV,
    premiumActive: Boolean(row.premium_active),
  };
}
