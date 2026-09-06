-- Seller-side deal management for the marketplace MVP.
-- Existing orders remain protected by their immutable package/scope snapshots; these
-- functions only change what future buyers see and can purchase.

create or replace function public.get_my_deals()
returns setof public.deals
language sql
stable
security definer
set search_path = public
as $$
  select d.*
  from public.deals d
  where d.seller_id = auth.uid()
  order by d.updated_at desc, d.created_at desc;
$$;

revoke all on function public.get_my_deals() from public;
grant execute on function public.get_my_deals() to authenticated;

create or replace function public.update_my_deal_v2(
  p_deal_id uuid,
  p_title text,
  p_description text,
  p_category text,
  p_service_type text,
  p_buyer_requirements text,
  p_packages jsonb,
  p_faqs jsonb default '[]'::jsonb,
  p_portfolio jsonb default '[]'::jsonb
) returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_current public.deals%rowtype;
  v_result public.deals%rowtype;
  v_title text := trim(coalesce(p_title, ''));
  v_description text := trim(coalesce(p_description, ''));
  v_category text := trim(coalesce(p_category, ''));
  v_type text := lower(trim(coalesce(p_service_type, 'deliverable')));
  v_requirements text := trim(coalesce(p_buyer_requirements, ''));
  v_packages jsonb := coalesce(p_packages, '[]'::jsonb);
  v_faqs jsonb := coalesce(p_faqs, '[]'::jsonb);
  v_portfolio jsonb := coalesce(p_portfolio, '[]'::jsonb);
  v_price bigint;
  v_delivery integer;
begin
  if v_user is null then raise exception 'You must be signed in.'; end if;
  if p_deal_id is null then raise exception 'Deal id is required.'; end if;

  select * into v_current
  from public.deals
  where id = p_deal_id and seller_id = v_user
  for update;

  if not found then raise exception 'Deal not found.'; end if;
  if v_current.status = 'archived' then raise exception 'Archived deals cannot be edited.'; end if;

  if char_length(v_title) < 10 or char_length(v_title) > 120 then raise exception 'Deal title must be between 10 and 120 characters.'; end if;
  if char_length(v_description) < 20 or char_length(v_description) > 5000 then raise exception 'Description must be between 20 and 5000 characters.'; end if;
  if not exists(select 1 from public.service_categories c where c.label = v_category and c.active) then raise exception 'Choose an approved Favourit service category.'; end if;
  if v_type not in ('deliverable','session','managed','audit') then raise exception 'Unsupported service type.'; end if;
  if char_length(v_requirements) > 3000 then raise exception 'Buyer requirements must be 3000 characters or less.'; end if;

  if jsonb_typeof(v_packages) <> 'array' or jsonb_array_length(v_packages) < 1 or jsonb_array_length(v_packages) > 3 then
    raise exception 'Create between one and three service packages.';
  end if;
  if not exists(select 1 from jsonb_array_elements(v_packages) p where lower(coalesce(p->>'tier','')) = 'basic') then
    raise exception 'A Basic package is required.';
  end if;
  if jsonb_typeof(v_faqs) <> 'array' or jsonb_array_length(v_faqs) > 8 then raise exception 'Add up to 8 FAQ items.'; end if;
  if jsonb_typeof(v_portfolio) <> 'array' or jsonb_array_length(v_portfolio) > 6 then raise exception 'Add up to 6 portfolio items.'; end if;

  if exists(
    select 1 from jsonb_array_elements(v_packages) p
    where jsonb_typeof(p) <> 'object'
       or lower(coalesce(p->>'tier','')) not in ('basic','standard','premium')
       or coalesce((p->>'price_fav')::bigint, 0) < 10000
       or coalesce((p->>'delivery_days')::integer, 0) not between 1 and 30
       or coalesce((p->>'revisions')::integer, 0) not between 0 and 99
       or (p ? 'session_minutes' and coalesce((p->>'session_minutes')::integer, 0) not between 15 and 480)
       or char_length(trim(coalesce(p->>'title',''))) < 2
       or char_length(trim(coalesce(p->>'title',''))) > 60
       or char_length(trim(coalesce(p->>'description',''))) > 500
  ) then raise exception 'One or more service packages are invalid.'; end if;

  if (select count(*) from jsonb_array_elements(v_packages)) <>
     (select count(distinct lower(p->>'tier')) from jsonb_array_elements(v_packages) p) then
    raise exception 'Each package tier can only be used once.';
  end if;

  if exists(
    select 1 from jsonb_array_elements(v_faqs) f
    where jsonb_typeof(f) <> 'object'
       or char_length(trim(coalesce(f->>'question',''))) > 180
       or char_length(trim(coalesce(f->>'answer',''))) > 800
  ) then raise exception 'One or more FAQ items are invalid.'; end if;

  if exists(
    select 1 from jsonb_array_elements(v_portfolio) p
    where jsonb_typeof(p) <> 'object'
       or char_length(trim(coalesce(p->>'title',''))) > 100
       or char_length(trim(coalesce(p->>'url',''))) > 1000
       or (trim(coalesce(p->>'url','')) <> '' and trim(p->>'url') !~* '^https?://')
  ) then raise exception 'Portfolio links must use http or https.'; end if;

  select min((p->>'price_fav')::bigint), min((p->>'delivery_days')::integer)
  into v_price, v_delivery
  from jsonb_array_elements(v_packages) p;

  update public.deals
  set title = v_title,
      description = v_description,
      category = v_category,
      service_type = v_type,
      buyer_requirements = v_requirements,
      packages = v_packages,
      faqs = v_faqs,
      portfolio = v_portfolio,
      price_fav = v_price,
      delivery_days = v_delivery,
      updated_at = now()
  where id = v_current.id and seller_id = v_user
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.update_my_deal_v2(uuid,text,text,text,text,text,jsonb,jsonb,jsonb) from public;
grant execute on function public.update_my_deal_v2(uuid,text,text,text,text,text,jsonb,jsonb,jsonb) to authenticated;

create or replace function public.set_my_deal_status(
  p_deal_id uuid,
  p_status text
) returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_requested text := lower(trim(coalesce(p_status, '')));
  v_current public.deals%rowtype;
  v_result public.deals%rowtype;
begin
  if v_user is null then raise exception 'You must be signed in.'; end if;
  if p_deal_id is null then raise exception 'Deal id is required.'; end if;
  if v_requested not in ('published','paused','archived') then raise exception 'Unsupported deal status.'; end if;

  select * into v_current
  from public.deals
  where id = p_deal_id and seller_id = v_user
  for update;

  if not found then raise exception 'Deal not found.'; end if;

  -- Archive is a soft-delete boundary for the MVP. Historical orders keep their deal
  -- reference and immutable purchase snapshot, while the listing cannot be reactivated.
  if v_current.status = 'archived' and v_requested <> 'archived' then
    raise exception 'Archived deals cannot be republished.';
  end if;

  update public.deals
  set status = v_requested::public.deal_status,
      updated_at = now()
  where id = v_current.id and seller_id = v_user
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.set_my_deal_status(uuid,text) from public;
grant execute on function public.set_my_deal_status(uuid,text) to authenticated;
