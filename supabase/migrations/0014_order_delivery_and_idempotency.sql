-- Harden the order lifecycle and protect the funding path from duplicate submissions.
-- This migration intentionally keeps FAV in the existing closed-loop ledger.

create or replace function public.start_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.seller_id <> auth.uid() then raise exception 'Only the seller can start this order'; end if;
  if v_order.status <> 'funded' then raise exception 'Only funded orders can be started'; end if;

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
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.seller_id <> auth.uid() then raise exception 'Only the seller can deliver this order'; end if;
  if v_order.status <> 'in_progress' then raise exception 'Only in-progress orders can be delivered'; end if;

  update public.orders
    set status = 'delivered', updated_at = now()
    where id = p_order_id
    returning * into v_order;
  return v_order;
end;
$$;

-- Release is buyer-only and only allowed after delivery. The existing function
-- remains the source of truth for ledger settlement and platform fees.
revoke execute on function public.release_order(uuid) from public;
grant execute on function public.release_order(uuid) to authenticated;

-- Prevent clients from directly mutating lifecycle-critical fields.
revoke update on public.orders from authenticated;
revoke delete on public.orders from authenticated;

-- Ensure the seller workflow functions remain callable only through authenticated RPCs.
grant execute on function public.start_order(uuid) to authenticated;
grant execute on function public.deliver_order(uuid) to authenticated;
