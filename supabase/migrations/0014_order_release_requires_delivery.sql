-- Finish Mode: escrow cannot be released before seller delivery.
-- Rebuild the final release function from the platform-accounting version,
-- changing only the lifecycle guard to require delivered status.

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

  select * into v_order
    from public.orders
   where id = p_order_id
   for update;

  if not found then raise exception 'order not found'; end if;
  if v_order.buyer_id <> v_user then raise exception 'only buyer can release order'; end if;
  if v_order.status <> 'delivered' then raise exception 'order must be delivered before release'; end if;

  v_fee := v_order.fee_fav;
  v_payout := v_order.amount_fav - v_fee;
  if v_payout < 0 then raise exception 'invalid fee'; end if;

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

  update public.platform_accounts
     set available_fav = available_fav + v_fee,
         updated_at = now()
   where id = true;

  update public.orders
     set status = 'completed', completed_at = now(), updated_at = now()
   where id = v_order.id;

  update public.escrow_transactions
     set status = 'released', released_at = now()
   where order_id = v_order.id;

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

revoke all on function public.release_order(uuid) from public, anon;
grant execute on function public.release_order(uuid) to authenticated;
