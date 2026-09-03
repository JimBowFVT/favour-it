-- Favourit trust layer: disputes, moderation, reviews, and server-side deal creation.

create table public.moderators (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null default 'moderator' check (role in ('moderator','admin')),
  created_at timestamptz not null default now()
);

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique not null references public.orders(id) on delete cascade,
  opened_by uuid not null references public.profiles(id),
  reason text not null check (char_length(reason) between 10 and 2000),
  status text not null default 'open' check (status in ('open','under_review','resolved','closed')),
  resolution text check (resolution in ('refund_buyer','release_seller','none')),
  resolved_by uuid references public.profiles(id),
  resolution_note text default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.dispute_messages (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.disputes(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);

alter table public.moderators enable row level security;
alter table public.disputes enable row level security;
alter table public.dispute_messages enable row level security;

create policy "moderators can view moderator roster" on public.moderators
  for select using (user_id = auth.uid() or exists (select 1 from public.moderators m where m.user_id = auth.uid() and m.role = 'admin'));

create policy "participants can view their disputes" on public.disputes
  for select using (exists (
    select 1 from public.orders o
    where o.id = order_id and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
  ) or exists (select 1 from public.moderators m where m.user_id = auth.uid()));

create policy "participants can view dispute messages" on public.dispute_messages
  for select using (exists (
    select 1 from public.disputes d
    join public.orders o on o.id = d.order_id
    where d.id = dispute_id and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
  ) or exists (select 1 from public.moderators m where m.user_id = auth.uid()));

create policy "participants can add dispute messages" on public.dispute_messages
  for insert with check (
    sender_id = auth.uid() and exists (
      select 1 from public.disputes d
      join public.orders o on o.id = d.order_id
      where d.id = dispute_id and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
    )
  );

-- Deal creation is now server-controlled. This prevents a client from bypassing
-- economy pricing rules or publishing arbitrary deal status values.
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
  if p_price_fav <= 0 then raise exception 'invalid price'; end if;
  if p_delivery_days not between 1 and 30 then raise exception 'invalid delivery time'; end if;

  select minimum_deal_price_micro_fav into v_min from public.economy_config where id = true;
  if p_price_fav < coalesce(v_min, 10000) then
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

-- Keep direct client inserts from publishing arbitrary deals.
drop policy if exists "sellers can create deals" on public.deals;
create policy "sellers can create draft deals" on public.deals
  for insert with check (seller_id = auth.uid() and status = 'draft');

-- A seller may edit their own deal, but cannot promote a draft into a published
-- listing from the browser; publication should go through trusted workflows.
drop policy if exists "sellers can update their deals" on public.deals;
create policy "sellers can update their deals" on public.deals
  for update using (seller_id = auth.uid())
  with check (seller_id = auth.uid() and status <> 'published');

create or replace function public.open_dispute(p_order_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders;
  v_dispute uuid;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.buyer_id <> v_user and v_order.seller_id <> v_user then raise exception 'not an order participant'; end if;
  if v_order.status not in ('funded','in_progress','delivered','disputed') then raise exception 'order cannot be disputed'; end if;
  if char_length(trim(p_reason)) not between 10 and 2000 then raise exception 'invalid dispute reason'; end if;

  insert into public.disputes(order_id, opened_by, reason)
  values (p_order_id, v_user, trim(p_reason))
  on conflict (order_id) do update set reason = excluded.reason, status = 'open', resolved_by = null, resolved_at = null
  returning id into v_dispute;

  update public.orders set status = 'disputed', updated_at = now() where id = p_order_id;
  return v_dispute;
end;
$$;

revoke all on function public.open_dispute(uuid,text) from public;
grant execute on function public.open_dispute(uuid,text) to authenticated;

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
  if p_resolution not in ('refund_buyer','release_seller','none') then raise exception 'invalid resolution'; end if;

  select * into v_dispute from public.disputes where id = p_dispute_id for update;
  if not found then raise exception 'dispute not found'; end if;
  if v_dispute.status in ('resolved','closed') then raise exception 'dispute already resolved'; end if;
  select * into v_order from public.orders where id = v_dispute.order_id for update;
  if v_order.status <> 'disputed' then raise exception 'order is not disputed'; end if;

  if p_resolution = 'refund_buyer' then
    update public.wallets set available_fav = available_fav + v_order.amount_fav, held_fav = held_fav - v_order.amount_fav, updated_at = now()
      where user_id = v_order.buyer_id and held_fav >= v_order.amount_fav;
    if not found then raise exception 'buyer escrow balance unavailable'; end if;
    update public.escrow_transactions set status = 'refunded', released_at = now() where order_id = v_order.id;
    insert into public.ledger_entries(user_id, order_id, entry_type, amount_fav, idempotency_key, metadata)
      values (v_order.buyer_id, v_order.id, 'refund', v_order.amount_fav, 'dispute-refund:' || v_order.id, jsonb_build_object('dispute_id', p_dispute_id));
    update public.orders set status = 'cancelled', updated_at = now() where id = v_order.id;
  elsif p_resolution = 'release_seller' then
    v_fee := round(v_order.amount_fav * current_fee_bps() / 10000.0)::bigint;
    v_net := v_order.amount_fav - v_fee;
    update public.wallets set held_fav = held_fav - v_order.amount_fav, updated_at = now()
      where user_id = v_order.buyer_id and held_fav >= v_order.amount_fav;
    if not found then raise exception 'buyer escrow balance unavailable'; end if;
    update public.wallets set available_fav = available_fav + v_net, updated_at = now() where user_id = v_order.seller_id;
    insert into public.platform_accounts(available_fav) values (v_fee) on conflict do update set available_fav = public.platform_accounts.available_fav + excluded.available_fav;
    update public.escrow_transactions set status = 'released', released_at = now() where order_id = v_order.id;
    insert into public.ledger_entries(user_id, order_id, entry_type, amount_fav, idempotency_key, metadata)
      values (v_order.seller_id, v_order.id, 'sale', v_net, 'dispute-release-seller:' || v_order.id, jsonb_build_object('dispute_id', p_dispute_id));
    update public.orders set status = 'completed', completed_at = now(), updated_at = now() where id = v_order.id;
  else
    update public.orders set status = 'cancelled', updated_at = now() where id = v_order.id;
  end if;

  update public.disputes set status = 'resolved', resolution = p_resolution, resolved_by = v_user, resolution_note = coalesce(p_note,''), resolved_at = now() where id = p_dispute_id;
end;
$$;

revoke all on function public.resolve_dispute(uuid,text,text) from public;
grant execute on function public.resolve_dispute(uuid,text,text) to authenticated;

-- Reviews: only a buyer who completed an order may review that order's seller.
create policy "buyers can create completed order reviews" on public.reviews
  for insert with check (
    reviewer_id = auth.uid() and exists (
      select 1 from public.orders o
      where o.id = order_id and o.buyer_id = auth.uid() and o.seller_id = seller_id and o.status = 'completed'
    )
  );

create policy "review authors can update their review" on public.reviews
  for update using (reviewer_id = auth.uid()) with check (reviewer_id = auth.uid());

create index disputes_status_idx on public.disputes(status, created_at desc);
create index dispute_messages_dispute_idx on public.dispute_messages(dispute_id, created_at);
create index moderators_role_idx on public.moderators(role);
