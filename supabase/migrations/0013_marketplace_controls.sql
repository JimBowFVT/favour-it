-- Marketplace controls: sellers can pause/resume/archive their own listings
-- through trusted functions without gaining arbitrary status-update access.

create or replace function public.set_deal_status(p_deal_id uuid, p_status public.deal_status)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_deal public.deals;
  v_updated public.deals;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_status not in ('published','paused','archived') then
    raise exception 'invalid marketplace status';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'deal not found'; end if;
  if v_deal.seller_id <> v_user then raise exception 'only the seller can change this deal'; end if;

  if v_deal.status = 'archived' and p_status <> 'archived' then
    raise exception 'archived deals cannot be restored';
  end if;
  if p_status = 'published' and (char_length(trim(v_deal.title)) < 3 or char_length(trim(v_deal.description)) < 10) then
    raise exception 'deal content is incomplete';
  end if;

  update public.deals
    set status = p_status, updated_at = now()
    where id = p_deal_id
    returning * into v_updated;
  return v_updated;
end;
$$;

revoke all on function public.set_deal_status(uuid, public.deal_status) from public;
grant execute on function public.set_deal_status(uuid, public.deal_status) to authenticated;

-- Sellers can edit their own listing fields without being able to alter
-- ownership, price rules, or publication state from the browser.
drop policy if exists "sellers can update their deals" on public.deals;
create policy "sellers can update listing content"
  on public.deals for update
  using (seller_id = auth.uid())
  with check (
    seller_id = auth.uid()
    and status = public.deals.status
    and price_fav >= 10
    and delivery_days between 1 and 30
  );

-- Public marketplace reads remain limited to published listings; owners can
-- continue to read their own listings for management screens.
