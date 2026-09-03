import { supabase } from './supabase';

export async function getMyUsernameStatus() {
  const { data, error } = await supabase.rpc('get_my_username_status');
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data;
}

export async function completeUsername(username) {
  const { data, error } = await supabase.rpc('complete_username', { p_username: username });
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data;
}

export function suggestUsernames({ displayName = '', email = '' } = {}) {
  const clean = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const first = clean(displayName).slice(0, 12);
  const emailBase = clean(String(email).split('@')[0]).slice(0, 12);
  const words = ['nova', 'orbit', 'pixel', 'spark', 'vibe', 'zen', 'flow', 'forge', 'wave', 'mint', 'luma', 'echo', 'nexus', 'atlas'];
  const bases = [first, emailBase].filter(Boolean);
  const suggestions = new Set();
  while (suggestions.size < 6) {
    const base = bases[Math.floor(Math.random() * bases.length)] || words[Math.floor(Math.random() * words.length)];
    const mode = Math.floor(Math.random() * 4);
    const value = mode === 0 ? `${base}${Math.floor(10 + Math.random() * 90)}` : mode === 1 ? `${base}_${Math.floor(1 + Math.random() * 999)}` : mode === 2 ? `${words[Math.floor(Math.random() * words.length)]}${Math.floor(10 + Math.random() * 90)}` : `${base}${words[Math.floor(Math.random() * words.length)]}`;
    if (/^[a-z0-9_]{3,20}$/.test(value)) suggestions.add(value);
  }
  return [...suggestions];
}
