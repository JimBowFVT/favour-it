-- Messaging read state is tracked per conversation/member, not by mutating messages.
create table if not exists public.conversation_read_state (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.conversation_read_state enable row level security;

drop policy if exists "members can view own read state" on public.conversation_read_state;
create policy "members can view own read state" on public.conversation_read_state
  for select using (user_id = auth.uid() and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conversation_read_state.conversation_id and cm.user_id = auth.uid()
  ));

drop policy if exists "members can manage own read state" on public.conversation_read_state;
create policy "members can manage own read state" on public.conversation_read_state
  for all using (user_id = auth.uid()) with check (user_id = auth.uid() and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conversation_read_state.conversation_id and cm.user_id = auth.uid()
  ));

create index if not exists conversation_read_state_user_idx
  on public.conversation_read_state(user_id, conversation_id);

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer := 0;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) then
    raise exception 'not a conversation member';
  end if;
  insert into public.conversation_read_state(conversation_id, user_id, last_read_at)
    values (p_conversation_id, auth.uid(), now())
    on conflict (conversation_id, user_id) do update set last_read_at = now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- Release is valid only after seller delivery. This protects the escrow lifecycle
-- even if a stale or modified client calls the RPC directly.
create or replace function public.release_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_fee bigint;
  v_seller_net bigint;
  v_platform uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.buyer_id <> auth.uid() then raise exception 'only the buyer can release the order'; end if;
  if v_order.status <> 'delivered' then raise exception 'seller must deliver before release'; end if;

  select id into v_platform from public.platform_accounts where singleton = true for update;
  if v_platform is null then raise exception 'platform account not configured'; end if;

  v_fee := coalesce(v_order.fee_fav, 0);
  v_seller_net := greatest(0, v_order.amount_fav - v_fee);

  update public.orders
    set status = 'completed', completed_at = now(), updated_at = now()
    where id = v_order.id
    returning * into v_order;

  update public.escrow_transactions
    set status = 'released', released_at = now(), updated_at = now()
    where order_id = v_order.id and status = 'held';

  update public.wallets
    set available_fav = available_fav + v_seller_net, updated_at = now()
    where user_id = v_order.seller_id;

  update public.wallets
    set available_fav = available_fav + v_fee, updated_at = now()
    where user_id = v_platform;

  if v_seller_net > 0 then
    insert into public.ledger_entries(user_id, entry_type, amount_fav, reference_id, metadata)
      values (v_order.seller_id, 'order_release', v_seller_net, v_order.id, jsonb_build_object('gross_fav', v_order.amount_fav, 'fee_fav', v_fee));
  end if;
  if v_fee > 0 then
    insert into public.ledger_entries(user_id, entry_type, amount_fav, reference_id, metadata)
      values (v_platform, 'platform_fee', v_fee, v_order.id, jsonb_build_object('order_id', v_order.id));
  end if;

  return v_order;
end;
$$;

revoke all on function public.release_order(uuid) from public;
grant execute on function public.release_order(uuid) to authenticated;
