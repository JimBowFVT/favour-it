create or replace function public.report_user(p_user_id uuid,p_reason text,p_details text default '')
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  rid uuid;
  u uuid:=auth.uid();
  reason_clean text:=left(trim(coalesce(p_reason,'')),200);
  details_clean text:=left(trim(coalesce(p_details,'')),2000);
begin
  if u is null then raise exception 'You must be signed in.'; end if;
  if p_user_id is null or p_user_id=u then raise exception 'Invalid report target.'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'User not found.'; end if;
  if reason_clean='' then raise exception 'Report reason is required.'; end if;
  if (select count(*) from public.reports where reporter_id=u and target_type='user' and created_at > now()-interval '1 hour') >= 10 then
    raise exception 'Too many reports. Please try again later.';
  end if;
  insert into public.reports(reporter_id,target_type,target_id,reason,details,status)
  values(u,'user',p_user_id,reason_clean,details_clean,'open')
  returning id into rid;
  return rid;
end $$;
revoke all on function public.report_user(uuid,text,text) from public,anon;
grant execute on function public.report_user(uuid,text,text) to authenticated;
