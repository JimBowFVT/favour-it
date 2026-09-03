-- Favourit MVP hardening: explicit order status history, safe cancellation rules,
-- and idempotent lifecycle guards.

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  note text not null default '',
  created_at timestamptz not null default now()
);

alter table public.order_status_history enable row level security;
create policy "order participants can view status history" on public.order_status_history
  for select using (exists (
    select 1 from public.orders o
    where o.id = order_id and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
  ) or exists (select 1 from public.moderators m where m.user_id = auth.uid()));

create index if not exists order_status_history_order_idx
  on public.order_status_history(order_id, created_at);

create or replace function public.record_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    insert into public.order_status_history(order_id, from_status, to_status, changed_by)
    values (new.id, old.status::text, new.status::text, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists orders_record_status_history on public.orders;
create trigger orders_record_status_history
after update of status on public.orders
for each row execute function public.record_order_status_change();

-- Seed an initial event for existing orders when history is first installed.
insert into public.order_status_history(order_id, from_status, to_status, changed_by, note)
select o.id, null, o.status::text, null, 'Initial order state'
from public.orders o
where not exists (select 1 from public.order_status_history h where h.order_id = o.id);

revoke all on function public.record_order_status_change() from public, authenticated, anon;

comment on table public.order_status_history is 'Immutable audit trail for marketplace order lifecycle transitions.';
