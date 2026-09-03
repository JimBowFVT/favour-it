import { supabase } from './supabase';

export function microFavToFav(value) {
  return Number(value || 0) / 1_000_000;
}

export function formatFav(value) {
  return microFavToFav(value).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export async function getMyWallet() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('wallets')
    .select('user_id, available_micro_fav, held_micro_fav, updated_at')
    .eq('user_id', user.id)
    .single();

  if (error) throw error;
  return data;
}

export async function claimDailyReward() {
  const { data, error } = await supabase.rpc('claim_daily_reward');
  if (error) throw error;
  return {
    ...data,
    reward_micro_fav: Number(data?.reward_micro_fav || 0),
    reward_fav: microFavToFav(data?.reward_micro_fav || 0),
  };
}
