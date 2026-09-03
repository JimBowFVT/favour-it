import { supabase } from './supabase';

const MICRO_FAV = 1_000_000;

export async function getMyWalletLedger(limit = 50) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const { data, error } = await supabase
    .from('ledger_entries')
    .select('id, order_id, entry_type, amount_fav, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  return (data || []).map(entry => ({
    ...entry,
    amountFav: Number(entry.amount_fav || 0) / MICRO_FAV,
  }));
}

export async function getMyRewardClaims(limit = 30) {
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const { data, error } = await supabase
    .from('reward_claims')
    .select('id, reward_date, amount_fav, created_at')
    .order('reward_date', { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  return (data || []).map(claim => ({
    ...claim,
    amountFav: Number(claim.amount_fav || 0) / MICRO_FAV,
  }));
}

export function ledgerLabel(entryType) {
  return {
    daily_reward: 'Daily reward',
    premium_reward: 'Premium daily reward',
    purchase: 'Purchase',
    escrow_hold: 'Payment secured',
    escrow_release: 'Order completed',
    refund: 'Refund',
    fee: 'Platform fee',
    sale: 'Sale earnings',
    adjustment: 'Account adjustment',
  }[entryType] || 'FAV transaction';
}
