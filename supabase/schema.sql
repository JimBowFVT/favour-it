-- Favourit database foundation
-- Source of truth for balances is the ledger; wallet balance is a cached value verified by transactions.

create extension if not exists pgcrypto;

create type public.order_status as enum ('pending','funded','in_progress','delivered','completed','cancelled','disputed','refunded');
create type public.ledger_entry_type as enum ('daily_reward','purchase','sale','order_hold','escrow_release','refund','fee','adjustment');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text not null default '',
  bio text not null default '',
  avatar_url text,
  rating numeric(3,2) not null default 0 check (rating >= 0 and rating <= 5),
  review_count integer not null default 0 check (review_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id),
  title text not null check (char_length(title) between 5 and 140),
  description text not null default '',
  category text not null,
  price_fav bigint not null check (price_fav > 0),
  delivery_days integer not null default 3 check (delivery_days between 1 and 90),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id),
  buyer_id uuid not null references public.profiles(id),
  seller_id uuid not null references public.profiles(id),
  price_fav bigint not null check (price_fav > 0),
  status public.order_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz,
  completed_at timestamptz
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  order_id uuid references public.orders(id),
  entry_type public.ledger_entry_type not null,
  amount bigint not null check (amount <> 0),
  description text not null default '',
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create index deals_category_idx on public.deals(category) where is_active = true;
create index deals_seller_idx on public.deals(seller_id);
create index orders_buyer_idx on public.orders(buyer_id, created_at desc);
create index orders_seller_idx on public.orders(seller_id, created_at desc);
create index ledger_user_idx on public.ledger_entries(user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.deals enable row level security;
alter table public.orders enable row level security;
alter table public.ledger_entries enable row level security;

create policy "profiles are publicly readable" on public.profiles for select using (true);
create policy "users update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "users insert own profile" on public.profiles for insert with check (auth.uid() = id);

create policy "wallet owner can read wallet" on public.wallets for select using (auth.uid() = user_id);
create policy "active deals are publicly readable" on public.deals for select using (is_active = true or auth.uid() = seller_id);
create policy "seller manages own deals" on public.deals for insert with check (auth.uid() = seller_id);
create policy "seller updates own deals" on public.deals for update using (auth.uid() = seller_id) with check (auth.uid() = seller_id);
create policy "buyer or seller can read orders" on public.orders for select using (auth.uid() = buyer_id or auth.uid() = seller_id);
create policy "user can read own ledger" on public.ledger_entries for select using (auth.uid() = user_id);

-- Balance-changing operations must be implemented as SECURITY DEFINER functions/API transactions.
-- Clients must never INSERT ledger entries or UPDATE wallet balances directly.
