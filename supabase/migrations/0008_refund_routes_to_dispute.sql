-- Refund requests should not directly release escrow. They open a dispute so a
-- moderator can review evidence and decide whether to refund or release payment.
create or replace function public.refund_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders;
  v_dispute uuid;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'order not found'; end if;
  if v_order.buyer_id <> v_user then raise exception 'only buyer can request a refund'; end if;
  if v_order.status not in ('funded','in_progress','delivered','disputed') then raise exception 'order cannot be refunded'; end if;

  select public.open_dispute(
    p_order_id,
    'Buyer requested a refund and wants Favourit to review the order.'
  ) into v_dispute;

  return v_dispute;
end;
$$;

revoke all on function public.refund_order(uuid) from public;
grant execute on function public.refund_order(uuid) to authenticated;
