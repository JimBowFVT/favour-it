-- Capture the buyer's actual brief before funding a service order.
--
-- The seller's `buyer_requirements` field is a prompt/instruction. Until this migration,
-- checkout snapshotted that prompt but never captured the buyer's answer. The v3 wrapper
-- validates the answer before any FAV is held, delegates all financial/provenance accounting
-- to the latest v2 checkout function, then appends the brief to the immutable order snapshot.

create or replace function public.create_order_and_hold_fav_v3(
  p_deal_id uuid,
  p_package_tier text default 'basic',
  p_buyer_brief text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_requirements text;
  v_brief text := trim(coalesce(p_buyer_brief, ''));
  v_order uuid;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_deal_id is null then raise exception 'deal is required'; end if;
  if char_length(v_brief) > 5000 then raise exception 'buyer brief must be 5000 characters or less'; end if;

  select trim(coalesce(d.buyer_requirements, ''))
  into v_requirements
  from public.deals d
  where d.id = p_deal_id
    and d.status = 'published';

  if not found then raise exception 'deal is not available'; end if;

  -- When a seller asks for information, require a real answer rather than allowing
  -- clients to bypass the brief with an empty/whitespace-only string.
  if char_length(v_requirements) > 0 and char_length(v_brief) < 3 then
    raise exception 'answer the seller requirements before funding this order';
  end if;

  -- v2 remains the single source of truth for buyer/seller fees, escrow and FAV provenance.
  -- This call and the snapshot update are one Postgres transaction, so any failure rolls back
  -- the FAV hold as well as the order.
  v_order := public.create_order_and_hold_fav_v2(p_deal_id, p_package_tier);

  update public.orders
  set package_snapshot = coalesce(package_snapshot, '{}'::jsonb) || jsonb_build_object(
        'buyer_brief', v_brief,
        'buyer_brief_captured_at', now()
      ),
      updated_at = now()
  where id = v_order
    and buyer_id = v_user;

  if not found then raise exception 'created order could not be finalized'; end if;

  -- Keep the ledger concise: record only that a brief exists, while the actual text stays
  -- inside the participant-protected order snapshot.
  update public.ledger_entries
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'buyer_brief_provided', char_length(v_brief) > 0
      )
  where order_id = v_order
    and idempotency_key = 'escrow-hold:' || v_order::text;

  return v_order;
end;
$$;

revoke all on function public.create_order_and_hold_fav_v3(uuid,text,text) from public;
grant execute on function public.create_order_and_hold_fav_v3(uuid,text,text) to authenticated;

-- Prevent authenticated clients from bypassing required buyer briefs by calling the
-- older RPC directly. The v3 SECURITY DEFINER function can still delegate to v2 internally.
revoke execute on function public.create_order_and_hold_fav_v2(uuid,text) from authenticated;

comment on function public.create_order_and_hold_fav_v3(uuid,text,text) is
  'Funds an order using v2 financial accounting and immutably captures the buyer brief. Buyer brief is required when the seller configured buyer requirements.';
