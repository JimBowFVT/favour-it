-- Platform accounting v1
-- Platform fees are system accounting, not a fake auth user/profile.

create table if not exists public.platform_accounts (
  id boolean primary key default true check (id = true),
  fee_balance_fav bigint not null default 0 check (fee_balance_fav >= 0),
  updated_at timestamptz not null default now()
);

insert into public.platform_accounts(id, fee_balance_fav)
values (true, 0)
on conflict (id) do nothing;

create table if not exists public.platform_fee_entries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  amount_fav bigint not null check (amount_fav > 0),
  created_at timestamptz not null default now()
);

alter table public.platform_accounts enable row level security;
alter table public.platform_fee_entries enable row level security;

create policy "authenticated users cannot directly read platform accounting"
  on public.platform_accounts for select using (false);
create policy "authenticated users cannot directly read platform fee entries"
  on public.platform_fee_entries for select using (false);

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

  insert into public.platform_fee_entries(order_id, amount_fav)
  values (v_order.id, v_fee)
  on conflict (order_id) do nothing;

  update public.platform_accounts
  set fee_balance_fav = fee_balance_fav + v_fee,
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
    (v_order.buyer_id, v_order.id, 'escrow_release', v_order.amount_fav,
      'escrow-release-buyer:' || v_order.id::text,
      jsonb_build_object('completed', true)),
    (v_order.seller_id, v_order.id, 'sale', v_payout,
      'sale:' || v_order.id::text,
      jsonb_build_object('gross_fav', v_order.amount_fav, 'fee_fav', v_fee));

  insert into public.ledger_entries(user_id, order_id, entry_type, amount_fav, idempotency_key, metadata)
  values
    (v_order.seller_id, v_order.id, 'fee', -v_fee,
      'fee-seller:' || v_order.id::text,
      jsonb_build_object('platform_fee', true));

  return true;
end;
$$;

revoke all on function public.release_order(uuid) from public;
grant execute on function public.release_order(uuid) to authenticated;
