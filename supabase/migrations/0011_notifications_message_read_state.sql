-- Notifications and message read state for the MVP communication layer.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  order_id uuid references public.orders(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications(user_id, created_at desc);

create index if not exists notifications_unread_idx
  on public.notifications(user_id, created_at desc)
  where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists "Users can read own notifications" on public.notifications;
create policy "Users can read own notifications"
  on public.notifications for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can mark own notifications read" on public.notifications;
create policy "Users can mark own notifications read"
  on public.notifications for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Clients cannot manufacture notifications. Trusted server-side code should insert them.
drop policy if exists "No direct notification inserts" on public.notifications;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications
     set read_at = coalesce(read_at, now())
   where id = p_notification_id
     and user_id = auth.uid();

  return found;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.notifications
     set read_at = now()
   where user_id = auth.uid()
     and read_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;

alter table public.messages
  add column if not exists read_at timestamptz;

create index if not exists messages_unread_by_conversation_idx
  on public.messages(conversation_id, created_at desc)
  where read_at is null;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not exists (
    select 1
      from public.conversation_members
     where conversation_id = p_conversation_id
       and user_id = auth.uid()
  ) then
    raise exception 'Not a member of this conversation';
  end if;

  update public.messages
     set read_at = now()
   where conversation_id = p_conversation_id
     and sender_id <> auth.uid()
     and read_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- Automatic notifications for the most important MVP order events.
create or replace function public.notify_order_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'funded' then
      insert into public.notifications(user_id, type, title, body, order_id, actor_id)
      values (new.seller_id, 'order_funded', 'New order funded', 'A buyer funded your order in escrow.', new.id, new.buyer_id);
    elsif new.status = 'in_progress' then
      insert into public.notifications(user_id, type, title, body, order_id, actor_id)
      values (new.buyer_id, 'order_started', 'Your order has started', 'The seller has started working on your order.', new.id, new.seller_id);
    elsif new.status = 'delivered' then
      insert into public.notifications(user_id, type, title, body, order_id, actor_id)
      values (new.buyer_id, 'order_delivered', 'Your order is ready', 'The seller delivered your order. Review it and release the escrow when satisfied.', new.id, new.seller_id);
    elsif new.status = 'completed' then
      insert into public.notifications(user_id, type, title, body, order_id, actor_id)
      values (new.seller_id, 'order_completed', 'Order completed', 'The buyer approved the delivery and your FAV payout was released.', new.id, new.buyer_id);
    elsif new.status = 'disputed' then
      insert into public.notifications(user_id, type, title, body, order_id, actor_id)
      values (new.seller_id, 'order_disputed', 'Order disputed', 'This order has entered dispute review.', new.id, new.buyer_id);
    elsif new.status = 'cancelled' then
      insert into public.notifications(user_id, type, title, body, order_id, actor_id)
      values (new.seller_id, 'order_cancelled', 'Order cancelled', 'This order was cancelled.', new.id, new.buyer_id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists order_event_notifications on public.orders;
create trigger order_event_notifications
after update of status on public.orders
for each row execute function public.notify_order_event();

revoke all on function public.notify_order_event() from public;
