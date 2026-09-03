-- Favourit safety pass: close the remaining trust-boundary gaps in the MVP.
-- All changes are server-side and preserve the existing public API used by the client.

-- 1) Onboarding rewards are only zero-value for the first N calendar-age days.
-- Day N+1 becomes eligible for the normal/premium reward.
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
  v_is_premium boolean := false;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select created_at into v_created_at from public.profiles where id = v_user;
  if v_created_at is null then raise exception 'profile not found'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || current_date::text, 0));

  if exists (select 1 from public.reward_claims where user_id = v_user and reward_date = current_date) then
    raise exception 'daily reward already claimed';
  end if;

  v_days := greatest(0, floor(extract(epoch from (now() - v_created_at)) / 86400)::integer);
  v_is_premium := exists (
    select 1 from public.premium_memberships pm
    where pm.user_id = v_user and pm.active_until > now()
  );

  select case
    when v_days < onboarding_reward_days then onboarding_daily_reward_usd
    when v_is_premium then premium_daily_reward_usd
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
      case when v_is_premium then 'premium_reward'::public.ledger_entry_type else 'daily_reward'::public.ledger_entry_type end,
      v_amount,
      'daily-reward:' || v_user::text || ':' || current_date::text,
      jsonb_build_object('reward_usd', v_usd, 'reference_based', true, 'claim_id', v_claim_id, 'premium', v_is_premium)
    );
  end if;

  return v_amount;
end;
$$;

revoke all on function public.claim_daily_reward() from public;
grant execute on function public.claim_daily_reward() to authenticated;

-- 2) Buyers can release escrow only after the seller has explicitly delivered.
-- The previous implementation accepted funded/in_progress as well, which could
-- accidentally mark unfinished work as completed.
create or replace function public.release_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders%rowtype;
  v_payout bigint;
  v_fee bigint;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.buyer_id <> v_user then raise exception 'only buyer can release order'; end if;
  if v_order.status <> 'delivered' then raise exception 'seller must deliver before release'; end if;

  v_fee := v_order.fee_fav;
  v_payout := v_order.amount_fav - v_fee;
  if v_payout < 0 then raise exception 'invalid fee'; end if;

  update public.wallets
  set held_fav = held_fav - v_order.amount_fav, updated_at = now()
  where user_id = v_order.buyer_id and held_fav >= v_order.amount_fav;
  if not found then raise exception 'escrow balance mismatch'; end if;

  insert into public.wallets(user_id, available_fav, held_fav)
  values (v_order.seller_id, v_payout, 0)
  on conflict (user_id) do update
    set available_fav = public.wallets.available_fav + excluded.available_fav, updated_at = now();

  insert into public.platform_accounts(id, available_fav)
  values (true, v_fee)
  on conflict (id) do update
    set available_fav = public.platform_accounts.available_fav + excluded.available_fav, updated_at = now();

  update public.orders
  set status = 'completed', completed_at = now(), updated_at = now()
  where id = v_order.id;

  update public.escrow_transactions
  set status = 'released', released_at = now()
  where order_id = v_order.id and status = 'held';
  if not found then raise exception 'escrow transaction is not held'; end if;

  insert into public.ledger_entries(user_id, order_id, entry_type, amount_fav, idempotency_key, metadata)
  values
    (v_order.buyer_id, v_order.id, 'escrow_release', -v_order.amount_fav,
      'escrow-release-buyer:' || v_order.id::text,
      jsonb_build_object('completed', true)),
    (v_order.seller_id, v_order.id, 'sale', v_payout,
      'sale:' || v_order.id::text,
      jsonb_build_object('gross_fav', v_order.amount_fav, 'fee_fav', v_fee));

  return true;
end;
$$;

revoke all on function public.release_order(uuid) from public;
grant execute on function public.release_order(uuid) to authenticated;

-- 3) A dispute resolution must actually settle escrow. 'none' previously
-- allowed a moderator to close a dispute while leaving funds permanently held.
create or replace function public.resolve_dispute(
  p_dispute_id uuid,
  p_resolution text,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_dispute public.disputes%rowtype;
  v_order public.orders%rowtype;
  v_net bigint;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.moderators m where m.user_id = v_user) then raise exception 'moderator access required'; end if;
  if p_resolution not in ('refund_buyer','release_seller') then raise exception 'resolution must settle escrow'; end if;

  select * into v_dispute from public.disputes where id = p_dispute_id for update;
  if not found then raise exception 'dispute not found'; end if;
  if v_dispute.status in ('resolved','closed') then raise exception 'dispute already resolved'; end if;

  select * into v_order from public.orders where id = v_dispute.order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.status <> 'disputed' then raise exception 'order is not disputed'; end if;

  if p_resolution = 'refund_buyer' then
    update public.wallets
    set available_fav = available_fav + v_order.amount_fav,
        held_fav = held_fav - v_order.amount_fav,
        updated_at = now()
    where user_id = v_order.buyer_id and held_fav >= v_order.amount_fav;
    if not found then raise exception 'buyer escrow balance unavailable'; end if;

    update public.escrow_transactions
    set status = 'refunded', released_at = now()
    where order_id = v_order.id and status = 'held';
    if not found then raise exception 'escrow transaction is not held'; end if;

    insert into public.ledger_entries(user_id, order_id, entry_type, amount_fav, idempotency_key, metadata)
    values (v_order.buyer_id, v_order.id, 'refund', v_order.amount_fav,
      'dispute-refund:' || v_order.id, jsonb_build_object('dispute_id', p_dispute_id));

    update public.orders set status = 'cancelled', updated_at = now() where id = v_order.id;
  else
    v_net := v_order.amount_fav - v_order.fee_fav;
    if v_net < 0 then raise exception 'invalid fee'; end if;

    update public.wallets
    set held_fav = held_fav - v_order.amount_fav, updated_at = now()
    where user_id = v_order.buyer_id and held_fav >= v_order.amount_fav;
    if not found then raise exception 'buyer escrow balance unavailable'; end if;

    insert into public.wallets(user_id, available_fav, held_fav)
    values (v_order.seller_id, v_net, 0)
    on conflict (user_id) do update
      set available_fav = public.wallets.available_fav + excluded.available_fav, updated_at = now();

    insert into public.platform_accounts(id, available_fav)
    values (true, v_order.fee_fav)
    on conflict (id) do update
      set available_fav = public.platform_accounts.available_fav + excluded.available_fav, updated_at = now();

    update public.escrow_transactions
    set status = 'released', released_at = now()
    where order_id = v_order.id and status = 'held';
    if not found then raise exception 'escrow transaction is not held'; end if;

    insert into public.ledger_entries(user_id, order_id, entry_type, amount_fav, idempotency_key, metadata)
    values (v_order.seller_id, v_order.id, 'sale', v_net,
      'dispute-release-seller:' || v_order.id, jsonb_build_object('dispute_id', p_dispute_id, 'fee_fav', v_order.fee_fav));

    update public.orders set status = 'completed', completed_at = now(), updated_at = now() where id = v_order.id;
  end if;

  update public.disputes
  set status = 'resolved', resolution = p_resolution, resolved_by = v_user,
      resolution_note = left(coalesce(p_note,''), 5000), resolved_at = now()
  where id = p_dispute_id;
end;
$$;

revoke all on function public.resolve_dispute(uuid,text,text) from public;
grant execute on function public.resolve_dispute(uuid,text,text) to authenticated;

-- 4) Protect verification status from self-service profile updates.
-- Verification is a trusted/moderation field, not a client-editable profile field.
create or replace function public.protect_profile_trusted_fields()
returns trigger
language plpgsql
as $$
begin
  if new.is_verified is distinct from old.is_verified then
    raise exception 'verification status can only be changed by trusted server workflows';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_trusted_fields on public.profiles;
create trigger protect_profile_trusted_fields
before update on public.profiles
for each row execute function public.protect_profile_trusted_fields();

-- 5) Reviews may be edited for rating/body, but their order and identities are
-- immutable so a reviewer cannot retarget an existing review to another seller.
create or replace function public.protect_review_identity()
returns trigger
language plpgsql
as $$
begin
  if new.order_id is distinct from old.order_id
     or new.reviewer_id is distinct from old.reviewer_id
     or new.seller_id is distinct from old.seller_id then
    raise exception 'review identity fields are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_review_identity on public.reviews;
create trigger protect_review_identity
before update on public.reviews
for each row execute function public.protect_review_identity();

-- 6) Keep review creation constrained to the current completed order state.
-- The existing RLS policy remains in force; this trigger also protects against
-- future policy mistakes because the check executes inside the database.
create or replace function public.validate_review_target()
returns trigger
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = new.order_id;
  if not found then raise exception 'order not found'; end if;
  if v_order.buyer_id <> new.reviewer_id or v_order.seller_id <> new.seller_id or v_order.status <> 'completed' then
    raise exception 'review requires a completed purchase by the buyer';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_review_target on public.reviews;
create trigger validate_review_target
before insert on public.reviews
for each row execute function public.validate_review_target();

comment on function public.release_order(uuid) is 'Buyer settlement is allowed only after seller delivery.';
comment on function public.resolve_dispute(uuid,text,text) is 'Moderator dispute resolution must settle held escrow.';
