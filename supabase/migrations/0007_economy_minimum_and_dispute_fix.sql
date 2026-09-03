-- Keep marketplace pricing aligned with the same value-based FAV model as rewards.
alter table public.economy_config
  add column if not exists minimum_deal_price_usd numeric(30, 8) not null default 1
  check (minimum_deal_price_usd > 0);

update public.economy_config
set minimum_deal_price_usd = 1
where id = true;

create or replace function public.minimum_deal_price_micro_fav()
returns bigint
language sql
stable
as $$
  select greatest(1, round((minimum_deal_price_usd / reference_usd_per_fav) * 1000000)::bigint)
  from public.economy_config
  where id = true;
$$;

create or replace function public.create_deal(
  p_title text,
  p_description text,
  p_category text,
  p_price_fav bigint,
  p_delivery_days integer
)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_deal public.deals;
  v_min bigint;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if char_length(trim(p_title)) not between 3 and 120 then raise exception 'invalid title'; end if;
  if char_length(trim(p_description)) not between 10 and 5000 then raise exception 'invalid description'; end if;
  if char_length(trim(p_category)) < 1 then raise exception 'invalid category'; end if;
  if p_price_fav <= 0 then raise exception 'invalid price'; end if;
  if p_delivery_days not between 1 and 30 then raise exception 'invalid delivery time'; end if;

  v_min := public.minimum_deal_price_micro_fav();
  if p_price_fav < v_min then
    raise exception 'price is below the current minimum';
  end if;

  insert into public.deals(seller_id, title, description, category, price_fav, delivery_days, status)
  values (v_user, trim(p_title), trim(p_description), trim(p_category), p_price_fav, p_delivery_days, 'published')
  returning * into v_deal;
  return v_deal;
end;
$$;

revoke all on function public.create_deal(text,text,text,bigint,integer) from public;
grant execute on function public.create_deal(text,text,text,bigint,integer) to authenticated;

comment on column public.economy_config.minimum_deal_price_usd is 'Minimum marketplace deal value in USD-equivalent terms; converted to micro-FAV at the current internal reference value.';

-- A moderator choosing "none" must not silently cancel an order while its FAV is
-- still held. The order remains disputed until a real financial resolution occurs.
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
  v_dispute public.disputes;
  v_order public.orders;
  v_fee bigint;
  v_net bigint;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.moderators m where m.user_id = v_user) then raise exception 'moderator access required'; end if;
  if p_resolution not in ('refund_buyer','release_seller') then raise exception 'resolution must refund_buyer or release_seller'; end if;

  select * into v_dispute from public.disputes where id = p_dispute_id for update;
  if not found then raise exception 'dispute not found'; end if;
  if v_dispute.status in ('resolved','closed') then raise exception 'dispute already resolved'; end if;
  select * into v_order from public.orders where id = v_dispute.order_id for update;
  if v_order.status <> 'disputed' then raise exception 'order is not disputed'; end if;

  if p_resolution = 'refund_buyer' then
    update public.wallets
      set available_fav = available_fav + v_order.amount_fav,
          held_fav = held_fav - v_order.amount_fav,
          updated_at = now()
      where user_id = v_order.buyer_id and held_fav >= v_order.amount_fav;
    if not found then raise exception 'buyer escrow balance unavailable'; end if;
    update public.escrow_transactions set status = 'refunded', released_at = now() where order_id = v_order.id;
    insert into public.ledger_entries(user_id, order_id, entry_type, amount_fav, idempotency_key, metadata)
      values (v_order.buyer_id, v_order.id, 'refund', v_order.amount_fav, 'dispute-refund:' || v_order.id::text, jsonb_build_object('dispute_id', p_dispute_id));
    update public.orders set status = 'cancelled', updated_at = now() where id = v_order.id;
  else
    v_fee := v_order.fee_fav;
    v_net := v_order.amount_fav - v_fee;
    update public.wallets
      set held_fav = held_fav - v_order.amount_fav,
          updated_at = now()
      where user_id = v_order.buyer_id and held_fav >= v_order.amount_fav;
    if not found then raise exception 'buyer escrow balance unavailable'; end if;
    insert into public.wallets(user_id, available_fav, held_fav)
      values (v_order.seller_id, v_net, 0)
      on conflict (user_id) do update
        set available_fav = public.wallets.available_fav + excluded.available_fav,
            updated_at = now();
    update public.platform_accounts
      set available_fav = available_fav + v_fee, updated_at = now()
      where id = true;
    update public.escrow_transactions set status = 'released', released_at = now() where order_id = v_order.id;
    insert into public.ledger_entries(user_id, order_id, entry_type, amount_fav, idempotency_key, metadata)
      values (v_order.seller_id, v_order.id, 'sale', v_net, 'dispute-release-seller:' || v_order.id::text, jsonb_build_object('dispute_id', p_dispute_id, 'fee_fav', v_fee));
    update public.orders set status = 'completed', completed_at = now(), updated_at = now() where id = v_order.id;
  end if;

  update public.disputes
    set status = 'resolved', resolution = p_resolution, resolved_by = v_user,
        resolution_note = coalesce(p_note,''), resolved_at = now()
    where id = p_dispute_id;
end;
$$;

revoke all on function public.resolve_dispute(uuid,text,text) from public;
grant execute on function public.resolve_dispute(uuid,text,text) to authenticated;
