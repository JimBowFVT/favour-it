-- FAV provenance + marketplace fee model
-- 1 FAV = 1,000,000 micro-FAV everywhere in this migration.
--
-- Business rules encoded here:
-- - buyer marketplace fee: 3%
-- - seller marketplace fee: 3%
-- - crypto unlock fee: 2.5% (configuration only; bridge execution comes later)
-- - daily/promo FAV is spendable but not directly crypto-withdrawable
-- - seller proceeds from a completed marketplace order become earned/crypto-eligible FAV

alter table public.economy_config
  add column if not exists buyer_marketplace_fee_bps integer not null default 300 check (buyer_marketplace_fee_bps between 0 and 10000),
  add column if not exists seller_marketplace_fee_bps integer not null default 300 check (seller_marketplace_fee_bps between 0 and 10000),
  add column if not exists crypto_unlock_fee_bps integer not null default 250 check (crypto_unlock_fee_bps between 0 and 10000);

update public.economy_config
set buyer_marketplace_fee_bps = 300,
    seller_marketplace_fee_bps = 300,
    crypto_unlock_fee_bps = 250,
    -- Keep the legacy setting aligned with the seller-side fee for old readers.
    transaction_fee_bps = 300,
    updated_at = now()
where id = true;

create or replace function public.current_fee_bps()
returns integer
language sql
stable
as $$
  select seller_marketplace_fee_bps from public.economy_config where id = true;
$$;

create or replace function public.current_buyer_fee_bps()
returns integer
language sql
stable
as $$
  select buyer_marketplace_fee_bps from public.economy_config where id = true;
$$;

create or replace function public.current_seller_fee_bps()
returns integer
language sql
stable
as $$
  select seller_marketplace_fee_bps from public.economy_config where id = true;
$$;

create or replace function public.current_crypto_unlock_fee_bps()
returns integer
language sql
stable
as $$
  select crypto_unlock_fee_bps from public.economy_config where id = true;
$$;

alter table public.orders
  add column if not exists buyer_fee_fav bigint not null default 0,
  add column if not exists seller_fee_fav bigint not null default 0,
  add column if not exists buyer_total_fav bigint not null default 0;

update public.orders
set buyer_fee_fav = coalesce(buyer_fee_fav, 0),
    seller_fee_fav = case when seller_fee_fav = 0 then fee_fav else seller_fee_fav end,
    buyer_total_fav = case when buyer_total_fav = 0 then amount_fav + coalesce(buyer_fee_fav, 0) else buyer_total_fav end;

alter table public.orders drop constraint if exists orders_buyer_fee_nonnegative;
alter table public.orders add constraint orders_buyer_fee_nonnegative check (buyer_fee_fav >= 0);
alter table public.orders drop constraint if exists orders_seller_fee_nonnegative;
alter table public.orders add constraint orders_seller_fee_nonnegative check (seller_fee_fav >= 0);
alter table public.orders drop constraint if exists orders_buyer_total_matches;
alter table public.orders add constraint orders_buyer_total_matches check (buyer_total_fav = amount_fav + buyer_fee_fav);

comment on column public.orders.amount_fav is 'Gross service price in micro-FAV, before buyer/seller marketplace fees.';
comment on column public.orders.fee_fav is 'Legacy compatibility alias for seller_fee_fav.';
comment on column public.orders.buyer_fee_fav is 'Buyer marketplace fee in micro-FAV, charged in addition to amount_fav.';
comment on column public.orders.seller_fee_fav is 'Seller marketplace fee in micro-FAV, deducted from amount_fav.';
comment on column public.orders.buyer_total_fav is 'Total micro-FAV held from buyer: amount_fav + buyer_fee_fav.';

create table if not exists public.fav_balance_sources (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  reward_fav bigint not null default 0 check (reward_fav >= 0),
  purchased_fav bigint not null default 0 check (purchased_fav >= 0),
  earned_fav bigint not null default 0 check (earned_fav >= 0),
  legacy_fav bigint not null default 0 check (legacy_fav >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.fav_balance_sources is 'Available FAV provenance. earned_fav is the only bucket eligible for future crypto unlock.';
comment on column public.fav_balance_sources.reward_fav is 'Daily/promo/reward FAV. Spendable in Favourit, never directly withdrawable.';
comment on column public.fav_balance_sources.purchased_fav is 'FAV purchased for marketplace spending. Not directly crypto-withdrawable.';
comment on column public.fav_balance_sources.earned_fav is 'Seller proceeds from completed marketplace services. Future crypto-unlock eligible.';
comment on column public.fav_balance_sources.legacy_fav is 'Pre-provenance balance kept spendable but non-withdrawable by default.';

insert into public.fav_balance_sources(user_id, legacy_fav)
select w.user_id, w.available_fav
from public.wallets w
join public.profiles p on p.id = w.user_id
on conflict (user_id) do nothing;

alter table public.fav_balance_sources enable row level security;
drop policy if exists "users can read their FAV balance sources" on public.fav_balance_sources;
create policy "users can read their FAV balance sources"
  on public.fav_balance_sources for select
  to authenticated
  using (user_id = auth.uid());

create or replace function public.set_fav_balance_sources_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists fav_balance_sources_set_updated_at on public.fav_balance_sources;
create trigger fav_balance_sources_set_updated_at
before update on public.fav_balance_sources
for each row execute function public.set_fav_balance_sources_updated_at();

create table if not exists public.order_fav_sources (
  order_id uuid primary key references public.orders(id) on delete cascade,
  principal_reward_fav bigint not null default 0 check (principal_reward_fav >= 0),
  principal_purchased_fav bigint not null default 0 check (principal_purchased_fav >= 0),
  principal_earned_fav bigint not null default 0 check (principal_earned_fav >= 0),
  principal_legacy_fav bigint not null default 0 check (principal_legacy_fav >= 0),
  buyer_fee_reward_fav bigint not null default 0 check (buyer_fee_reward_fav >= 0),
  buyer_fee_purchased_fav bigint not null default 0 check (buyer_fee_purchased_fav >= 0),
  buyer_fee_earned_fav bigint not null default 0 check (buyer_fee_earned_fav >= 0),
  buyer_fee_legacy_fav bigint not null default 0 check (buyer_fee_legacy_fav >= 0),
  created_at timestamptz not null default now()
);

alter table public.order_fav_sources enable row level security;
-- No direct client policies: source composition is internal accounting data.

create or replace function public.consume_fav_sources(p_user uuid, p_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.fav_balance_sources%rowtype;
  v_remaining bigint := p_amount;
  v_reward bigint := 0;
  v_purchased bigint := 0;
  v_earned bigint := 0;
  v_legacy bigint := 0;
begin
  if p_user is null then raise exception 'source user is required'; end if;
  if p_amount < 0 then raise exception 'source amount cannot be negative'; end if;

  insert into public.fav_balance_sources(user_id)
  values (p_user)
  on conflict (user_id) do nothing;

  select * into v_row
  from public.fav_balance_sources
  where user_id = p_user
  for update;

  if (v_row.reward_fav + v_row.purchased_fav + v_row.earned_fav + v_row.legacy_fav) < p_amount then
    raise exception 'FAV source balance mismatch';
  end if;

  -- Spend non-withdrawable value before touching eligible seller earnings.
  v_reward := least(v_row.reward_fav, v_remaining);
  v_remaining := v_remaining - v_reward;

  v_purchased := least(v_row.purchased_fav, v_remaining);
  v_remaining := v_remaining - v_purchased;

  v_legacy := least(v_row.legacy_fav, v_remaining);
  v_remaining := v_remaining - v_legacy;

  v_earned := least(v_row.earned_fav, v_remaining);
  v_remaining := v_remaining - v_earned;

  if v_remaining <> 0 then raise exception 'FAV source allocation failed'; end if;

  update public.fav_balance_sources
  set reward_fav = reward_fav - v_reward,
      purchased_fav = purchased_fav - v_purchased,
      earned_fav = earned_fav - v_earned,
      legacy_fav = legacy_fav - v_legacy
  where user_id = p_user;

  return jsonb_build_object(
    'reward_fav', v_reward,
    'purchased_fav', v_purchased,
    'earned_fav', v_earned,
    'legacy_fav', v_legacy
  );
end;
$$;

revoke all on function public.consume_fav_sources(uuid,bigint) from public;

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
    'crypto_eligible_fav', coalesce(s.earned_fav, 0),
    'crypto_unlock_fee_bps', public.current_crypto_unlock_fee_bps()
  )
  from (select auth.uid() as user_id) u
  left join public.wallets w on w.user_id = u.user_id
  left join public.fav_balance_sources s on s.user_id = u.user_id;
$$;

revoke all on function public.get_my_fav_balance_breakdown() from public;
grant execute on function public.get_my_fav_balance_breakdown() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_language text := lower(coalesce(nullif(trim(new.raw_user_meta_data->>'preferred_language'),''),'en'));
  v_display_name text := coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''),nullif(split_part(new.email,'@',1),''),'Favourit User');
begin
  if v_language !~ '^[a-z]{2,3}$' then v_language := 'en'; end if;

  insert into public.profiles(id,username,display_name,username_chosen,preferred_language)
  values(new.id,'user_'||substr(new.id::text,1,8),left(v_display_name,80),false,v_language)
  on conflict(id) do update
    set preferred_language=coalesce(nullif(public.profiles.preferred_language,''),excluded.preferred_language);

  insert into public.wallets(user_id) values(new.id) on conflict(user_id) do nothing;
  insert into public.fav_balance_sources(user_id) values(new.id) on conflict(user_id) do nothing;
  return new;
end;
$$;

create or replace function public.claim_daily_reward()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_created timestamptz;
  v_days integer;
  v_usd numeric;
  v_amount bigint;
  v_id uuid;
  v_premium boolean;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select created_at into v_created from public.profiles where id=v_user;
  if v_created is null then raise exception 'profile not found'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text||':'||current_date::text,0));
  if exists(select 1 from public.reward_claims where user_id=v_user and reward_date=current_date) then
    raise exception 'daily reward already claimed';
  end if;

  v_days := greatest(0,floor(extract(epoch from(now()-v_created))/86400)::integer);
  select exists(select 1 from public.premium_memberships where user_id=v_user and active_until>now()) into v_premium;

  select case
    when v_days < onboarding_reward_days then onboarding_daily_reward_usd
    when v_premium then premium_daily_reward_usd
    else standard_daily_reward_usd
  end
  into v_usd
  from public.economy_config where id=true;

  v_amount := public.usd_to_micro_fav(v_usd);

  insert into public.reward_claims(user_id,reward_date,amount_fav)
  values(v_user,current_date,v_amount)
  returning id into v_id;

  insert into public.wallets(user_id,available_fav)
  values(v_user,v_amount)
  on conflict(user_id) do update
    set available_fav=wallets.available_fav+excluded.available_fav,updated_at=now();

  insert into public.fav_balance_sources(user_id,reward_fav)
  values(v_user,v_amount)
  on conflict(user_id) do update
    set reward_fav=public.fav_balance_sources.reward_fav+excluded.reward_fav;

  if v_amount > 0 then
    insert into public.ledger_entries(user_id,entry_type,amount_fav,idempotency_key,metadata)
    values(
      v_user,
      case when v_premium then 'premium_reward'::public.ledger_entry_type else 'daily_reward'::public.ledger_entry_type end,
      v_amount,
      'daily-reward:'||v_user::text||':'||current_date::text,
      jsonb_build_object('reward_usd',v_usd,'reference_based',true,'claim_id',v_id,'premium',v_premium,'withdrawable',false)
    );
  end if;

  return v_amount;
end;
$$;

revoke all on function public.claim_daily_reward() from public;
grant execute on function public.claim_daily_reward() to authenticated;

create or replace function public.create_order_and_hold_fav_v2(p_deal_id uuid,p_package_tier text default 'basic')
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid := auth.uid();
  v_deal public.deals%rowtype;
  v_order uuid;
  v_tier text := lower(trim(coalesce(p_package_tier,'basic')));
  v_package jsonb;
  v_amount bigint;
  v_buyer_fee bigint;
  v_seller_fee bigint;
  v_total bigint;
  v_principal_sources jsonb;
  v_fee_sources jsonb;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_deal from public.deals where id=p_deal_id for update;
  if not found or v_deal.status<>'published' then raise exception 'deal is not available'; end if;
  if v_deal.seller_id=v_user then raise exception 'seller cannot buy own deal'; end if;

  select p into v_package
  from jsonb_array_elements(v_deal.packages) p
  where lower(p->>'tier')=v_tier
  limit 1;

  if v_package is null then raise exception 'selected package is not available'; end if;
  v_amount := (v_package->>'price_fav')::bigint;
  if v_amount is null or v_amount<1 then raise exception 'selected package has an invalid price'; end if;

  v_package := v_package || jsonb_build_object(
    'deal_title',v_deal.title,
    'deal_description',v_deal.description,
    'deal_category',v_deal.category,
    'service_type',v_deal.service_type,
    'buyer_requirements',v_deal.buyer_requirements,
    'captured_at',now()
  );

  v_buyer_fee := ceil(v_amount::numeric * public.current_buyer_fee_bps() / 10000)::bigint;
  v_seller_fee := ceil(v_amount::numeric * public.current_seller_fee_bps() / 10000)::bigint;
  v_total := v_amount + v_buyer_fee;

  insert into public.wallets(user_id) values(v_user) on conflict(user_id) do nothing;
  insert into public.fav_balance_sources(user_id) values(v_user) on conflict(user_id) do nothing;

  update public.wallets
  set available_fav=available_fav-v_total,
      held_fav=held_fav+v_total,
      updated_at=now()
  where user_id=v_user and available_fav>=v_total;
  if not found then raise exception 'insufficient FAV balance including buyer fee'; end if;

  v_principal_sources := public.consume_fav_sources(v_user,v_amount);
  v_fee_sources := public.consume_fav_sources(v_user,v_buyer_fee);

  insert into public.orders(
    deal_id,buyer_id,seller_id,amount_fav,fee_fav,buyer_fee_fav,seller_fee_fav,buyer_total_fav,
    status,package_tier,package_snapshot
  ) values(
    v_deal.id,v_user,v_deal.seller_id,v_amount,v_seller_fee,v_buyer_fee,v_seller_fee,v_total,
    'funded',v_tier,v_package
  ) returning id into v_order;

  insert into public.order_fav_sources(
    order_id,
    principal_reward_fav,principal_purchased_fav,principal_earned_fav,principal_legacy_fav,
    buyer_fee_reward_fav,buyer_fee_purchased_fav,buyer_fee_earned_fav,buyer_fee_legacy_fav
  ) values(
    v_order,
    (v_principal_sources->>'reward_fav')::bigint,
    (v_principal_sources->>'purchased_fav')::bigint,
    (v_principal_sources->>'earned_fav')::bigint,
    (v_principal_sources->>'legacy_fav')::bigint,
    (v_fee_sources->>'reward_fav')::bigint,
    (v_fee_sources->>'purchased_fav')::bigint,
    (v_fee_sources->>'earned_fav')::bigint,
    (v_fee_sources->>'legacy_fav')::bigint
  );

  insert into public.escrow_transactions(order_id,amount_fav,status)
  values(v_order,v_total,'held');

  insert into public.ledger_entries(user_id,order_id,entry_type,amount_fav,idempotency_key,metadata)
  values(
    v_user,v_order,'escrow_hold',-v_total,'escrow-hold:'||v_order::text,
    jsonb_build_object(
      'deal_id',v_deal.id,
      'service_amount_fav',v_amount,
      'buyer_fee_fav',v_buyer_fee,
      'seller_fee_fav',v_seller_fee,
      'buyer_total_fav',v_total,
      'package_tier',v_tier,
      'package_title',v_package->>'title'
    )
  );

  return v_order;
end;
$$;

revoke all on function public.create_order_and_hold_fav_v2(uuid,text) from public;
grant execute on function public.create_order_and_hold_fav_v2(uuid,text) to authenticated;

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

  update public.platform_accounts
  set available_fav=available_fav+v_platform_fee,updated_at=now()
  where id=true;

  select * into v_sources from public.order_fav_sources where order_id=v_order.id;
  if found and v_order.amount_fav > 0 then
    -- Analytics estimate of reward-funded seller payout after the seller fee.
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
      'reward_funded_payout_estimate_fav',v_reward_subsidy
    )
  );

  return v_payout;
end;
$$;

revoke all on function public.settle_order_fav(uuid) from public;

create or replace function public.restore_order_fav(p_order_id uuid)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare
  v_order public.orders%rowtype;
  v_sources public.order_fav_sources%rowtype;
  v_total bigint;
  v_source_total bigint;
  v_reward bigint := 0;
  v_purchased bigint := 0;
  v_earned bigint := 0;
  v_legacy bigint := 0;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.status not in ('funded','in_progress','delivered','disputed') then raise exception 'order cannot be refunded'; end if;

  v_total := v_order.buyer_total_fav;

  select * into v_sources from public.order_fav_sources where order_id=v_order.id;
  if found then
    v_reward := v_sources.principal_reward_fav + v_sources.buyer_fee_reward_fav;
    v_purchased := v_sources.principal_purchased_fav + v_sources.buyer_fee_purchased_fav;
    v_earned := v_sources.principal_earned_fav + v_sources.buyer_fee_earned_fav;
    v_legacy := v_sources.principal_legacy_fav + v_sources.buyer_fee_legacy_fav;
    v_source_total := v_reward + v_purchased + v_earned + v_legacy;
    if v_source_total <> v_total then raise exception 'order FAV provenance mismatch'; end if;
  else
    -- Safe fallback for legacy pre-provenance orders.
    v_legacy := v_total;
  end if;

  update public.wallets
  set held_fav=held_fav-v_total,
      available_fav=available_fav+v_total,
      updated_at=now()
  where user_id=v_order.buyer_id and held_fav>=v_total;
  if not found then raise exception 'escrow balance mismatch'; end if;

  insert into public.fav_balance_sources(user_id,reward_fav,purchased_fav,earned_fav,legacy_fav)
  values(v_order.buyer_id,v_reward,v_purchased,v_earned,v_legacy)
  on conflict(user_id) do update
    set reward_fav=public.fav_balance_sources.reward_fav+excluded.reward_fav,
        purchased_fav=public.fav_balance_sources.purchased_fav+excluded.purchased_fav,
        earned_fav=public.fav_balance_sources.earned_fav+excluded.earned_fav,
        legacy_fav=public.fav_balance_sources.legacy_fav+excluded.legacy_fav;

  update public.orders set status='cancelled',updated_at=now() where id=v_order.id;
  update public.escrow_transactions set status='refunded',released_at=now() where order_id=v_order.id;

  insert into public.ledger_entries(user_id,order_id,entry_type,amount_fav,idempotency_key,metadata)
  values(
    v_order.buyer_id,v_order.id,'refund',v_total,'refund:'||v_order.id::text,
    jsonb_build_object('buyer_fee_refunded',true,'provenance_restored',true)
  );

  return v_total;
end;
$$;

revoke all on function public.restore_order_fav(uuid) from public;

create or replace function public.release_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.buyer_id<>v_user then raise exception 'only buyer can release order'; end if;
  if v_order.status<>'delivered' then raise exception 'order must be delivered'; end if;

  perform public.settle_order_fav(v_order.id);
  return true;
end;
$$;

revoke all on function public.release_order(uuid) from public;
grant execute on function public.release_order(uuid) to authenticated;

create or replace function public.resolve_dispute(p_dispute_id uuid, p_resolution text, p_note text default '')
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid := auth.uid();
  v_dispute public.disputes%rowtype;
  v_order public.orders%rowtype;
begin
  select * into v_dispute from public.disputes where id=p_dispute_id for update;
  if not found then raise exception 'dispute not found'; end if;

  select * into v_order from public.orders where id=v_dispute.order_id for update;

  if not exists(
    select 1 from public.moderators m
    where m.user_id=v_user
      and (m.role in('admin','moderator') or (m.role='middleman' and public.is_order_middleman(v_order.id,v_user)))
  ) then
    raise exception 'not authorized';
  end if;

  if p_resolution not in('refund_buyer','release_seller','none') then raise exception 'invalid resolution'; end if;

  if p_resolution='refund_buyer' then
    perform public.restore_order_fav(v_order.id);
  elsif p_resolution='release_seller' then
    perform public.settle_order_fav(v_order.id);
  end if;

  update public.disputes
  set status='resolved',resolution=p_resolution,resolved_at=now()
  where id=v_dispute.id;

  insert into public.moderation_audit_logs(moderator_id,order_id,dispute_id,action,note)
  values(
    v_user,v_order.id,v_dispute.id,
    case when p_resolution='refund_buyer' then 'refund_buyer'
         when p_resolution='release_seller' then 'release_seller'
         else 'close_dispute' end,
    coalesce(p_note,'')
  );

  return true;
end;
$$;

revoke all on function public.resolve_dispute(uuid,text,text) from public;
grant execute on function public.resolve_dispute(uuid,text,text) to authenticated;
