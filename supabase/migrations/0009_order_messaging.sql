-- Order messaging: participants can communicate inside an order without exposing
-- arbitrary user-to-user message insertion to the client.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create index if not exists conversations_order_idx on public.conversations(order_id);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists conversations_participant_select on public.conversations;
create policy conversations_participant_select on public.conversations
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = conversations.order_id
        and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
    )
  );

drop policy if exists messages_participant_select on public.messages;
create policy messages_participant_select on public.messages
  for select to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      join public.orders o on o.id = c.order_id
      where c.id = messages.conversation_id
        and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
    )
  );

create or replace function public.get_or_create_order_conversation(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_buyer uuid;
  v_seller uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select buyer_id, seller_id into v_buyer, v_seller
  from public.orders
  where id = p_order_id
  for update;

  if v_buyer is null then
    raise exception 'Order not found';
  end if;

  if auth.uid() <> v_buyer and auth.uid() <> v_seller then
    raise exception 'Only order participants can access this conversation';
  end if;

  select id into v_conversation_id
  from public.conversations
  where order_id = p_order_id;

  if v_conversation_id is null then
    insert into public.conversations(order_id)
    values (p_order_id)
    on conflict (order_id) do nothing
    returning id into v_conversation_id;

    if v_conversation_id is null then
      select id into v_conversation_id from public.conversations where order_id = p_order_id;
    end if;
  end if;

  return v_conversation_id;
end;
$$;

grant execute on function public.get_or_create_order_conversation(uuid) to authenticated;

authorization default privileges in schema public;

create or replace function public.send_order_message(p_order_id uuid, p_body text)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_message public.messages;
  v_body text := trim(coalesce(p_body, ''));
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 5000 then
    raise exception 'Message must contain between 1 and 5000 characters';
  end if;

  v_conversation_id := public.get_or_create_order_conversation(p_order_id);

  insert into public.messages(conversation_id, sender_id, body)
  values (v_conversation_id, auth.uid(), v_body)
  returning * into v_message;

  return v_message;
end;
$$;

grant execute on function public.send_order_message(uuid, text) to authenticated;
