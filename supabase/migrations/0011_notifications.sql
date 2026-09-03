-- In-app notifications for important marketplace and messaging events.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (char_length(trim(type)) between 1 and 80),
  title text not null check (char_length(trim(title)) between 1 and 160),
  body text not null default '' check (char_length(body) <= 1000),
  order_id uuid references public.orders(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;
create policy "users can view their notifications" on public.notifications for select using (user_id = auth.uid());
create policy "users can update their notifications" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create index notifications_user_created_idx on public.notifications(user_id, created_at desc);
create index notifications_unread_idx on public.notifications(user_id, created_at desc) where read_at is null;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update public.notifications set read_at = coalesce(read_at, now()) where id = p_notification_id and user_id = auth.uid();
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) then
    raise exception 'not a conversation member';
  end if;
  update public.notifications set read_at = now()
    where user_id = auth.uid() and conversation_id = p_conversation_id and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_notification_read(uuid) from public;
revoke all on function public.mark_all_notifications_read() from public;
revoke all on function public.mark_conversation_read(uuid) from public;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

create or replace function public.notify_order_event(
  p_order_id uuid,
  p_type text,
  p_title text,
  p_body text
)
returns void language plpgsql security definer set search_path = public as $$
declare v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'order not found'; end if;
  if p_type = 'order_funded' then
    insert into public.notifications(user_id,type,title,body,order_id,actor_id) values (v_order.seller_id,p_type,p_title,p_body,p_order_id,v_order.buyer_id);
  elsif p_type in ('order_started','order_delivered') then
    insert into public.notifications(user_id,type,title,body,order_id,actor_id) values (v_order.buyer_id,p_type,p_title,p_body,p_order_id,v_order.seller_id);
  elsif p_type = 'order_completed' then
    insert into public.notifications(user_id,type,title,body,order_id,actor_id) values (v_order.seller_id,p_type,p_title,p_body,p_order_id,v_order.buyer_id);
  elsif p_type in ('order_disputed','order_cancelled') then
    insert into public.notifications(user_id,type,title,body,order_id,actor_id)
      values (v_order.buyer_id,p_type,p_title,p_body,p_order_id,v_order.seller_id),
             (v_order.seller_id,p_type,p_title,p_body,p_order_id,v_order.buyer_id);
  else raise exception 'unsupported order notification type';
  end if;
end;
$$;
revoke all on function public.notify_order_event(uuid,text,text,text) from public, authenticated, anon;

create unique index notifications_order_event_unique_idx on public.notifications(order_id,user_id,type) where order_id is not null;

create or replace function public.notify_order_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status is distinct from new.status then
    if new.status = 'funded' then perform public.notify_order_event(new.id,'order_funded','New funded order','A buyer funded your FAV order.');
    elsif new.status = 'in_progress' then perform public.notify_order_event(new.id,'order_started','Work started','The seller started working on your order.');
    elsif new.status = 'delivered' then perform public.notify_order_event(new.id,'order_delivered','Work delivered','Your order is ready for review.');
    elsif new.status = 'completed' then perform public.notify_order_event(new.id,'order_completed','Order completed','The buyer released the FAV payment.');
    elsif new.status = 'disputed' then perform public.notify_order_event(new.id,'order_disputed','Order disputed','A dispute was opened for this order.');
    elsif new.status = 'cancelled' then perform public.notify_order_event(new.id,'order_cancelled','Order cancelled','This order was cancelled.');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_notify_status_change on public.orders;
create trigger orders_notify_status_change after update of status on public.orders for each row execute function public.notify_order_status_change();

create or replace function public.notify_new_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_member uuid;
begin
  for v_member in select user_id from public.conversation_members where conversation_id = new.conversation_id and user_id <> new.sender_id loop
    insert into public.notifications(user_id,type,title,body,conversation_id,actor_id)
      values (v_member,'message','New message',left(new.body,160),new.conversation_id,new.sender_id);
  end loop;
  return new;
end;
$$;

drop trigger if exists messages_notify_insert on public.messages;
create trigger messages_notify_insert after insert on public.messages for each row execute function public.notify_new_message();

revoke all on function public.notify_order_status_change() from public, authenticated, anon;
revoke all on function public.notify_new_message() from public, authenticated, anon;
