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

export async function getMyFavBalanceBreakdown() {
  const { data, error } = await supabase.rpc('get_my_fav_balance_breakdown');
  if (error) throw error;
  const value = Array.isArray(data) ? data[0] : data;
  if (!value) return null;
  return {
    available_fav: Number(value.available_fav || 0),
    held_fav: Number(value.held_fav || 0),
    reward_fav: Number(value.reward_fav || 0),
    purchased_fav: Number(value.purchased_fav || 0),
    earned_fav: Number(value.earned_fav || 0),
    legacy_fav: Number(value.legacy_fav || 0),
    crypto_eligible_fav: Number(value.crypto_eligible_fav || 0),
    crypto_unlock_fee_bps: Number(value.crypto_unlock_fee_bps || 0),
  };
}

export async function claimDailyReward() {
  const { data, error } = await supabase.rpc('claim_daily_reward');
  if (error) throw error;

  const amount = Number(Array.isArray(data) ? data[0] : data || 0);
  return {
    reward_micro_fav: amount,
    reward_fav: microFavToFav(amount),
    claimed: true,
    crypto_withdrawable: false,
  };
}
