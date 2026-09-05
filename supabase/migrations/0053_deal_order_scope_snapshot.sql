create or replace function public.create_order_and_hold_fav_v2(p_deal_id uuid,p_package_tier text default 'basic')
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid:=auth.uid();
  v_deal public.deals%rowtype;
  v_order uuid;
  v_fee bigint;
  v_tier text:=lower(trim(coalesce(p_package_tier,'basic')));
  v_package jsonb;
  v_amount bigint;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_deal from public.deals where id=p_deal_id for update;
  if not found or v_deal.status<>'published' then raise exception 'deal is not available'; end if;
  if v_deal.seller_id=v_user then raise exception 'seller cannot buy own deal'; end if;

  select p into v_package from jsonb_array_elements(v_deal.packages) p where lower(p->>'tier')=v_tier limit 1;
  if v_package is null then raise exception 'selected package is not available'; end if;
  v_amount:=(v_package->>'price_fav')::bigint;
  if v_amount is null or v_amount<1 then raise exception 'selected package has an invalid price'; end if;

  v_package:=v_package || jsonb_build_object(
    'deal_title',v_deal.title,
    'deal_description',v_deal.description,
    'deal_category',v_deal.category,
    'service_type',v_deal.service_type,
    'buyer_requirements',v_deal.buyer_requirements,
    'captured_at',now()
  );

  v_fee:=ceil(v_amount::numeric*public.current_fee_bps()/10000)::bigint;
  insert into public.wallets(user_id) values(v_user) on conflict(user_id) do nothing;
  update public.wallets set available_fav=available_fav-v_amount,held_fav=held_fav+v_amount,updated_at=now()
  where user_id=v_user and available_fav>=v_amount;
  if not found then raise exception 'insufficient FAV balance'; end if;

  insert into public.orders(deal_id,buyer_id,seller_id,amount_fav,fee_fav,status,package_tier,package_snapshot)
  values(v_deal.id,v_user,v_deal.seller_id,v_amount,v_fee,'funded',v_tier,v_package)
  returning id into v_order;
  insert into public.escrow_transactions(order_id,amount_fav,status) values(v_order,v_amount,'held');
  insert into public.ledger_entries(user_id,order_id,entry_type,amount_fav,idempotency_key,metadata)
  values(v_user,v_order,'escrow_hold',-v_amount,'escrow-hold:'||v_order::text,jsonb_build_object('deal_id',v_deal.id,'fee_fav',v_fee,'package_tier',v_tier,'package_title',v_package->>'title'));
  return v_order;
end;
$$;

grant execute on function public.create_order_and_hold_fav_v2(uuid,text) to authenticated;