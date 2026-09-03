-- Favourit transaction engine v1
-- All money-like state transitions happen inside database transactions.
-- Amounts are micro-FAV units: 1 FAV = 1,000,000 units.

-- Public profiles need to be discoverable while private fields remain absent
-- from this table. The policy exposes only rows; callers should select the
-- public columns they need.
drop policy if exists "users can view their profile" on public.profiles;
create policy "public can view public profiles"
  on public.profiles for select using (true);

-- Sellers can create and maintain their own deals. Publishing still requires
-- the seller to own the row; marketplace reads remain limited to published
-- deals through the existing select policy.
create policy "sellers can create their own deals"
  on public.deals for insert
  with check (seller_id = auth.uid());

create policy "sellers can update their own deals"
  on public.deals for update
  using (seller_id = auth.uid())
  with check (seller_id = auth.uid());

create policy "sellers can delete their own deals"
  on public.deals for delete
  using (seller_id = auth.uid());

-- Prevent a client from directly writing orders. Order creation/release/refund
-- are handled by security-definer functions below.

-- Keep timestamps consistent for mutable records.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists wallets_set_updated_at on public.wallets;
create trigger wallets_set_updated_at before update on public.wallets
for each row execute function public.set_updated_at();

drop trigger if exists deals_set_updated_at on public.deals;
create trigger deals_set_updated_at before update on public.deals
for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders
for each row execute function public.set_updated_at();

-- Helper: current fee in basis points.
create or replace function public.current_fee_bps()
returns integer
language sql
stable
as $$
  select transaction_fee_bps from public.economy_config where id = true;
$$;

-- Create an order and atomically move the buyer's FAV into escrow.
create or replace function public.create_order_and_hold_fav(p_deal_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_deal public.deals%rowtype;
  v_order_id uuid;
  v_fee bigint;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_deal
  from public.deals
  where id = p_deal_id
  for update;

  if not found then raise exception 'deal not found'; end if;
  if v_deal.status <> 'published' then raise exception 'deal is not available'; end if;
  if v_deal.seller_id = v_user then raise exception 'seller cannot buy own deal'; end if;

  v_fee := ceil(v_deal.price_fav::numeric * public.current_fee_bps() / 10000)::bigint;

  -- Lock the buyer wallet before checking/updating its balance.
  insert into public.wallets(user_id, available_fav, held_fav)
  values (v_user, 0, 0)
  on conflict (user_id) do nothing;

  update public.wallets
  set available_fav = available_fav - v_deal.price_fav,
      held_fav = held_fav + v_deal.price_fav,
      updated_at = now()
  where user_id = v_user
    and available_fav >= v_deal.price_fav;

  if not found then raise exception 'insufficient FAV balance'; end if;

  insert into public.orders(deal_id, buyer_id, seller_id, amount_fav, fee_fav, status)
  values (v_deal.id, v_user, v_deal.seller_id, v_deal.price_fav, v_fee, 'funded')
  returning id into v_order_id;

  insert into public.escrow_transactions(order_id, amount_fav, status)
  values (v_order_id, v_deal.price_fav, 'held');

  insert into public.ledger_entries(user_id, order_id, entry_type, amount_fav, idempotency_key, metadata)
  values (v_user, v_order_id, 'escrow_hold', -v_deal.price_fav,
          'escrow-hold:' || v_order_id::text,
          jsonb_build_object('deal_id', v_deal.id, 'fee_fav', v_fee));

  return v_order_id;
end;
$$;

-- Release escrow after the buyer or an authorized moderator completes the order.
-- The MVP authorization allows the buyer to release; moderator/admin integration
-- can be added once the moderation role tables exist.
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
  if v_order.status not in ('funded','in_progress','delivered') then
    raise exception 'order cannot be released';
  end if;

  v_fee := v_order.fee_fav;
  v_payout := v_order.amount_fav - v_fee;

  -- Buyer escrow decreases; seller receives net payout. The fee remains in the
  -- platform accounting layer and is represented by a fee ledger entry.
  update public.wallets
  set held_fav = held_fav - v_order.amount_fav,
      updated_at = now()
  where user_id = v_order.buyer_id
    and held_fav >= v_order.amount_fav;
  if not found then raise exception 'escrow balance mismatch'; end if;

  insert into public.wallets(user_id, available_fav, held_fav)
  values (v_order.seller_id, v_payout, 0)
  on conflict (user_id) do update
    set available_fav = public.wallets.available_fav + excluded.available_fav,
        updated_at = now();

  update public.orders
  set status = 'completed', completed_at = now(), updated_at = now()
  where id = v_order.id;

  update public.escrow_transactions
  set status = 'released', released_at = now()
  where order_id = v_order.id;

  insert into public.ledger_entries(user_id, order_id, entry_type, amount_fav, idempotency_key, metadata)
  values
    (v_order.buyer_id, v_order.id, 'escrow_release', v_order.amount_fav,
     'escrow-release-buyer:' || v_order.id::text, jsonb_build_object('completed', true)),
    (v_order.seller_id, v_order.id, 'sale', v_payout,
     'sale:' || v_order.id::text, jsonb_build_object('gross_fav', v_order.amount_fav, 'fee_fav', v_fee)),
    (v_order.seller_id, v_order.id, 'fee', -v_fee,
     'fee:' || v_order.id::text, jsonb_build_object('platform_fee', true));

  return true;
end;
$$;

-- Refund a funded order back to the buyer. This is intentionally narrow for
-- MVP; a dispute/moderation function can later authorize partial settlements.
create or replace function public.refund_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.buyer_id <> v_user then raise exception 'only buyer can request this refund'; end if;
  if v_order.status not in ('funded','in_progress','disputed') then
    raise exception 'order cannot be refunded';
  end if;

  update public.wallets
  set held_fav = held_fav - v_order.amount_fav,
      available_fav = available_fav + v_order.amount_fav,
      updated_at = now()
  where user_id = v_order.buyer_id
    and held_fav >= v_order.amount_fav;
  if not found then raise exception 'escrow balance mismatch'; end if;

  update public.orders set status = 'cancelled', updated_at = now() where id = v_order.id;
  update public.escrow_transactions
  set status = 'refunded', released_at = now()
  where order_id = v_order.id;

  insert into public.ledger_entries(user_id, order_id, entry_type, amount_fav, idempotency_key, metadata)
  values (v_order.buyer_id, v_order.id, 'refund', v_order.amount_fav,
          'refund:' || v_order.id::text, jsonb_build_object('reason', 'order_refund'));

  return true;
end;
$$;

revoke all on function public.create_order_and_hold_fav(uuid) from public;
revoke all on function public.release_order(uuid) from public;
revoke all on function public.refund_order(uuid) from public;
grant execute on function public.create_order_and_hold_fav(uuid) to authenticated;
grant execute on function public.release_order(uuid) to authenticated;
grant execute on function public.refund_order(uuid) to authenticated;

comment on function public.create_order_and_hold_fav(uuid) is 'Atomically funds an order and moves buyer FAV into escrow.';
comment on function public.release_order(uuid) is 'Atomically releases escrow and pays seller net of platform fee.';
comment on function public.refund_order(uuid) is 'Atomically refunds an eligible order from escrow to the buyer.';
