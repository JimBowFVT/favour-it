-- Preserve whether an order_fav_sources row existed before later statements change PL/pgSQL FOUND.

create or replace function public.restore_order_fav(p_order_id uuid)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare
  v_order public.orders%rowtype;
  v_sources public.order_fav_sources%rowtype;
  v_sources_found boolean := false;
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
  v_sources_found := found;
  if v_sources_found then
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
    if v_sources_found then
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
