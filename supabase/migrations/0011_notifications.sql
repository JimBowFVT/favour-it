-- In-app notifications for important marketplace events.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (char_length(trim(type)) between 1 and 80),
  title text not null check (char_length(trim(title)) between 1 and 160),
  body text not null default '' check (char_length(body) <= 1000),
  order_id uuid references public.orders(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

create policy "users can view their notifications" on public.notifications
  for select using (user_id = auth.uid());

create policy "users can mark their notifications read" on public.notifications
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index notifications_user_created_idx
  on public.notifications(user_id, created_at desc);
create index notifications_unread_idx
  on public.notifications(user_id, created_at desc)
  where read_at is null;

-- Only trusted server-side order transitions create notifications.
create or replace function public.notify_order_event(
  p_order_id uuid,
  p_type text,
  p_title text,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_buyer uuid;
  v_seller uuid;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'order not found'; end if;
  v_buyer := v_order.buyer_id;
  v_seller := v_order.seller_id;

  if p_type = 'order_funded' then
    insert into public.notifications(user_id, type, title, body, order_id)
      values (v_seller, p_type, p_title, p_body, p_order_id);
  elsif p_type = 'order_started' then
    insert into public.notifications(user_id, type, title, body, order_id)
      values (v_buyer, p_type, p_title, p_body, p_order_id);
  elsif p_type = 'order_delivered' then
    insert into public.notifications(user_id, type, title, body, order_id)
      values (v_buyer, p_type, p_title, p_body, p_order_id);
  elsif p_type = 'order_completed' then
    insert into public.notifications(user_id, type, title, body, order_id)
      values (v_seller, p_type, p_title, p_body, p_order_id);
  elsif p_type in ('order_disputed', 'order_cancelled') then
    insert into public.notifications(user_id, type, title, body, order_id)
      values (case when p_type = 'order_disputed' then v_seller else v_seller end, p_type, p_title, p_body, p_order_id);
    insert into public.notifications(user_id, type, title, body, order_id)
      values (v_buyer, p_type, p_title, p_body, p_order_id);
  else
    raise exception 'unsupported order notification type';
  end if;
end;
$$;

revoke all on function public.notify_order_event(uuid, text, text, text) from public;
grant execute on function public.notify_order_event(uuid, text, text, text) to authenticated;

-- Deduplicate event notifications when a client retries a transition.
create unique index notifications_order_event_unique_idx
  on public.notifications(order_id, user_id, type)
  where order_id is not null;
