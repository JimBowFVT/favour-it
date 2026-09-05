alter table public.deals
  add column if not exists service_type text not null default 'deliverable',
  add column if not exists buyer_requirements text not null default '',
  add column if not exists packages jsonb not null default '[]'::jsonb,
  add column if not exists faqs jsonb not null default '[]'::jsonb,
  add column if not exists portfolio jsonb not null default '[]'::jsonb;

alter table public.orders
  add column if not exists package_tier text,
  add column if not exists package_snapshot jsonb not null default '{}'::jsonb;

create table if not exists public.service_categories(
  id text primary key,
  label text not null unique,
  family text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.service_categories enable row level security;
drop policy if exists "service categories are public" on public.service_categories;
create policy "service categories are public" on public.service_categories for select to anon, authenticated using (active=true);

insert into public.service_categories(id,label,family) values
('graphic-design-branding','Graphic Design & Branding','creative'),
('ui-ux-product-design','UI / UX & Product Design','creative'),
('illustration-digital-art','Illustration & Digital Art','creative'),
('3d-design-visualization','3D Design & Visualization','creative'),
('interior-spatial-design','Interior & Spatial Design','creative'),
('fashion-personal-styling','Fashion & Personal Styling','creative'),
('video-editing-motion','Video Editing & Motion','media'),
('photography-image-editing','Photography & Image Editing','media'),
('music-production','Music Production','media'),
('audio-podcast-production','Audio & Podcast Production','media'),
('voice-over-narration','Voice Over & Narration','media'),
('writing-copywriting','Writing & Copywriting','writing'),
('editing-proofreading','Editing, Proofreading & Content Review','writing'),
('translation-localization','Translation & Localization','writing'),
('web-development','Web Development','tech'),
('mobile-app-development','Mobile App Development','tech'),
('software-development','Software Development','tech'),
('ai-automation','AI & Automation','tech'),
('data-analytics','Data & Analytics','tech'),
('data-science-ml','Data Science & Machine Learning','tech'),
('cloud-devops','Cloud, DevOps & Infrastructure','tech'),
('cybersecurity','Cybersecurity','tech'),
('qa-testing','QA & Software Testing','tech'),
('technical-documentation','Technical Documentation & Knowledge Bases','tech'),
('seo-search-growth','SEO & Search Growth','growth'),
('paid-advertising','Paid Advertising','growth'),
('social-content-marketing','Social Media & Content Marketing','growth'),
('email-crm-marketing','Email, CRM & Marketing Systems','growth'),
('sales-lead-generation','Sales & Lead Generation','growth'),
('ecommerce-online-stores','Ecommerce & Online Stores','growth'),
('business-strategy-consulting','Business Strategy & Consulting','business'),
('operations-project-management','Operations & Project Management','business'),
('virtual-assistance-support','Virtual Assistance & Customer Support','business'),
('finance-bookkeeping-support','Finance & Bookkeeping Support','business'),
('research-market-intelligence','Research & Market Intelligence','business'),
('presentations-business-documents','Presentations & Business Documents','business'),
('career-recruiting','Career & Recruiting','business'),
('coaching-learning','Coaching & Learning','learning'),
('fitness-wellness-accountability','Fitness, Wellness & Accountability Coaching','learning'),
('gaming-game-services','Gaming & Game Services','specialized'),
('streaming-creator-services','Streaming & Creator Services','specialized'),
('community-management','Community Management','specialized'),
('accessibility-services','Accessibility Services','specialized'),
('travel-event-planning','Travel & Event Planning','specialized')
on conflict(id) do update set label=excluded.label,family=excluded.family,active=true;

update public.deals d
set packages=jsonb_build_array(jsonb_build_object(
  'tier','basic','title','Basic','description','Core service package','price_fav',d.price_fav,
  'delivery_days',d.delivery_days,'revisions',1
))
where jsonb_typeof(d.packages)='array' and jsonb_array_length(d.packages)=0;

create or replace function public.create_deal_v2(
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
set search_path=public
as $$
declare
  v_user uuid:=auth.uid();
  v_title text:=trim(coalesce(p_title,''));
  v_description text:=trim(coalesce(p_description,''));
  v_category text:=trim(coalesce(p_category,''));
  v_type text:=lower(trim(coalesce(p_service_type,'deliverable')));
  v_requirements text:=trim(coalesce(p_buyer_requirements,''));
  v_packages jsonb:=coalesce(p_packages,'[]'::jsonb);
  v_faqs jsonb:=coalesce(p_faqs,'[]'::jsonb);
  v_portfolio jsonb:=coalesce(p_portfolio,'[]'::jsonb);
  v_price bigint;
  v_delivery integer;
  v_result public.deals;
begin
  if v_user is null then raise exception 'You must be signed in.'; end if;
  if char_length(v_title)<10 or char_length(v_title)>120 then raise exception 'Deal title must be between 10 and 120 characters.'; end if;
  if char_length(v_description)<20 or char_length(v_description)>5000 then raise exception 'Description must be between 20 and 5000 characters.'; end if;
  if not exists(select 1 from public.service_categories c where c.label=v_category and c.active) then raise exception 'Choose an approved Favourit service category.'; end if;
  if v_type not in ('deliverable','session','managed','audit') then raise exception 'Unsupported service type.'; end if;
  if char_length(v_requirements)>3000 then raise exception 'Buyer requirements must be 3000 characters or less.'; end if;
  if jsonb_typeof(v_packages)<>'array' or jsonb_array_length(v_packages)<1 or jsonb_array_length(v_packages)>3 then raise exception 'Create between one and three service packages.'; end if;
  if jsonb_typeof(v_faqs)<>'array' or jsonb_array_length(v_faqs)>8 then raise exception 'Add up to 8 FAQ items.'; end if;
  if jsonb_typeof(v_portfolio)<>'array' or jsonb_array_length(v_portfolio)>6 then raise exception 'Add up to 6 portfolio items.'; end if;

  if exists(
    select 1 from jsonb_array_elements(v_packages) p
    where lower(coalesce(p->>'tier','')) not in ('basic','standard','premium')
       or coalesce((p->>'price_fav')::bigint,0)<10000
       or coalesce((p->>'delivery_days')::integer,0) not between 1 and 30
       or coalesce((p->>'revisions')::integer,0) not between 0 and 99
       or char_length(trim(coalesce(p->>'title','')))<2
       or char_length(trim(coalesce(p->>'title','')))>60
       or char_length(trim(coalesce(p->>'description','')))>500
  ) then raise exception 'One or more service packages are invalid.'; end if;

  if (select count(*) from jsonb_array_elements(v_packages)) <> (select count(distinct lower(p->>'tier')) from jsonb_array_elements(v_packages) p) then
    raise exception 'Each package tier can only be used once.';
  end if;

  select min((p->>'price_fav')::bigint), min((p->>'delivery_days')::integer)
  into v_price,v_delivery from jsonb_array_elements(v_packages) p;

  insert into public.deals(seller_id,title,description,category,price_fav,delivery_days,status,service_type,buyer_requirements,packages,faqs,portfolio)
  values(v_user,v_title,v_description,v_category,v_price,v_delivery,'published',v_type,v_requirements,v_packages,v_faqs,v_portfolio)
  returning * into v_result;
  return v_result;
end;
$$;

grant execute on function public.create_deal_v2(text,text,text,text,text,jsonb,jsonb,jsonb) to authenticated;

create or replace function public.create_order_and_hold_fav_v2(p_deal_id uuid,p_package_tier text default 'basic')
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid:=auth.uid();
  v_deal public.deals%rowtype;
  v_order uuid;
  v_fee bigint;
  v_tier text:=lower(trim(coalesce(p_package_tier,'basic')));
  v_package jsonb;
  v_amount bigint;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_deal from public.deals where id=p_deal_id for update;
  if not found or v_deal.status<>'published' then raise exception 'deal is not available'; end if;
  if v_deal.seller_id=v_user then raise exception 'seller cannot buy own deal'; end if;

  select p into v_package from jsonb_array_elements(v_deal.packages) p where lower(p->>'tier')=v_tier limit 1;
  if v_package is null then raise exception 'selected package is not available'; end if;
  v_amount:=(v_package->>'price_fav')::bigint;
  if v_amount is null or v_amount<1 then raise exception 'selected package has an invalid price'; end if;

  v_fee:=ceil(v_amount::numeric*public.current_fee_bps()/10000)::bigint;
  insert into public.wallets(user_id) values(v_user) on conflict(user_id) do nothing;
  update public.wallets set available_fav=available_fav-v_amount,held_fav=held_fav+v_amount,updated_at=now()
  where user_id=v_user and available_fav>=v_amount;
  if not found then raise exception 'insufficient FAV balance'; end if;

  insert into public.orders(deal_id,buyer_id,seller_id,amount_fav,fee_fav,status,package_tier,package_snapshot)
  values(v_deal.id,v_user,v_deal.seller_id,v_amount,v_fee,'funded',v_tier,v_package)
  returning id into v_order;
  insert into public.escrow_transactions(order_id,amount_fav,status) values(v_order,v_amount,'held');
  insert into public.ledger_entries(user_id,order_id,entry_type,amount_fav,idempotency_key,metadata)
  values(v_user,v_order,'escrow_hold',-v_amount,'escrow-hold:'||v_order::text,jsonb_build_object('deal_id',v_deal.id,'fee_fav',v_fee,'package_tier',v_tier,'package_title',v_package->>'title'));
  return v_order;
end;
$$;

grant execute on function public.create_order_and_hold_fav_v2(uuid,text) to authenticated;

create or replace function public.get_deal_marketplace_detail(p_deal_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  select case when d.id is null then null else jsonb_build_object(
    'deal',to_jsonb(d),
    'seller',jsonb_build_object(
      'id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'bio',p.bio,'is_verified',p.is_verified
    ),
    'stats',jsonb_build_object(
      'rating',coalesce((select round(avg(r.rating)::numeric,2) from public.reviews r where r.seller_id=d.seller_id),0),
      'reviews',coalesce((select count(*) from public.reviews r where r.seller_id=d.seller_id),0),
      'completed_orders',coalesce((select count(*) from public.orders o where o.seller_id=d.seller_id and o.status='completed'),0)
    ),
    'reviews',coalesce((
      select jsonb_agg(x.obj order by x.created_at desc) from (
        select r.created_at,jsonb_build_object('id',r.id,'rating',r.rating,'body',r.body,'created_at',r.created_at,'reviewer_username',rp.username,'reviewer_name',rp.display_name,'reviewer_avatar_url',rp.avatar_url) obj
        from public.reviews r left join public.profiles rp on rp.id=r.reviewer_id
        where r.seller_id=d.seller_id order by r.created_at desc limit 8
      ) x
    ),'[]'::jsonb)
  ) end
  from public.deals d join public.profiles p on p.id=d.seller_id
  where d.id=p_deal_id and (d.status='published' or d.seller_id=auth.uid())
  limit 1;
$$;

grant execute on function public.get_deal_marketplace_detail(uuid) to anon, authenticated;