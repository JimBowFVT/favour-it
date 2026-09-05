import { supabase } from './supabase';

export async function getCurrentProfile() {
  if (!supabase) return { profile: null, wallet: null, error: null };

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { profile: null, wallet: null, error: userError || null };

  const [{ data: profile, error: profileError }, { data: wallet, error: walletError }] = await Promise.all([
    supabase.from('profiles').select('id, display_name, avatar_url, bio, created_at').eq('id', user.id).maybeSingle(),
    supabase.from('wallets').select('user_id, available_fav, held_fav, updated_at').eq('user_id', user.id).maybeSingle(),
  ]);

  return { profile, wallet, user, error: profileError || walletError || null };
}

export function microFavToFav(value) {
  return Number(value || 0) / 1000000;
}
