-- Favourit economy v2
-- FAV is accounted for in micro-FAV units so the currency can become highly
-- valuable without breaking marketplace pricing or reward precision.

create table public.economy_config (
  id boolean primary key default true check (id),
  reference_usd_per_fav numeric(30, 8) not null check (reference_usd_per_fav > 0),
  standard_daily_reward_usd numeric(30, 8) not null default 1 check (standard_daily_reward_usd >= 0),
  premium_daily_reward_usd numeric(30, 8) not null default 2 check (premium_daily_reward_usd >= 0),
  onboarding_reward_days integer not null default 3 check (onboarding_reward_days >= 0),
  onboarding_daily_reward_usd numeric(30, 8) not null default 0 check (onboarding_daily_reward_usd >= 0),
  transaction_fee_bps integer not null default 500 check (transaction_fee_bps between 0 and 10000),
  minimum_deal_price_micro_fav bigint not null default 10000 check (minimum_deal_price_micro_fav > 0),
  updated_at timestamptz not null default now()
);

insert into public.economy_config (
  reference_usd_per_fav,
  standard_daily_reward_usd,
  premium_daily_reward_usd,
  onboarding_reward_days,
  onboarding_daily_reward_usd,
  transaction_fee_bps,
  minimum_deal_price_micro_fav
) values (100, 1, 2, 3, 0, 500, 10000)
on conflict (id) do nothing;

create table public.premium_memberships (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  active_until timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.economy_config enable row level security;
alter table public.premium_memberships enable row level security;

create policy "public can read economy reference"
  on public.economy_config for select using (true);

create policy "users can view their premium membership"
  on public.premium_memberships for select using (user_id = auth.uid());

-- Reward claims must record zero-value onboarding days too, so a user cannot
-- claim the same calendar day repeatedly during the onboarding period.
alter table public.reward_claims drop constraint if exists reward_claims_amount_fav_check;
alter table public.reward_claims add constraint reward_claims_amount_fav_check check (amount_fav >= 0);

-- Convert a USD-denominated reward into micro-FAV using the current reference.
create or replace function public.usd_to_micro_fav(p_usd numeric)
returns bigint
language sql
stable
as $$
  select greatest(0, round((p_usd / reference_usd_per_fav) * 1000000)::bigint)
  from public.economy_config
  where id = true;
$$;

-- Claim today's reward atomically. The frontend never supplies the reward
-- amount; the trusted database function reads the current economy settings.
create or replace function public.claim_daily_reward()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_created_at timestamptz;
  v_days integer;
  v_usd numeric;
  v_amount bigint;
  v_claim_id uuid;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select created_at into v_created_at
  from public.profiles
  where id = v_user;

  if v_created_at is null then
    raise exception 'profile not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || current_date::text, 0));

  if exists (
    select 1 from public.reward_claims
    where user_id = v_user and reward_date = current_date
  ) then
    raise exception 'daily reward already claimed';
  end if;

  select greatest(0, floor(extract(epoch from (now() - v_created_at)) / 86400)::integer)
    into v_days;

  select case
    when v_days <= onboarding_reward_days then onboarding_daily_reward_usd
    when exists (
      select 1 from public.premium_memberships pm
      where pm.user_id = v_user and pm.active_until > now()
    ) then premium_daily_reward_usd
    else standard_daily_reward_usd
  end
  into v_usd
  from public.economy_config
  where id = true;

  v_amount := public.usd_to_micro_fav(v_usd);

  insert into public.reward_claims(user_id, reward_date, amount_fav)
  values (v_user, current_date, v_amount)
  returning id into v_claim_id;

  insert into public.wallets(user_id, available_fav)
  values (v_user, v_amount)
  on conflict (user_id) do update
    set available_fav = public.wallets.available_fav + excluded.available_fav,
        updated_at = now();

  if v_amount > 0 then
    insert into public.ledger_entries(user_id, entry_type, amount_fav, idempotency_key, metadata)
    values (
      v_user,
      case when exists (
        select 1 from public.premium_memberships pm
        where pm.user_id = v_user and pm.active_until > now()
      ) then 'premium_reward'::public.ledger_entry_type else 'daily_reward'::public.ledger_entry_type end,
      v_amount,
      'daily-reward:' || v_user::text || ':' || current_date::text,
      jsonb_build_object('reward_usd', v_usd, 'reference_based', true, 'claim_id', v_claim_id)
    );
  end if;

  return v_amount;
end;
$$;

revoke all on function public.claim_daily_reward() from public;
grant execute on function public.claim_daily_reward() to authenticated;

-- Update deal minimum validation to use micro-FAV rather than an arbitrary
-- whole-coin minimum.  10,000 micro-FAV = 0.01 FAV at the accounting layer.
alter table public.deals drop constraint if exists deals_price_fav_check;
alter table public.deals add constraint deals_price_fav_check check (price_fav >= 10000);

comment on column public.wallets.available_fav is 'Micro-FAV units. 1 FAV = 1,000,000 units.';
comment on column public.wallets.held_fav is 'Micro-FAV units held in escrow. 1 FAV = 1,000,000 units.';
comment on column public.deals.price_fav is 'Micro-FAV units. 1 FAV = 1,000,000 units.';
comment on column public.orders.amount_fav is 'Micro-FAV units. 1 FAV = 1,000,000 units.';
comment on column public.orders.fee_fav is 'Micro-FAV units. 1 FAV = 1,000,000 units.';
