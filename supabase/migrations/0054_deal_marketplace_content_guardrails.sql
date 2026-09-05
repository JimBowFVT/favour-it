create or replace function public.validate_deal_marketplace_row()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.service_type not in ('deliverable','session','managed','audit') then
    raise exception 'Unsupported service type.';
  end if;
  if char_length(coalesce(new.buyer_requirements,''))>3000 then
    raise exception 'Buyer requirements must be 3000 characters or less.';
  end if;
  if jsonb_typeof(new.faqs)<>'array' or jsonb_array_length(new.faqs)>8 then
    raise exception 'Deal FAQ must be an array with up to 8 items.';
  end if;
  if exists(
    select 1 from jsonb_array_elements(new.faqs) f
    where jsonb_typeof(f)<>'object'
       or char_length(trim(coalesce(f->>'question','')))>180
       or char_length(trim(coalesce(f->>'answer','')))>800
  ) then raise exception 'One or more FAQ items are invalid.'; end if;
  if jsonb_typeof(new.portfolio)<>'array' or jsonb_array_length(new.portfolio)>6 then
    raise exception 'Deal portfolio must be an array with up to 6 items.';
  end if;
  if exists(
    select 1 from jsonb_array_elements(new.portfolio) p
    where jsonb_typeof(p)<>'object'
       or char_length(trim(coalesce(p->>'title','')))>100
       or char_length(trim(coalesce(p->>'url','')))>1000
       or (trim(coalesce(p->>'url',''))<>'' and trim(p->>'url') !~* '^https?://')
  ) then raise exception 'Portfolio links must use http or https.'; end if;

  if new.status='published' then
    if not exists(select 1 from public.service_categories c where c.label=new.category and c.active) then
      raise exception 'Choose an approved Favourit service category.';
    end if;
    if jsonb_typeof(new.packages)<>'array' or jsonb_array_length(new.packages)<1 or jsonb_array_length(new.packages)>3 then
      raise exception 'Published deals need between one and three service packages.';
    end if;
    if not exists(select 1 from jsonb_array_elements(new.packages) p where lower(coalesce(p->>'tier',''))='basic') then
      raise exception 'Published deals need a Basic package.';
    end if;
    if exists(
      select 1 from jsonb_array_elements(new.packages) p
      where jsonb_typeof(p)<>'object'
         or lower(coalesce(p->>'tier','')) not in ('basic','standard','premium')
         or coalesce((p->>'price_fav')::bigint,0)<10000
         or coalesce((p->>'delivery_days')::integer,0) not between 1 and 30
         or coalesce((p->>'revisions')::integer,0) not between 0 and 99
         or (p ? 'session_minutes' and coalesce((p->>'session_minutes')::integer,0) not between 15 and 480)
         or char_length(trim(coalesce(p->>'title','')))<2
         or char_length(trim(coalesce(p->>'title','')))>60
         or char_length(trim(coalesce(p->>'description','')))>500
    ) then raise exception 'One or more service packages are invalid.'; end if;
    if (select count(*) from jsonb_array_elements(new.packages)) <> (select count(distinct lower(p->>'tier')) from jsonb_array_elements(new.packages) p) then
      raise exception 'Each package tier can only be used once.';
    end if;
    select min((p->>'price_fav')::bigint),min((p->>'delivery_days')::integer)
      into new.price_fav,new.delivery_days
      from jsonb_array_elements(new.packages) p;
  end if;
  return new;
end;
$$;