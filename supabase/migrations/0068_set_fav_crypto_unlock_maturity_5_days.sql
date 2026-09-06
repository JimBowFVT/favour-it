-- Lock the seller-earnings crypto unlock maturity policy at 5 days.
-- 5 days = 120 hours. This applies prospectively when seller payout lots are created.

update public.economy_config
set crypto_unlock_maturity_hours = 120,
    updated_at = now()
where id = true
  and crypto_unlock_maturity_hours is distinct from 120;
