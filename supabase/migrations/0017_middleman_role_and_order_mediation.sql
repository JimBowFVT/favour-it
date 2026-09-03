-- Trusted human mediators for individual orders.
-- A middleman may only access orders explicitly assigned to them.
-- Admins can assign/reassign middlemen; middlemen cannot self-assign.

alter table public.moderators
  drop constraint if exists moderators_role_check;

alter table public.moderators
  add constraint moderators_role_check
  check (role in ('moderator','admin','middleman'));

create table if not exists public.order_middlemen (
  order_id uuid primary key references public.orders(id) on delete cascade,
  middleman_id uuid not null references public.profiles(id) on delete restrict,
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  active boolean not null default true,
  unassigned_at timestamptz
);

alter table public.order_middlemen enable row level security;

drop policy if exists "middlemen can view their assignments" on public.order_middlemen;
create policy "middlemen can view their assignments" on public.order_middlemen
  for select using (
    middleman_id = auth.uid()
    or exists (
      select 1 from public.moderators m
      where m.user_id = auth.uid() and m.role = 'admin'
    )
  );

create index if not exists order_middlemen_middleman_idx
  on public.order_middlemen(middleman_id, active, assigned_at desc);

create or replace function public.is_order_middleman(p_order_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.order_middlemen om
    join public.moderators m on m.user_id = om.middleman_id
    where om.order_id = p_order_id
      and om.middleman_id = coalesce(p_user_id, auth.uid())
      and om.active = true
      and m.role = 'middleman'
  );
$$;

revoke all on function public.is_order_middleman(uuid,uuid) from public;
grant execute on function public.is_order_middleman(uuid,uuid) to authenticated;

-- Admin-only assignment. The assignee must already be a middleman account.
create or replace function public.assign_order_middleman(
  p_order_id uuid,
  p_middleman_id uuid
)
returns public.order_middlemen
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_assignment public.order_middlemen;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.moderators m where m.user_id = v_user and m.role = 'admin') then
    raise exception 'admin access required';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order not found';
  end if;
  if not exists (select 1 from public.moderators m where m.user_id = p_middleman_id and m.role = 'middleman') then
    raise exception 'user is not a middleman';
  end if;

  update public.order_middlemen
  set active = false, unassigned_at = now()
  where order_id = p_order_id and active = true;

  insert into public.order_middlemen(order_id, middleman_id, assigned_by, active, unassigned_at)
  values (p_order_id, p_middleman_id, v_user, true, null)
  on conflict (order_id) do update
    set middleman_id = excluded.middleman_id,
        assigned_by = excluded.assigned_by,
        assigned_at = now(),
        active = true,
        unassigned_at = null
  returning * into v_assignment;

  return v_assignment;
end;
$$;

revoke all on function public.assign_order_middleman(uuid,uuid) from public;
grant execute on function public.assign_order_middleman(uuid,uuid) to authenticated;

create or replace function public.unassign_order_middleman(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.moderators m where m.user_id = v_user and m.role = 'admin') then
    raise exception 'admin access required';
  end if;

  update public.order_middlemen
  set active = false, unassigned_at = now()
  where order_id = p_order_id and active = true;

  return found;
end;
$$;

revoke all on function public.unassign_order_middleman(uuid) from public;
grant execute on function public.unassign_order_middleman(uuid) to authenticated;

-- Extend order conversation membership to the assigned middleman without exposing
-- unrelated conversations. The middleman is a read-only observer of the buyer/seller
-- conversation: they can read, but cannot post as a party in that conversation.
create policy "assigned middlemen can view order conversations"
on public.order_conversations
for select using (public.is_order_middleman(order_id));

create policy "assigned middlemen can view order messages"
on public.messages
for select using (
  exists (
    select 1
    from public.order_conversations oc
    where oc.conversation_id = messages.conversation_id
      and public.is_order_middleman(oc.order_id)
  )
);

-- Middlemen need to see the conversation itself and its member list in order to
-- render the two-party thread, but assignment does not add them as a sender/member.
create policy "assigned middlemen can view conversations"
on public.conversations
for select using (
  exists (
    select 1
    from public.order_conversations oc
    where oc.conversation_id = conversations.id
      and public.is_order_middleman(oc.order_id)
  )
);

create policy "assigned middlemen can view conversation members"
on public.conversation_members
for select using (
  exists (
    select 1
    from public.order_conversations oc
    where oc.conversation_id = conversation_members.conversation_id
      and public.is_order_middleman(oc.order_id)
  )
);

-- Read state is also scoped to the assigned middleman, so opening the thread can
-- mark it read without giving the middleman write access to messages.
drop policy if exists "middlemen can view own conversation reads" on public.conversation_reads;
create policy "middlemen can view own conversation reads" on public.conversation_reads
for select using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.order_conversations oc
    where oc.conversation_id = conversation_reads.conversation_id
      and public.is_order_middleman(oc.order_id)
  )
);

-- Allow the read-state RPC for assigned middlemen as well as normal members.
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := now();
  v_order_id uuid;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select order_id into v_order_id
  from public.order_conversations
  where conversation_id = p_conversation_id;

  if not exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation_id and user_id = v_user
  ) and not public.is_order_middleman(v_order_id, v_user) then
    raise exception 'not a conversation participant';
  end if;

  insert into public.conversation_reads(conversation_id, user_id, last_read_at)
  values (p_conversation_id, v_user, v_now)
  on conflict (conversation_id, user_id)
    do update set last_read_at = excluded.last_read_at;

  return 1;
end;
$$;

-- Replace the generic moderator check with assignment-aware mediation powers.
-- Admins and existing moderators retain dispute handling; middlemen can resolve
-- only disputes belonging to orders currently assigned to them.
create or replace function public.resolve_dispute(
  p_dispute_id uuid,
  p_resolution text,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_dispute public.disputes;
  v_order public.orders;
  v_fee bigint;
  v_net bigint;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select role into v_role from public.moderators where user_id = v_user;
  if v_role is null then raise exception 'moderator access required'; end if;
  if v_role = 'middleman' and not public.is_order_middleman((select order_id from public.disputes where id = p_dispute_id), v_user) then
    raise exception 'middleman is not assigned to this order';
  end if;
  if p_resolution not in ('refund_buyer','release_seller','none') then raise exception 'invalid resolution'; end if;

  select * into v_dispute from public.disputes where id = p_dispute_id for update;
  if not found then raise exception 'dispute not found'; end if;
  if v_dispute.status in ('resolved','closed') then raise exception 'dispute already resolved'; end if;
  select * into v_order from public.orders where id = v_dispute.order_id for update;
  if v_order.status <> 'disputed' then raise exception 'order is not disputed'; end if;

  if p_resolution = 'refund_buyer' then
    update public.wallets
      set available_fav = available_fav + v_order.amount_fav,
          held_fav = held_fav - v_order.amount_fav,
          updated_at = now()
      where user_id = v_order.buyer_id and held_fav >= v_order.amount_fav;
    if not found then raise exception 'buyer escrow balance unavailable'; end if;
    update public.escrow_transactions set status = 'refunded', released_at = now() where order_id = v_order.id;
    insert into public.ledger_entries(user_id, order_id, entry_type, amount_fav, idempotency_key, metadata)
      values (v_order.buyer_id, v_order.id, 'refund', v_order.amount_fav,
        'dispute-refund:' || v_order.id,
        jsonb_build_object('dispute_id', p_dispute_id, 'resolved_by', v_user));
    update public.orders set status = 'cancelled', updated_at = now() where id = v_order.id;
  elsif p_resolution = 'release_seller' then
    v_fee := round(v_order.amount_fav * current_fee_bps() / 10000.0)::bigint;
    v_net := v_order.amount_fav - v_fee;
    update public.wallets set held_fav = held_fav - v_order.amount_fav, updated_at = now()
      where user_id = v_order.buyer_id and held_fav >= v_order.amount_fav;
    if not found then raise exception 'buyer escrow balance unavailable'; end if;
    update public.wallets set available_fav = available_fav + v_net, updated_at = now() where user_id = v_order.seller_id;
    insert into public.platform_accounts(available_fav) values (v_fee)
      on conflict do update set available_fav = public.platform_accounts.available_fav + excluded.available_fav;
    update public.escrow_transactions set status = 'released', released_at = now() where order_id = v_order.id;
    insert into public.ledger_entries(user_id, order_id, entry_type, amount_fav, idempotency_key, metadata)
      values (v_order.seller_id, v_order.id, 'sale', v_net,
        'dispute-release-seller:' || v_order.id,
        jsonb_build_object('dispute_id', p_dispute_id, 'resolved_by', v_user));
    update public.orders set status = 'completed', completed_at = now(), updated_at = now() where id = v_order.id;
  else
    update public.orders set status = 'cancelled', updated_at = now() where id = v_order.id;
  end if;

  update public.disputes
  set status = 'resolved', resolution = p_resolution,
      resolved_by = v_user, resolution_note = coalesce(p_note,''), resolved_at = now()
  where id = p_dispute_id;
end;
$$;

revoke all on function public.resolve_dispute(uuid,text,text) from public;
grant execute on function public.resolve_dispute(uuid,text,text) to authenticated;

-- Explicit moderation action for an assigned middleman. It opens a dispute and
-- freezes the order in the same atomic path used by the normal dispute workflow.
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
  if v_order.status not in ('pending','funded','in_progress','delivered','disputed') then
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

-- Middlemen may read order/escrow state only for assigned orders. They still have
-- no direct UPDATE/DELETE path and all financial mutations remain transactional RPCs.
create policy "assigned middlemen can view assigned orders"
on public.orders
for select using (public.is_order_middleman(id));

create policy "assigned middlemen can view assigned escrow"
on public.escrow_transactions
for select using (public.is_order_middleman(order_id));

-- Audit trail for assignment changes and mediation decisions.
create table if not exists public.moderation_audit_logs (
  id uuid primary key default gen_random_uuid(),
  moderator_id uuid not null references public.profiles(id),
  order_id uuid references public.orders(id),
  dispute_id uuid references public.disputes(id),
  action text not null check (action in ('assign_middleman','unassign_middleman','cancel_order','refund_buyer','release_seller','close_dispute')),
  note text not null default '',
  created_at timestamptz not null default now()
);

alter table public.moderation_audit_logs enable row level security;
create policy "moderators can view moderation audit logs"
on public.moderation_audit_logs
for select using (
  moderator_id = auth.uid()
  or exists (select 1 from public.moderators m where m.user_id = auth.uid() and m.role = 'admin')
);

create index if not exists moderation_audit_order_idx
  on public.moderation_audit_logs(order_id, created_at desc);
create index if not exists moderation_audit_moderator_idx
  on public.moderation_audit_logs(moderator_id, created_at desc);
