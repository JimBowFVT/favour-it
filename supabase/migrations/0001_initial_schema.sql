create extension if not exists pgcrypto;

create type public.deal_status as enum ('draft','published','paused','archived');
create type public.order_status as enum ('pending','funded','in_progress','delivered','completed','disputed','cancelled');
create type public.ledger_entry_type as enum ('daily_reward','premium_reward','purchase','escrow_hold','escrow_release','refund','fee','sale','adjustment');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null,
  bio text default '',
  avatar_url text,
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  available_fav bigint not null default 0 check (available_fav >= 0),
  held_fav bigint not null default 0 check (held_fav >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  description text not null check (char_length(description) between 10 and 5000),
  category text not null,
  price_fav bigint not null check (price_fav >= 10),
  delivery_days integer not null check (delivery_days between 1 and 30),
  status public.deal_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id),
  buyer_id uuid not null references public.profiles(id),
  seller_id uuid not null references public.profiles(id),
  amount_fav bigint not null check (amount_fav > 0),
  fee_fav bigint not null default 0 check (fee_fav >= 0),
  status public.order_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (buyer_id <> seller_id)
);

create table public.escrow_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique not null references public.orders(id) on delete cascade,
  amount_fav bigint not null check (amount_fav > 0),
  status text not null default 'held' check (status in ('held','released','refunded','partially_settled')),
  created_at timestamptz not null default now(),
  released_at timestamptz
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  order_id uuid references public.orders(id),
  entry_type public.ledger_entry_type not null,
  amount_fav bigint not null check (amount_fav <> 0),
  idempotency_key text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.reward_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reward_date date not null,
  amount_fav bigint not null check (amount_fav > 0),
  created_at timestamptz not null default now(),
  unique (user_id, reward_date)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique not null references public.orders(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  seller_id uuid not null references public.profiles(id),
  rating integer not null check (rating between 1 and 5),
  body text default '',
  created_at timestamptz not null default now()
);

create table public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, deal_id)
);

create index deals_seller_idx on public.deals(seller_id);
create index deals_category_status_idx on public.deals(category, status);
create index orders_buyer_idx on public.orders(buyer_id, created_at desc);
create index orders_seller_idx on public.orders(seller_id, created_at desc);
create index ledger_user_idx on public.ledger_entries(user_id, created_at desc);
create index reviews_seller_idx on public.reviews(seller_id);

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.deals enable row level security;
alter table public.orders enable row level security;
alter table public.escrow_transactions enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.reward_claims enable row level security;
alter table public.reviews enable row level security;
alter table public.favorites enable row level security;

create policy "public can view published deals" on public.deals
  for select using (status = 'published' or seller_id = auth.uid());

create policy "users can view their profile" on public.profiles
  for select using (id = auth.uid());

create policy "users can update their profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy "users can view their wallet" on public.wallets
  for select using (user_id = auth.uid());

create policy "buyers and sellers can view their orders" on public.orders
  for select using (buyer_id = auth.uid() or seller_id = auth.uid());

create policy "participants can view escrow" on public.escrow_transactions
  for select using (exists (
    select 1 from public.orders o
    where o.id = order_id and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
  ));

create policy "users can view their ledger" on public.ledger_entries
  for select using (user_id = auth.uid());

create policy "users can view their reward claims" on public.reward_claims
  for select using (user_id = auth.uid());

create policy "users can view seller reviews" on public.reviews
  for select using (true);

create policy "users can manage their favorites" on public.favorites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Wallet balances, rewards, escrow, fees and order transitions must be changed
-- through trusted server-side functions/API routes. No client-side UPDATE policy
-- is intentionally provided for wallets or ledger entries.
