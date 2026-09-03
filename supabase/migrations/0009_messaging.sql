create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create index if not exists conversation_members_user_idx on public.conversation_members(user_id, conversation_id);
create index if not exists messages_conversation_idx on public.messages(conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

create policy "conversation participants can view conversations" on public.conversations
  for select using (exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = id and cm.user_id = auth.uid()
  ));

create policy "participants can view conversation members" on public.conversation_members
  for select using (exists (
    select 1 from public.conversation_members own
    where own.conversation_id = conversation_id and own.user_id = auth.uid()
  ));

create policy "participants can view messages" on public.messages
  for select using (exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id and cm.user_id = auth.uid()
  ));

create policy "participants can send messages" on public.messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = messages.conversation_id and cm.user_id = auth.uid()
    )
  );

create or replace function public.get_or_create_order_conversation(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders%rowtype;
  v_conversation uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.buyer_id <> v_user and v_order.seller_id <> v_user then
    raise exception 'You are not a participant in this order';
  end if;

  select id into v_conversation from public.conversations where order_id = p_order_id;
  if v_conversation is null then
    insert into public.conversations(order_id) values (p_order_id) returning id into v_conversation;
    insert into public.conversation_members(conversation_id, user_id)
      values (v_conversation, v_order.buyer_id), (v_conversation, v_order.seller_id)
      on conflict do nothing;
  end if;
  return v_conversation;
end;
$$;

create or replace function public.send_order_message(p_order_id uuid, p_body text)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation uuid;
  v_message public.messages;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 5000 then
    raise exception 'Message must be between 1 and 5000 characters';
  end if;
  v_conversation := public.get_or_create_order_conversation(p_order_id);
  insert into public.messages(conversation_id, sender_id, body)
    values (v_conversation, auth.uid(), v_body)
    returning * into v_message;
  update public.conversations set updated_at = now() where id = v_conversation;
  return v_message;
end;
$$;

grant execute on function public.get_or_create_order_conversation(uuid) to authenticated;
grant execute on function public.send_order_message(uuid,text) to authenticated;
