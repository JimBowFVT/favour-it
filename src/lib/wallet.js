import { supabase } from './supabase';

const MICRO_FAV = 1_000_000;

export function microFavToFav(value) {
  return Number(value || 0) / MICRO_FAV;
}

export function formatFav(value) {
  return microFavToFav(value).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export async function getMyWallet() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('wallets')
    .select('user_id, available_fav, held_fav, updated_at')
    .eq('user_id', user.id)
    .single();

  if (error) throw error;
  return data;
}

export async function claimDailyReward() {
  const { data, error } = await supabase.rpc('claim_daily_reward');
  if (error) throw error;

  const result = Array.isArray(data) ? data[0] : data;
  const amount = Number(result?.reward_micro_fav || result?.amount_fav || 0);
  return {
    ...result,
    reward_micro_fav: amount,
    reward_fav: microFavToFav(amount),
  };
}
