-- Seller-side order lifecycle.
-- Buyers fund an order; sellers explicitly start work and mark delivery ready.

create or replace function public.start_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.seller_id <> v_user then raise exception 'seller access required'; end if;
  if v_order.status <> 'funded' then raise exception 'order is not ready to start'; end if;

  update public.orders
    set status = 'in_progress', updated_at = now()
    where id = p_order_id
    returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.deliver_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.seller_id <> v_user then raise exception 'seller access required'; end if;
  if v_order.status not in ('funded','in_progress') then raise exception 'order cannot be delivered in its current state'; end if;

  update public.orders
    set status = 'delivered', updated_at = now()
    where id = p_order_id
    returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.start_order(uuid) from public;
grant execute on function public.start_order(uuid) to authenticated;
revoke all on function public.deliver_order(uuid) from public;
grant execute on function public.deliver_order(uuid) to authenticated;

comment on function public.start_order(uuid) is 'Seller moves a funded order into active work.';
comment on function public.deliver_order(uuid) is 'Seller marks funded/in-progress work as delivered for buyer review.';
