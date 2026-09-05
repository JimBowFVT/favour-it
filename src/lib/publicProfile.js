import { supabase } from './supabase';

function call(name, args = {}) {
  if (!supabase) throw new Error('Favourit backend is not configured yet.');
  return supabase.rpc(name, args).then(({ data, error }) => { if (error) throw error; return data; });
}

export const getPublicProfile = userId => call('get_public_profile', { p_user_id: userId });
export const getPublicProfileByUsername = username => call('get_public_profile_by_username', { p_username: username });
export const getBlockedAccounts = () => call('get_blocked_accounts');
