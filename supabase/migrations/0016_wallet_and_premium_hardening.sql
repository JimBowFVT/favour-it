-- Wallet/ledger hardening: balances and accounting records are server-owned.
revoke insert, update, delete on public.wallets from authenticated;
revoke insert, update, delete on public.ledger_entries from authenticated;
revoke insert, update, delete on public.reward_claims from authenticated;
revoke insert, update, delete on public.premium_memberships from authenticated;

-- A single read endpoint keeps the frontend from having to combine sensitive
-- account state from multiple requests. It still exposes only the caller's data.
create or replace function public.get_my_account_summary()
returns table (
  available_fav bigint,
  held_fav bigint,
  premium_active boolean,
  premium_active_until timestamptz,
  last_reward_date date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  return query
  select
    coalesce(w.available_fav, 0),
    coalesce(w.held_fav, 0),
    (pm.active_until is not null and pm.active_until > now()),
    pm.active_until,
    (select max(rc.reward_date) from public.reward_claims rc where rc.user_id = v_user)
  from (select v_user as user_id) u
  left join public.wallets w on w.user_id = u.user_id
  left join public.premium_memberships pm on pm.user_id = u.user_id;
end;
$$;

revoke all on function public.get_my_account_summary() from public;
grant execute on function public.get_my_account_summary() to authenticated;
