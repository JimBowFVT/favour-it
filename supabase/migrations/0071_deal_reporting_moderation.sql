-- Marketplace listing reporting + moderator controls for the MVP.
-- Reuses the existing generic reports table so report lifecycle stays consistent with
-- user/message/community moderation, while adding deal-specific validation and context.

create or replace function public.report_deal(
  p_deal_id uuid,
  p_reason text,
  p_details text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_reason text := trim(coalesce(p_reason, ''));
  v_details text := trim(coalesce(p_details, ''));
  v_seller uuid;
  v_report_id uuid;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_deal_id is null then raise exception 'deal is required'; end if;
  if char_length(v_reason) < 2 or char_length(v_reason) > 120 then raise exception 'choose a valid report reason'; end if;
  if char_length(v_details) > 2000 then raise exception 'report details must be 2000 characters or less'; end if;

  select d.seller_id into v_seller
  from public.deals d
  where d.id = p_deal_id;
  if not found then raise exception 'deal not found'; end if;
  if v_seller = v_user then raise exception 'you cannot report your own deal'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':deal-report:' || p_deal_id::text, 0));

  -- Treat repeated clicks/retries as the same active report instead of creating spam.
  select r.id into v_report_id
  from public.reports r
  where r.reporter_id = v_user
    and r.target_type = 'deal'
    and r.target_id = p_deal_id
    and r.status in ('open','reviewing')
  order by r.created_at desc
  limit 1;

  if v_report_id is not null then return v_report_id; end if;

  insert into public.reports(reporter_id, target_type, target_id, reason, details)
  values(v_user, 'deal', p_deal_id, v_reason, v_details)
  returning id into v_report_id;

  return v_report_id;
end;
$$;

revoke all on function public.report_deal(uuid,text,text) from public, anon;
grant execute on function public.report_deal(uuid,text,text) to authenticated;

create or replace function public.admin_list_deal_reports()
returns table(
  report_id uuid,
  report_status text,
  reason text,
  details text,
  created_at timestamptz,
  deal_id uuid,
  deal_title text,
  deal_status text,
  seller_id uuid,
  seller_username text,
  seller_name text,
  reporter_id uuid,
  reporter_username text,
  reporter_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if not exists(
    select 1 from public.moderators m
    where m.user_id = v_user and m.role in ('moderator','admin')
  ) then raise exception 'not authorized'; end if;

  return query
  select
    r.id,
    r.status,
    r.reason,
    r.details,
    r.created_at,
    d.id,
    d.title,
    d.status::text,
    d.seller_id,
    seller.username,
    seller.display_name,
    r.reporter_id,
    reporter.username,
    reporter.display_name
  from public.reports r
  join public.deals d on d.id = r.target_id
  left join public.profiles seller on seller.id = d.seller_id
  left join public.profiles reporter on reporter.id = r.reporter_id
  where r.target_type = 'deal'
  order by
    case r.status when 'open' then 0 when 'reviewing' then 1 else 2 end,
    r.created_at desc;
end;
$$;

revoke all on function public.admin_list_deal_reports() from public, anon;
grant execute on function public.admin_list_deal_reports() to authenticated;

create or replace function public.admin_moderate_deal(
  p_deal_id uuid,
  p_action text
)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_action text := lower(trim(coalesce(p_action, '')));
  v_current public.deals%rowtype;
  v_result public.deals%rowtype;
begin
  if not exists(
    select 1 from public.moderators m
    where m.user_id = v_user and m.role in ('moderator','admin')
  ) then raise exception 'not authorized'; end if;
  if p_deal_id is null then raise exception 'deal is required'; end if;
  if v_action not in ('pause','restore','archive') then raise exception 'unsupported moderation action'; end if;

  select * into v_current
  from public.deals
  where id = p_deal_id
  for update;
  if not found then raise exception 'deal not found'; end if;

  if v_current.status = 'archived' and v_action <> 'archive' then
    raise exception 'archived deals cannot be restored';
  end if;

  update public.deals
  set status = case v_action
        when 'pause' then 'paused'::public.deal_status
        when 'restore' then 'published'::public.deal_status
        when 'archive' then 'archived'::public.deal_status
      end,
      updated_at = now()
  where id = v_current.id
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_moderate_deal(uuid,text) from public, anon;
grant execute on function public.admin_moderate_deal(uuid,text) to authenticated;

comment on function public.report_deal(uuid,text,text) is
  'Creates one active report per user/deal and validates the target exists and is not self-owned.';
comment on function public.admin_moderate_deal(uuid,text) is
  'Moderator/admin listing control: pause, restore a paused listing, or irreversibly archive it.';
