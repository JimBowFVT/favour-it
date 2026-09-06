-- Financial helper functions should never inherit a caller-controlled search_path.
-- This keeps fee/provenance calculations deterministic for SECURITY DEFINER callers.

alter function public.current_fee_bps()
  set search_path = public;

alter function public.current_buyer_fee_bps()
  set search_path = public;

alter function public.current_seller_fee_bps()
  set search_path = public;

alter function public.current_crypto_unlock_fee_bps()
  set search_path = public;

alter function public.set_fav_balance_sources_updated_at()
  set search_path = public;
