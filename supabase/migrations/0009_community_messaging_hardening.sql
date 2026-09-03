-- Community messaging: conversations are always between known users, and order
-- conversations are scoped to the buyer/seller on that order.
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_conversations (
  order_id uuid primary key references public.orders(id) on delete cascade,
  conversation_id uuid unique not null references public.conversations(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.order_conversations enable row level security;

create policy "members can view conversations" on public.conversations
  for select using (exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = id and cm.user_id = auth.uid()
  ));

create policy "members can view conversation members" on public.conversation_members
  for select using (exists (
    select 1 from public.conversation_members own
    where own.conversation_id = conversation_id and own.user_id = auth.uid()
  ));

create policy "members can view messages" on public.messages
  for select using (exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id and cm.user_id = auth.uid()
  ));

create policy "members can send messages" on public.messages
  for insert with check (
    sender_id = auth.uid() and exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = messages.conversation_id and cm.user_id = auth.uid()
    )
  );

create policy "participants can view order conversations" on public.order_conversations
  for select using (exists (
    select 1 from public.orders o
    where o.id = order_id and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
  ));

create or replace function public.get_or_create_order_conversation(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders;
  v_conversation uuid;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'order not found'; end if;
  if v_order.buyer_id <> v_user and v_order.seller_id <> v_user then raise exception 'not an order participant'; end if;

  select conversation_id into v_conversation from public.order_conversations where order_id = p_order_id;
  if v_conversation is not null then return v_conversation; end if;

  insert into public.conversations default values returning id into v_conversation;
  insert into public.conversation_members(conversation_id, user_id)
    values (v_conversation, v_order.buyer_id), (v_conversation, v_order.seller_id);
  insert into public.order_conversations(order_id, conversation_id)
    values (p_order_id, v_conversation);
  return v_conversation;
end;
$$;

revoke all on function public.get_or_create_order_conversation(uuid) from public;
grant execute on function public.get_or_create_order_conversation(uuid) to authenticated;

create or replace function public.set_conversation_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger conversations_updated_at before update on public.conversations
for each row execute function public.set_conversation_updated_at();

create trigger messages_updated_at before update on public.messages
for each row execute function public.set_conversation_updated_at();

create index conversation_members_user_idx on public.conversation_members(user_id, conversation_id);
create index messages_conversation_idx on public.messages(conversation_id, created_at);

-- Do not allow dispute conversations to keep receiving messages after resolution.
drop policy if exists "participants can add dispute messages" on public.dispute_messages;
create policy "participants can add active dispute messages" on public.dispute_messages
  for insert with check (
    sender_id = auth.uid() and exists (
      select 1 from public.disputes d
      join public.orders o on o.id = d.order_id
      where d.id = dispute_id
        and d.status in ('open','under_review')
        and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
    )
  );

-- Exactly the onboarding window gets the zero-value onboarding reward.
create or replace function public.claim_daily_reward()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_created_at timestamptz;
  v_days integer;
  v_usd numeric;
  v_amount bigint;
  v_claim_id uuid;
  v_is_premium boolean := false;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select created_at into v_created_at from public.profiles where id = v_user;
  if v_created_at is null then raise exception 'profile not found'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || current_date::text, 0));
  if exists (select 1 from public.reward_claims where user_id = v_user and reward_date = current_date) then
    raise exception 'daily reward already claimed';
  end if;

  v_days := greatest(0, floor(extract(epoch from (now() - v_created_at)) / 86400)::integer);
  select exists (select 1 from public.premium_memberships pm where pm.user_id = v_user and pm.active_until > now()) into v_is_premium;

  select case
    when v_days < onboarding_reward_days then onboarding_daily_reward_usd
    when v_is_premium then premium_daily_reward_usd
    else standard_daily_reward_usd
  end into v_usd
  from public.economy_config where id = true;

  v_amount := public.usd_to_micro_fav(v_usd);
  insert into public.reward_claims(user_id, reward_date, amount_fav) values (v_user, current_date, v_amount) returning id into v_claim_id;
  insert into public.wallets(user_id, available_fav)
    values (v_user, v_amount)
    on conflict (user_id) do update set available_fav = public.wallets.available_fav + excluded.available_fav, updated_at = now();

  if v_amount > 0 then
    insert into public.ledger_entries(user_id, entry_type, amount_fav, idempotency_key, metadata)
    values (v_user, case when v_is_premium then 'premium_reward'::public.ledger_entry_type else 'daily_reward'::public.ledger_entry_type end,
      v_amount, 'daily-reward:' || v_user::text || ':' || current_date::text,
      jsonb_build_object('reward_usd', v_usd, 'reference_based', true, 'claim_id', v_claim_id, 'premium', v_is_premium));
  end if;
  return v_amount;
end;
$$;

revoke all on function public.claim_daily_reward() from public;
grant execute on function public.claim_daily_reward() to authenticated;

-- Avoid duplicate seller reviews even if an old/retried client submits twice.
create unique index if not exists reviews_order_reviewer_idx on public.reviews(order_id, reviewer_id);
