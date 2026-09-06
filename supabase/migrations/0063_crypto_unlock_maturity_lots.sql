-- FAV seller earning maturity + crypto-unlock lot accounting.
--
-- We intentionally do NOT choose a business maturity period in this migration.
-- `crypto_unlock_maturity_hours` stays NULL until product/legal/risk policy is decided,
-- and crypto unlock cannot be enabled while it is unset. This lets the technical
-- accounting ship without silently deciding whether seller earnings mature in 3/7/14 days.

alter table public.economy_config
  add column if not exists crypto_unlock_maturity_hours integer
    check (crypto_unlock_maturity_hours is null or crypto_unlock_maturity_hours between 1 and 8760);

comment on column public.economy_config.crypto_unlock_maturity_hours is
  'Hours after a completed service sale before that earned FAV may be unlocked on-chain. NULL deliberately blocks crypto unlock activation until policy is chosen.';

create table if not exists public.fav_earned_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid references public.orders(id) on delete restrict,
  source_kind text not null default 'order_sale' check (source_kind in ('order_sale','legacy_unmatured','manual_adjustment')),
  original_fav bigint not null check (original_fav > 0),
  remaining_fav bigint not null check (remaining_fav >= 0 and remaining_fav <= original_fav),
  earned_at timestamptz not null default now(),
  crypto_eligible_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id)
);

create index if not exists fav_earned_lots_user_eligibility_idx
  on public.fav_earned_lots(user_id, crypto_eligible_at, earned_at, id)
  where remaining_fav > 0;

alter table public.fav_earned_lots enable row level security;
-- No client table policy. Users receive aggregate maturity information through the wallet RPC.

create table if not exists public.crypto_unlock_earned_lots (
  request_id uuid not null references public.crypto_unlock_requests(id) on delete cascade,
  lot_id uuid not null references public.fav_earned_lots(id) on delete restrict,
  amount_fav bigint not null check (amount_fav > 0),
  created_at timestamptz not null default now(),
  primary key(request_id, lot_id)
);

alter table public.crypto_unlock_earned_lots enable row level security;
-- Internal accounting only; no direct client policies.

-- Preserve safety if a database with pre-existing earned FAV applies this migration.
-- Such pre-lot earnings remain spendable internally but are not automatically crypto eligible.
insert into public.fav_earned_lots(user_id, order_id, source_kind, original_fav, remaining_fav, earned_at, crypto_eligible_at)
select s.user_id, null, 'legacy_unmatured', s.earned_fav, s.earned_fav, now(), null
from public.fav_balance_sources s
where s.earned_fav > 0
  and not exists(select 1 from public.fav_earned_lots l where l.user_id = s.user_id);

create or replace function public.set_fav_earned_lot_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists fav_earned_lots_set_updated_at on public.fav_earned_lots;
create trigger fav_earned_lots_set_updated_at
before update on public.fav_earned_lots
for each row execute function public.set_fav_earned_lot_updated_at();

create or replace function public.current_crypto_unlock_maturity_hours()
returns integer
language sql
stable
set search_path = public
as $$
  select crypto_unlock_maturity_hours from public.economy_config where id = true;
$$;

revoke all on function public.current_crypto_unlock_maturity_hours() from public;

create or replace function public.settle_order_fav(p_order_id uuid)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare
  v_order public.orders%rowtype;
  v_total bigint;
  v_seller_fee bigint;
  v_buyer_fee bigint;
  v_payout bigint;
  v_platform_fee bigint;
  v_sources public.order_fav_sources%rowtype;
  v_reward_subsidy bigint := 0;
  v_maturity_hours integer;
  v_eligible_at timestamptz;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.status not in ('funded','in_progress','delivered','disputed') then raise exception 'order cannot be settled'; end if;

  v_total := v_order.buyer_total_fav;
  v_seller_fee := v_order.seller_fee_fav;
  v_buyer_fee := v_order.buyer_fee_fav;
  v_payout := v_order.amount_fav - v_seller_fee;
  v_platform_fee := v_seller_fee + v_buyer_fee;
  if v_payout < 0 then raise exception 'invalid seller fee'; end if;

  update public.wallets
  set held_fav=held_fav-v_total,updated_at=now()
  where user_id=v_order.buyer_id and held_fav>=v_total;
  if not found then raise exception 'escrow balance mismatch'; end if;

  insert into public.wallets(user_id,available_fav)
  values(v_order.seller_id,v_payout)
  on conflict(user_id) do update
    set available_fav=wallets.available_fav+excluded.available_fav,updated_at=now();

  insert into public.fav_balance_sources(user_id,earned_fav)
  values(v_order.seller_id,v_payout)
  on conflict(user_id) do update
    set earned_fav=public.fav_balance_sources.earned_fav+excluded.earned_fav;

  -- Every seller payout gets its own immutable-origin lot. The chosen maturity period is
  -- captured when the order completes; changing policy later does not retroactively shorten it.
  v_maturity_hours := public.current_crypto_unlock_maturity_hours();
  v_eligible_at := case
    when v_maturity_hours is null then null
    else now() + make_interval(hours => v_maturity_hours)
  end;

  if v_payout > 0 then
    insert into public.fav_earned_lots(
      user_id, order_id, source_kind, original_fav, remaining_fav, earned_at, crypto_eligible_at
    ) values (
      v_order.seller_id, v_order.id, 'order_sale', v_payout, v_payout, now(), v_eligible_at
    )
    on conflict(order_id) do nothing;
  end if;

  update public.platform_accounts
  set available_fav=available_fav+v_platform_fee,updated_at=now()
  where id=true;

  select * into v_sources from public.order_fav_sources where order_id=v_order.id;
  if found and v_order.amount_fav > 0 then
    v_reward_subsidy := floor(v_sources.principal_reward_fav::numeric * v_payout / v_order.amount_fav)::bigint;
  end if;

  update public.orders
  set status='completed',completed_at=now(),updated_at=now(),fee_fav=v_seller_fee
  where id=v_order.id;

  update public.escrow_transactions
  set status='released',released_at=now()
  where order_id=v_order.id;

  insert into public.ledger_entries(user_id,order_id,entry_type,amount_fav,idempotency_key,metadata)
  values(
    v_order.seller_id,v_order.id,'sale',v_payout,'sale:'||v_order.id::text,
    jsonb_build_object(
      'gross_fav',v_order.amount_fav,
      'seller_fee_fav',v_seller_fee,
      'buyer_fee_fav',v_buyer_fee,
      'platform_fee_fav',v_platform_fee,
      'earned_withdrawable',true,
      'crypto_maturity_hours',v_maturity_hours,
      'crypto_eligible_at',v_eligible_at,
      'reward_funded_payout_estimate_fav',v_reward_subsidy
    )
  );

  return v_payout;
end;
$$;

revoke all on function public.settle_order_fav(uuid) from public;

create or replace function public.create_crypto_unlock_request(
  p_amount_fav bigint,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_config public.crypto_chain_config%rowtype;
  v_wallet public.crypto_wallets%rowtype;
  v_request_id uuid := gen_random_uuid();
  v_fee bigint;
  v_net bigint;
  v_reference text;
  v_existing public.crypto_unlock_requests%rowtype;
  v_maturity_hours integer;
  v_matured_available bigint;
  v_remaining bigint;
  v_take bigint;
  v_lot public.fav_earned_lots%rowtype;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_client_request_id is null then raise exception 'client request id is required'; end if;
  if p_amount_fav is null or p_amount_fav <= 0 then raise exception 'unlock amount must be positive'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':crypto-unlock:' || p_client_request_id::text, 0));

  select * into v_existing
  from public.crypto_unlock_requests
  where user_id = v_user and client_request_id = p_client_request_id;

  if found then
    if v_existing.gross_fav <> p_amount_fav then raise exception 'client request id was reused with a different amount'; end if;
    return jsonb_build_object(
      'id', v_existing.id,
      'gross_fav', v_existing.gross_fav,
      'fee_fav', v_existing.fee_fav,
      'net_fav', v_existing.net_fav,
      'status', v_existing.status,
      'destination_address', v_existing.destination_address,
      'chain_id', v_existing.chain_id
    );
  end if;

  select * into v_config
  from public.crypto_chain_config
  where id = true;

  if not found or not v_config.unlock_enabled then raise exception 'crypto unlock is not enabled yet'; end if;
  if v_config.chain_id <> 84532 then raise exception 'crypto unlock is restricted to Base Sepolia in this phase'; end if;
  if v_config.token_address is null or v_config.deployment_verified_at is null then raise exception 'FAV token deployment is not verified yet'; end if;

  v_maturity_hours := public.current_crypto_unlock_maturity_hours();
  if v_maturity_hours is null then raise exception 'crypto unlock maturity policy is not configured'; end if;

  select * into v_wallet
  from public.crypto_wallets
  where user_id = v_user
    and chain_id = v_config.chain_id
    and is_active = true
  for update;

  if not found then raise exception 'verify a Base Sepolia wallet before unlocking FAV'; end if;

  v_fee := ceil(p_amount_fav::numeric * public.current_crypto_unlock_fee_bps() / 10000)::bigint;
  v_net := p_amount_fav - v_fee;
  if v_net <= 0 then raise exception 'unlock amount is too small after fee'; end if;

  -- Lock all remaining lots for this user in deterministic order before checking maturity.
  perform 1
  from public.fav_earned_lots
  where user_id = v_user and remaining_fav > 0
  order by earned_at, id
  for update;

  select coalesce(sum(remaining_fav),0)::bigint into v_matured_available
  from public.fav_earned_lots
  where user_id = v_user
    and remaining_fav > 0
    and crypto_eligible_at is not null
    and crypto_eligible_at <= now();

  if v_matured_available < p_amount_fav then
    raise exception 'not enough matured earned FAV is available for crypto unlock';
  end if;

  -- Keep lock order aligned with marketplace checkout: wallet first, provenance second.
  update public.wallets
  set available_fav = available_fav - p_amount_fav,
      updated_at = now()
  where user_id = v_user and available_fav >= p_amount_fav;
  if not found then raise exception 'insufficient available FAV'; end if;

  update public.fav_balance_sources
  set earned_fav = earned_fav - p_amount_fav
  where user_id = v_user and earned_fav >= p_amount_fav;
  if not found then raise exception 'only FAV earned from completed services can be unlocked to crypto'; end if;

  v_reference := '0x' || encode(digest('favourit:unlock:' || v_request_id::text, 'sha256'), 'hex');

  insert into public.crypto_unlock_requests(
    id, client_request_id, user_id, wallet_id, chain_id, token_address, destination_address,
    gross_fav, fee_fav, net_fav, mint_reference, status
  ) values (
    v_request_id, p_client_request_id, v_user, v_wallet.id, v_config.chain_id,
    v_config.token_address, v_wallet.wallet_address,
    p_amount_fav, v_fee, v_net, v_reference, 'pending'
  );

  -- FIFO consumption keeps an auditable link from each on-chain mint back to completed orders.
  v_remaining := p_amount_fav;
  for v_lot in
    select *
    from public.fav_earned_lots
    where user_id = v_user
      and remaining_fav > 0
      and crypto_eligible_at is not null
      and crypto_eligible_at <= now()
    order by earned_at, id
    for update
  loop
    exit when v_remaining = 0;
    v_take := least(v_lot.remaining_fav, v_remaining);

    update public.fav_earned_lots
    set remaining_fav = remaining_fav - v_take
    where id = v_lot.id;

    insert into public.crypto_unlock_earned_lots(request_id, lot_id, amount_fav)
    values(v_request_id, v_lot.id, v_take);

    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining <> 0 then raise exception 'mature earned FAV allocation failed'; end if;

  update public.crypto_wallets set last_used_at = now() where id = v_wallet.id;

  insert into public.ledger_entries(user_id, entry_type, amount_fav, idempotency_key, metadata)
  values(
    v_user,
    'adjustment',
    -p_amount_fav,
    'crypto-unlock-hold:' || v_request_id::text,
    jsonb_build_object(
      'kind', 'crypto_unlock_hold',
      'crypto_unlock_id', v_request_id,
      'gross_fav', p_amount_fav,
      'fee_fav', v_fee,
      'net_fav', v_net,
      'chain_id', v_config.chain_id,
      'destination_address', v_wallet.wallet_address,
      'mint_reference', v_reference,
      'maturity_hours',v_maturity_hours
    )
  );

  return jsonb_build_object(
    'id', v_request_id,
    'gross_fav', p_amount_fav,
    'fee_fav', v_fee,
    'net_fav', v_net,
    'status', 'pending',
    'destination_address', v_wallet.wallet_address,
    'chain_id', v_config.chain_id,
    'mint_reference', v_reference
  );
end;
$$;

revoke all on function public.create_crypto_unlock_request(bigint,uuid) from public;
grant execute on function public.create_crypto_unlock_request(bigint,uuid) to authenticated;

create or replace function public.restore_crypto_unlock_earned_lots(p_request_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint := 0;
  v_allocation record;
begin
  for v_allocation in
    select a.lot_id, a.amount_fav
    from public.crypto_unlock_earned_lots a
    where a.request_id = p_request_id
    order by a.lot_id
    for update
  loop
    update public.fav_earned_lots
    set remaining_fav = remaining_fav + v_allocation.amount_fav
    where id = v_allocation.lot_id
      and remaining_fav + v_allocation.amount_fav <= original_fav;
    if not found then raise exception 'crypto unlock lot restoration mismatch'; end if;
    v_total := v_total + v_allocation.amount_fav;
  end loop;

  delete from public.crypto_unlock_earned_lots where request_id = p_request_id;
  return v_total;
end;
$$;

revoke all on function public.restore_crypto_unlock_earned_lots(uuid) from public;

create or replace function public.cancel_my_crypto_unlock_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_request public.crypto_unlock_requests%rowtype;
  v_restored bigint;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_request
  from public.crypto_unlock_requests
  where id = p_request_id and user_id = v_user
  for update;

  if not found then raise exception 'crypto unlock request not found'; end if;
  if v_request.status = 'cancelled' then return true; end if;
  if v_request.status <> 'pending' then raise exception 'crypto unlock can no longer be cancelled'; end if;

  v_restored := public.restore_crypto_unlock_earned_lots(v_request.id);
  if v_restored <> v_request.gross_fav then raise exception 'crypto unlock lot allocation mismatch'; end if;

  insert into public.wallets(user_id, available_fav)
  values(v_user, v_request.gross_fav)
  on conflict(user_id) do update
    set available_fav = public.wallets.available_fav + excluded.available_fav,
        updated_at = now();

  insert into public.fav_balance_sources(user_id, earned_fav)
  values(v_user, v_request.gross_fav)
  on conflict(user_id) do update
    set earned_fav = public.fav_balance_sources.earned_fav + excluded.earned_fav;

  update public.crypto_unlock_requests
  set status = 'cancelled', cancelled_at = now(), last_error = null
  where id = v_request.id;

  insert into public.ledger_entries(user_id, entry_type, amount_fav, idempotency_key, metadata)
  values(
    v_user,
    'adjustment',
    v_request.gross_fav,
    'crypto-unlock-cancel:' || v_request.id::text,
    jsonb_build_object('kind', 'crypto_unlock_cancel', 'crypto_unlock_id', v_request.id, 'provenance_restored', true, 'lots_restored', true)
  );

  return true;
end;
$$;

revoke all on function public.cancel_my_crypto_unlock_request(uuid) from public;
grant execute on function public.cancel_my_crypto_unlock_request(uuid) to authenticated;

create or replace function public.finalize_crypto_unlock_failure(
  p_request_id uuid,
  p_reason text,
  p_tx_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.crypto_unlock_requests%rowtype;
  v_tx_hash text := case when p_tx_hash is null then null else lower(trim(p_tx_hash)) end;
  v_restored bigint;
begin
  if v_tx_hash is not null and v_tx_hash !~ '^0x[0-9a-f]{64}$' then raise exception 'invalid transaction hash'; end if;

  select * into v_request
  from public.crypto_unlock_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'crypto unlock request not found'; end if;
  if v_request.status = 'failed' then return true; end if;
  if v_request.status = 'cancelled' then return true; end if;
  if v_request.status = 'confirmed' then raise exception 'confirmed crypto unlock cannot be failed'; end if;
  if v_request.status not in ('processing','broadcast') then raise exception 'crypto unlock request is not processing'; end if;
  if v_request.tx_hash is not null and v_tx_hash is not null and v_request.tx_hash <> v_tx_hash then raise exception 'transaction hash mismatch'; end if;

  v_restored := public.restore_crypto_unlock_earned_lots(v_request.id);
  if v_restored <> v_request.gross_fav then raise exception 'crypto unlock lot allocation mismatch'; end if;

  insert into public.wallets(user_id, available_fav)
  values(v_request.user_id, v_request.gross_fav)
  on conflict(user_id) do update
    set available_fav = public.wallets.available_fav + excluded.available_fav,
        updated_at = now();

  insert into public.fav_balance_sources(user_id, earned_fav)
  values(v_request.user_id, v_request.gross_fav)
  on conflict(user_id) do update
    set earned_fav = public.fav_balance_sources.earned_fav + excluded.earned_fav;

  update public.crypto_unlock_requests
  set status = 'failed',
      tx_hash = coalesce(tx_hash, v_tx_hash),
      failed_at = now(),
      last_error = left(coalesce(nullif(trim(p_reason), ''), 'on-chain mint failed'), 1000)
  where id = v_request.id;

  insert into public.ledger_entries(user_id, entry_type, amount_fav, idempotency_key, metadata)
  values(
    v_request.user_id,
    'adjustment',
    v_request.gross_fav,
    'crypto-unlock-refund:' || v_request.id::text,
    jsonb_build_object(
      'kind', 'crypto_unlock_refund',
      'crypto_unlock_id', v_request.id,
      'provenance_restored', true,
      'lots_restored', true,
      'reason', left(coalesce(p_reason, 'on-chain mint failed'), 1000)
    )
  );

  return true;
end;
$$;

revoke all on function public.finalize_crypto_unlock_failure(uuid,text,text) from public;
revoke all on function public.finalize_crypto_unlock_failure(uuid,text,text) from anon;
revoke all on function public.finalize_crypto_unlock_failure(uuid,text,text) from authenticated;
grant execute on function public.finalize_crypto_unlock_failure(uuid,text,text) to service_role;

create or replace function public.get_my_fav_balance_breakdown()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'available_fav', coalesce(w.available_fav, 0),
    'held_fav', coalesce(w.held_fav, 0),
    'reward_fav', coalesce(s.reward_fav, 0),
    'purchased_fav', coalesce(s.purchased_fav, 0),
    'earned_fav', coalesce(s.earned_fav, 0),
    'legacy_fav', coalesce(s.legacy_fav, 0),
    'crypto_eligible_fav', coalesce((
      select sum(l.remaining_fav)
      from public.fav_earned_lots l
      where l.user_id = u.user_id
        and l.remaining_fav > 0
        and l.crypto_eligible_at is not null
        and l.crypto_eligible_at <= now()
    ), 0),
    'crypto_maturing_fav', coalesce((
      select sum(l.remaining_fav)
      from public.fav_earned_lots l
      where l.user_id = u.user_id
        and l.remaining_fav > 0
        and (l.crypto_eligible_at is null or l.crypto_eligible_at > now())
    ), 0),
    'next_crypto_eligible_at', (
      select min(l.crypto_eligible_at)
      from public.fav_earned_lots l
      where l.user_id = u.user_id
        and l.remaining_fav > 0
        and l.crypto_eligible_at > now()
    ),
    'pending_crypto_unlock_fav', coalesce((
      select sum(r.gross_fav)
      from public.crypto_unlock_requests r
      where r.user_id = u.user_id and r.status in ('pending','processing','broadcast')
    ), 0),
    'crypto_unlock_fee_bps', public.current_crypto_unlock_fee_bps(),
    'crypto_unlock_maturity_hours', public.current_crypto_unlock_maturity_hours()
  )
  from (select auth.uid() as user_id) u
  left join public.wallets w on w.user_id = u.user_id
  left join public.fav_balance_sources s on s.user_id = u.user_id;
$$;

revoke all on function public.get_my_fav_balance_breakdown() from public;
grant execute on function public.get_my_fav_balance_breakdown() to authenticated;

create or replace function public.set_fav_crypto_unlock_enabled(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_enabled and public.current_crypto_unlock_maturity_hours() is null then
    raise exception 'cannot enable crypto unlock before seller earning maturity policy is configured';
  end if;

  if p_enabled and not exists(
    select 1
    from public.crypto_chain_config
    where id = true
      and token_address is not null
      and deployed_at is not null
      and deployment_verified_at is not null
      and admin_address is not null
      and minter_address is not null
  ) then
    raise exception 'cannot enable crypto unlock before the FAV deployment and roles are verified';
  end if;

  update public.crypto_chain_config
  set unlock_enabled = coalesce(p_enabled, false), updated_at = now()
  where id = true;

  return true;
end;
$$;

revoke all on function public.set_fav_crypto_unlock_enabled(boolean) from public;
revoke all on function public.set_fav_crypto_unlock_enabled(boolean) from anon;
revoke all on function public.set_fav_crypto_unlock_enabled(boolean) from authenticated;
grant execute on function public.set_fav_crypto_unlock_enabled(boolean) to service_role;
