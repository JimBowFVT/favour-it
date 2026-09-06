-- pgcrypto is installed in Supabase's trusted `extensions` schema. The crypto RPCs
-- deliberately pin their SECURITY DEFINER search_path, so include that schema for
-- digest() and gen_random_bytes() instead of relying on caller search_path state.

alter function public.create_wallet_link_challenge(text,bigint)
  set search_path = public, extensions;

alter function public.create_crypto_unlock_request(bigint,uuid)
  set search_path = public, extensions;
