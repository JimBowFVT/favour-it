import { supabase } from './supabase';

export async function getMyPremiumMembership() {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) return null;
  const { data, error } = await supabase
    .from('premium_memberships')
    .select('user_id, active_until, created_at')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export function isPremiumActive(membership) {
  return Boolean(membership?.active_until && new Date(membership.active_until).getTime() > Date.now());
}
