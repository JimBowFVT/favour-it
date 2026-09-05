import { supabase } from './supabase';

export async function getEconomyConfig() {
  const { data, error } = await supabase
    .from('economy_config')
    .select('reference_usd_per_fav, standard_daily_reward_usd, premium_daily_reward_usd, onboarding_reward_days, onboarding_daily_reward_usd, transaction_fee_bps, minimum_deal_price_micro_fav, updated_at')
    .eq('id', true)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export function getDailyRewardFav(config, premium = false) {
  const reference = Number(config?.reference_usd_per_fav || 0);
  const rewardUsd = Number(premium ? config?.premium_daily_reward_usd : config?.standard_daily_reward_usd || 0);
  if (!reference || !Number.isFinite(reference) || !Number.isFinite(rewardUsd)) return 0;
  return rewardUsd / reference;
}

export function formatPercentFromBps(bps) {
  const value = Number(bps || 0) / 100;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}
