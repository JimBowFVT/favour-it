import { supabase } from './supabase';

function requireClient() { if (!supabase) throw new Error('Favourit backend is not configured yet.'); }

export async function getAccountSecurityStatus() {
  requireClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!user) return null;
  return { email: user.email || '', emailConfirmedAt: user.email_confirmed_at || null, phone: user.phone || '', phoneConfirmedAt: user.phone_confirmed_at || null, lastSignInAt: user.last_sign_in_at || null, hasPassword: Boolean(user.app_metadata?.provider === 'email' || user.identities?.some(identity => identity.provider === 'email')) };
}

export async function changePassword(password) {
  requireClient(); const value = String(password || '');
  if (value.length < 8) throw new Error('Password must be at least 8 characters.');
  if (value.length > 128) throw new Error('Password is too long.');
  const { error } = await supabase.auth.updateUser({ password: value }); if (error) throw error; return true;
}

export async function sendPasswordReset(email, redirectTo) {
  requireClient(); const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) throw new Error('Enter your email address.');
  const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, redirectTo ? { redirectTo } : undefined); if (error) throw error; return true;
}

export async function updateProfileBasics({ displayName, bio }) {
  requireClient(); const cleanName = String(displayName || '').trim(); const cleanBio = String(bio || '').trim();
  if (cleanName.length < 1 || cleanName.length > 80) throw new Error('Display name must be between 1 and 80 characters.');
  if (cleanBio.length > 500) throw new Error('Bio must be 500 characters or less.');
  const { data, error } = await supabase.rpc('update_my_profile', { p_display_name: cleanName, p_bio: cleanBio });
  if (error) throw error; return data;
}
