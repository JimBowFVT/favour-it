-- Platform accounting must not use a fake auth user/profile UUID.
-- Fees belong to Favourit itself, so they get their own system account.

create table if not exists public.platform_accounts (
  id boolean primary key default true check (id = true),
  available_fav bigint not null default 0 check (available_fav >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.platform_accounts(id, available_fav)
values (true, 0)
on conflict (id) do nothing;

alter table public.platform_accounts enable row level security;

-- Platform balances are intentionally not directly readable/writable by clients.

create or replace function public.release_order(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
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
  if v_order.status not in ('funded','in_progress','delivered') then raise exception 'order cannot be released'; end if;

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

  -- Ledger entries are event records. The escrow hold already records the buyer's
  -- movement into protected funds; release records the final settlement event.
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
