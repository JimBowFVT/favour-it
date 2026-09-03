-- Platform accounting fix
-- The platform is not an auth user, so fees must not use a fake auth/profile UUID.

create table if not exists public.platform_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_wallets (
  account_id uuid primary key references public.platform_accounts(id) on delete cascade,
  available_fav bigint not null default 0 check (available_fav >= 0),
  held_fav bigint not null default 0 check (held_fav >= 0),
  updated_at timestamptz not null default now()
);

insert into public.platform_accounts(id, name)
values ('00000000-0000-0000-0000-000000000001', 'Favourit Platform')
on conflict (id) do nothing;

insert into public.platform_wallets(account_id)
values ('00000000-0000-0000-0000-000000000001')
on conflict (account_id) do nothing;

-- ledger_entries originally required every entry to belong to a user profile.
-- Platform fees are system accounting entries, so allow either a user or platform account.
alter table public.ledger_entries
  add column if not exists platform_account_id uuid references public.platform_accounts(id);

alter table public.ledger_entries
  alter column user_id drop not null;

alter table public.ledger_entries
  drop constraint if exists ledger_entries_account_owner_check;

alter table public.ledger_entries
  add constraint ledger_entries_account_owner_check
  check (user_id is not null or platform_account_id is not null);

alter table public.platform_wallets enable row level security;
alter table public.platform_accounts enable row level security;

revoke all on public.platform_accounts from anon, authenticated;
revoke all on public.platform_wallets from anon, authenticated;

create or replace function public.release_order(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders%rowtype;
  v_payout bigint;
  v_fee bigint;
  v_platform uuid := '00000000-0000-0000-0000-000000000001'::uuid;
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
  set held_fav = held_fav - v_order.amount_fav, updated_at = now()
  where user_id = v_order.buyer_id and held_fav >= v_order.amount_fav;
  if not found then raise exception 'escrow balance mismatch'; end if;

  insert into public.wallets(user_id, available_fav, held_fav)
  values (v_order.seller_id, v_payout, 0)
  on conflict (user_id) do update
    set available_fav = public.wallets.available_fav + excluded.available_fav,
        updated_at = now();

  update public.platform_wallets
  set available_fav = available_fav + v_fee,
      updated_at = now()
  where account_id = v_platform;

  update public.orders
  set status = 'completed', completed_at = now(), updated_at = now()
  where id = v_order.id;

  update public.escrow_transactions
  set status = 'released', released_at = now()
  where order_id = v_order.id;

  insert into public.ledger_entries(user_id, order_id, entry_type, amount_fav, idempotency_key, metadata)
  values
    (v_order.buyer_id, v_order.id, 'escrow_release', -v_order.amount_fav,
      'escrow-release-buyer-v2:' || v_order.id::text,
      jsonb_build_object('completed', true)),
    (v_order.seller_id, v_order.id, 'sale', v_payout,
      'sale-v2:' || v_order.id::text,
      jsonb_build_object('gross_fav', v_order.amount_fav, 'fee_fav', v_fee)),
    (null, v_order.id, 'fee', v_fee,
      'fee-v2:' || v_order.id::text,
      jsonb_build_object('platform_fee', true, 'platform_account_id', v_platform));

  update public.ledger_entries
  set platform_account_id = v_platform
  where idempotency_key = 'fee-v2:' || v_order.id::text;

  return true;
end;
$$;

grant execute on function public.release_order(uuid) to authenticated;
