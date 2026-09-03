-- Complete the audit trail with database-side triggers so moderation actions cannot
-- silently bypass logging.

create or replace function public.audit_middleman_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.active then
    insert into public.moderation_audit_logs(moderator_id, order_id, action, note)
    values (new.assigned_by, new.order_id, 'assign_middleman', 'Assigned middleman ' || new.middleman_id::text);
  elsif tg_op = 'UPDATE' and old.active and not new.active then
    insert into public.moderation_audit_logs(moderator_id, order_id, action, note)
    values (new.assigned_by, new.order_id, 'unassign_middleman', 'Unassigned middleman ' || old.middleman_id::text);
  elsif tg_op = 'UPDATE' and (not old.active) and new.active then
    insert into public.moderation_audit_logs(moderator_id, order_id, action, note)
    values (new.assigned_by, new.order_id, 'assign_middleman', 'Assigned middleman ' || new.middleman_id::text);
  end if;
  return new;
end;
$$;

drop trigger if exists order_middlemen_audit on public.order_middlemen;
create trigger order_middlemen_audit
after insert or update on public.order_middlemen
for each row execute function public.audit_middleman_assignment();

create or replace function public.audit_dispute_resolution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'resolved' and (old.status is distinct from new.status or old.resolution is distinct from new.resolution) then
    insert into public.moderation_audit_logs(
      moderator_id, order_id, dispute_id, action, note
    )
    values (
      new.resolved_by,
      new.order_id,
      new.id,
      case new.resolution
        when 'refund_buyer' then 'refund_buyer'
        when 'release_seller' then 'release_seller'
        else 'close_dispute'
      end,
      coalesce(new.resolution_note, '')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists disputes_resolution_audit on public.disputes;
create trigger disputes_resolution_audit
after update on public.disputes
for each row execute function public.audit_dispute_resolution();

-- A cancellation must have escrow behind it; unfunded pending orders should use
-- the normal order-cancellation path rather than creating a refundable dispute.
create or replace function public.middleman_cancel_order(
  p_order_id uuid,
  p_reason text
)
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
  if not public.is_order_middleman(p_order_id, v_user) then
    raise exception 'middleman is not assigned to this order';
  end if;
  if char_length(trim(p_reason)) not between 10 and 2000 then raise exception 'invalid cancellation reason'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.status not in ('funded','in_progress','delivered','disputed') then
    raise exception 'order cannot be cancelled';
  end if;

  insert into public.disputes(order_id, opened_by, reason, status)
  values (p_order_id, v_user, trim(p_reason), 'under_review')
  on conflict (order_id) do update
    set reason = excluded.reason,
        status = 'under_review',
        resolved_by = null,
        resolved_at = null
  returning id into v_dispute;

  update public.orders set status = 'disputed', updated_at = now() where id = p_order_id;
  return v_dispute;
end;
$$;

revoke all on function public.middleman_cancel_order(uuid,text) from public;
grant execute on function public.middleman_cancel_order(uuid,text) to authenticated;
