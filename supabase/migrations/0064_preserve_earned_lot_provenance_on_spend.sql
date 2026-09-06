-- Preserve exact seller-earning maturity provenance when earned FAV is spent internally.
-- This closes a subtle maturity bypass: without lot consumption, a user could spend old matured
-- earnings and later use the stale mature lot to unlock newly earned FAV immediately.

alter table public.order_fav_sources
  add column if not exists principal_earned_lots jsonb not null default '[]'::jsonb,
  add column if not exists buyer_fee_earned_lots jsonb not null default '[]'::jsonb;

alter table public.order_fav_sources
  drop constraint if exists order_fav_sources_principal_earned_lots_array,
  add constraint order_fav_sources_principal_earned_lots_array check (jsonb_typeof(principal_earned_lots) = 'array'),
  drop constraint if exists order_fav_sources_buyer_fee_earned_lots_array,
  add constraint order_fav_sources_buyer_fee_earned_lots_array check (jsonb_typeof(buyer_fee_earned_lots) = 'array');

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
  v_lot_remaining bigint;
  v_take bigint;
  v_lot public.fav_earned_lots%rowtype;
  v_earned_lots jsonb := '[]'::jsonb;
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

  if v_earned > 0 then
    -- Consume seller earning lots FIFO, irrespective of maturity. Internal spending must remove the
    -- same provenance that a future crypto unlock would otherwise rely on.
    v_lot_remaining := v_earned;
    for v_lot in
      select *
      from public.fav_earned_lots
      where user_id = p_user and remaining_fav > 0
      order by earned_at, id
      for update
    loop
      exit when v_lot_remaining = 0;
      v_take := least(v_lot.remaining_fav, v_lot_remaining);

      update public.fav_earned_lots
      set remaining_fav = remaining_fav - v_take
      where id = v_lot.id;

      v_earned_lots := v_earned_lots || jsonb_build_array(jsonb_build_object(
        'lot_id', v_lot.id,
        'amount_fav', v_take
      ));
      v_lot_remaining := v_lot_remaining - v_take;
    end loop;

    if v_lot_remaining <> 0 then raise exception 'earned FAV lot balance mismatch'; end if;
  end if;

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
    'legacy_fav', v_legacy,
    'earned_lots', v_earned_lots
  );
end;
$$;

revoke all on function public.consume_fav_sources(uuid,bigint) from public;

create or replace function public.restore_spent_earned_lots(
  p_user uuid,
  p_allocations jsonb,
  p_expected_amount bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_lot_id uuid;
  v_amount bigint;
  v_total bigint := 0;
  v_shortfall bigint;
begin
  if p_expected_amount < 0 then raise exception 'expected earned restore amount cannot be negative'; end if;
  if p_expected_amount = 0 then return 0; end if;
  if p_user is null then raise exception 'restore user is required'; end if;

  if p_allocations is not null and jsonb_typeof(p_allocations) = 'array' then
    for v_item in select value from jsonb_array_elements(p_allocations)
    loop
      begin
        v_lot_id := (v_item->>'lot_id')::uuid;
        v_amount := (v_item->>'amount_fav')::bigint;
      exception when others then
        raise exception 'invalid earned FAV lot allocation';
      end;

      if v_amount <= 0 then raise exception 'invalid earned FAV lot restore amount'; end if;
      if v_total + v_amount > p_expected_amount then raise exception 'earned FAV lot restore exceeds expected amount'; end if;

      update public.fav_earned_lots
      set remaining_fav = remaining_fav + v_amount
      where id = v_lot_id
        and user_id = p_user
        and remaining_fav + v_amount <= original_fav;
      if not found then raise exception 'earned FAV lot restore mismatch'; end if;

      v_total := v_total + v_amount;
    end loop;
  end if;

  -- Legacy orders created before exact lot capture are restored conservatively as non-matured
  -- internal earnings rather than granting accidental immediate crypto eligibility.
  v_shortfall := p_expected_amount - v_total;
  if v_shortfall > 0 then
    insert into public.fav_earned_lots(
      user_id, order_id, source_kind, original_fav, remaining_fav, earned_at, crypto_eligible_at
    ) values (
      p_user, null, 'manual_adjustment', v_shortfall, v_shortfall, now(), null
    );
    v_total := v_total + v_shortfall;
  end if;

  return v_total;
end;
$$;

revoke all on function public.restore_spent_earned_lots(uuid,jsonb,bigint) from public;

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
    buyer_fee_reward_fav,buyer_fee_purchased_fav,buyer_fee_earned_fav,buyer_fee_legacy_fav,
    principal_earned_lots,buyer_fee_earned_lots
  ) values(
    v_order,
    (v_principal_sources->>'reward_fav')::bigint,
    (v_principal_sources->>'purchased_fav')::bigint,
    (v_principal_sources->>'earned_fav')::bigint,
    (v_principal_sources->>'legacy_fav')::bigint,
    (v_fee_sources->>'reward_fav')::bigint,
    (v_fee_sources->>'purchased_fav')::bigint,
    (v_fee_sources->>'earned_fav')::bigint,
    (v_fee_sources->>'legacy_fav')::bigint,
    coalesce(v_principal_sources->'earned_lots','[]'::jsonb),
    coalesce(v_fee_sources->'earned_lots','[]'::jsonb)
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
  v_restored_earned bigint := 0;
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
    v_legacy := v_total;
  end if;

  update public.wallets
  set held_fav=held_fav-v_total,
      available_fav=available_fav+v_total,
      updated_at=now()
  where user_id=v_order.buyer_id and held_fav>=v_total;
  if not found then raise exception 'escrow balance mismatch'; end if;

  if v_earned > 0 then
    if found then
      v_restored_earned := public.restore_spent_earned_lots(
        v_order.buyer_id,
        coalesce(v_sources.principal_earned_lots,'[]'::jsonb) || coalesce(v_sources.buyer_fee_earned_lots,'[]'::jsonb),
        v_earned
      );
    else
      v_restored_earned := public.restore_spent_earned_lots(v_order.buyer_id,'[]'::jsonb,v_earned);
    end if;
    if v_restored_earned <> v_earned then raise exception 'earned FAV lot refund mismatch'; end if;
  end if;

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
    jsonb_build_object('buyer_fee_refunded',true,'provenance_restored',true,'earned_lots_restored',v_earned > 0)
  );

  return v_total;
end;
$$;

revoke all on function public.restore_order_fav(uuid) from public;
