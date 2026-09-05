import { supabase } from './supabase';
import { normalizeLanguageCode } from '../data/languages';

export async function signIn(email, password) {
  if (!supabase) throw new Error('Supabase is not configured yet.');
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUp(email, password, displayName, preferredLanguage = 'en') {
  if (!supabase) throw new Error('Supabase is not configured yet.');
  const language = normalizeLanguageCode(preferredLanguage);
  return supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName, preferred_language: language } },
  });
}

export async function signOut() {
  if (!supabase) return { error: null };
  return supabase.auth.signOut();
}
