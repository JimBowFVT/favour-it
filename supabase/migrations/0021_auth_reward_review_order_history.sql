revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- Align onboarding reward claims with the value-based reward model: zero-value claims are valid claim records.
alter table public.reward_claims drop constraint if exists reward_claims_amount_fav_check;
alter table public.reward_claims add constraint reward_claims_amount_fav_check check (amount_fav >= 0);

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  changed_by uuid references public.profiles(id) on delete set null,
  reason text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_order_status_history_order_created on public.order_status_history(order_id, created_at desc);
alter table public.order_status_history enable row level security;
drop policy if exists order_status_history_select_own on public.order_status_history;
create policy order_status_history_select_own on public.order_status_history for select to authenticated using (
  exists (select 1 from public.orders o where o.id = order_id and (o.buyer_id = auth.uid() or o.seller_id = auth.uid()))
  or exists (select 1 from public.order_middlemen om where om.order_id = order_status_history.order_id and om.middleman_id = auth.uid() and om.active)
  or exists (select 1 from public.moderators m where m.user_id = auth.uid() and m.role in ('moderator','admin'))
);

create or replace function public.submit_order_review(p_order_id uuid, p_rating integer, p_comment text default '')
returns public.reviews
language plpgsql security definer set search_path=public
as $$
declare v_order public.orders; v_review public.reviews;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_rating < 1 or p_rating > 5 then raise exception 'rating must be between 1 and 5'; end if;
  select * into v_order from public.orders where id=p_order_id for share;
  if not found then raise exception 'order not found'; end if;
  if v_order.buyer_id <> auth.uid() then raise exception 'only the buyer can review this order'; end if;
  if v_order.status <> 'completed' then raise exception 'order must be completed before review'; end if;
  if exists(select 1 from public.reviews where order_id=p_order_id) then raise exception 'order already reviewed'; end if;
  insert into public.reviews(order_id, reviewer_id, reviewee_id, rating, comment)
  values(p_order_id, auth.uid(), v_order.seller_id, p_rating, left(coalesce(trim(p_comment),''),2000)) returning * into v_review;
  return v_review;
end; $$;
revoke all on function public.submit_order_review(uuid,integer,text) from public;
grant execute on function public.submit_order_review(uuid,integer,text) to authenticated;

create or replace function public.record_order_status_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.status is distinct from new.status then
    insert into public.order_status_history(order_id,from_status,to_status,changed_by,reason,metadata)
    values(new.id,old.status,new.status,auth.uid(),coalesce(new.metadata->>'status_reason',''),coalesce(new.metadata,'{}'::jsonb));
  end if;
  return new;
end; $$;
drop trigger if exists trg_orders_status_history on public.orders;
create trigger trg_orders_status_history after update of status on public.orders for each row execute function public.record_order_status_change();

insert into public.order_status_history(order_id,from_status,to_status,changed_by,reason,metadata)
select o.id,null,o.status,null,'initial state','{}'::jsonb from public.orders o
where not exists(select 1 from public.order_status_history h where h.order_id=o.id);
