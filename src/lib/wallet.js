import { supabase } from './supabase';
import { formatMicroFav, microFavInteger } from './favAmounts';
import { createAccountRequests, currentAccountId } from './accountRequests';

const MICRO_FAV = 1_000_000;

export function microFavToFav(value) {
  return Number(value || 0) / MICRO_FAV;
}

export function formatFav(value) {
  return formatMicroFav(value);
}

export async function getMyWallet() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const userId = data.session?.user?.id;
  if (!userId) return null;
  const requests = createAccountRequests(supabase, userId);
  const overview = await requests.run(() => supabase.rpc('get_my_wallet_overview'));
  return overview?.wallet ? { user_id: userId, ...overview.wallet } : null;
}

export async function getMyFavBalanceBreakdown(userId) {
  userId = await currentAccountId(supabase, userId);
  const requests = createAccountRequests(supabase, userId);
  const data = await requests.run(() => supabase.rpc('get_my_fav_balance_breakdown'));
  const value = Array.isArray(data) ? data[0] : data;
  if (!value) throw new Error('Your balance breakdown is unavailable.');
  const result = { ...value };
  for (const field of ['available_fav', 'held_fav', 'reward_fav', 'purchased_fav', 'earned_fav', 'legacy_fav', 'crypto_eligible_fav', 'crypto_maturing_fav', 'pending_crypto_unlock_fav']) {
    // Unknown stays unknown; unsafe JSON numbers cause a visible error, never rounding.
    result[field] = value[field] == null ? null : microFavInteger(value[field]).toString();
  }
  result.crypto_unlock_fee_bps = value.crypto_unlock_fee_bps == null ? null : Number(value.crypto_unlock_fee_bps);
  result.crypto_unlock_maturity_hours = value.crypto_unlock_maturity_hours == null ? null : Number(value.crypto_unlock_maturity_hours);
  result.next_crypto_eligible_at = value.next_crypto_eligible_at || null;
  return result;
}
