-- Community MVP final guardrails: moderators must be members, reports are rate-limited,
-- and moderation helpers remain callable only through authenticated server paths.

create or replace function public.assign_community_group_moderator(p_group_id uuid,p_user_id uuid)
returns boolean language plpgsql security definer set search_path=public
as $$
begin
  if auth.uid() is null or not exists(select 1 from public.moderators m where m.user_id=auth.uid() and m.role='admin') then
    raise exception 'Admin access required.';
  end if;
  if not exists(select 1 from public.community_groups where id=p_group_id and is_public=true) then
    raise exception 'Public community group not found.';
  end if;
  if not exists(select 1 from public.profiles where id=p_user_id) then
    raise exception 'User not found.';
  end if;
  if not exists(select 1 from public.community_group_members where group_id=p_group_id and user_id=p_user_id) then
    raise exception 'User must join the group before becoming a moderator.';
  end if;
  insert into public.community_group_moderators(group_id,user_id)
  values(p_group_id,p_user_id)
  on conflict do nothing;
  return true;
end;
$$;

create or replace function public.report_community_group_message(p_message_id uuid,p_reason text,p_details text default '')
returns uuid language plpgsql security definer set search_path=public
as $$
declare
  msg public.community_group_messages;
  report_id uuid;
  clean_reason text;
  clean_details text;
  recent_reports integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  select * into msg from public.community_group_messages where id=p_message_id;
  if msg.id is null then raise exception 'Message not found.'; end if;
  if not exists(select 1 from public.community_group_members where group_id=msg.group_id and user_id=auth.uid()) then
    raise exception 'Join this group before reporting messages.';
  end if;
  if msg.deleted_at is not null then raise exception 'This message has already been removed.'; end if;

  select count(*) into recent_reports
  from public.reports r
  where r.reporter_id=auth.uid()
    and r.target_type='community_group_message'
    and r.created_at > now() - interval '10 minutes';
  if recent_reports >= 10 then raise exception 'Too many reports. Please try again later.'; end if;

  if exists(
    select 1 from public.reports r
    where r.reporter_id=auth.uid()
      and r.target_type='community_group_message'
      and r.target_id=p_message_id
      and r.created_at > now() - interval '24 hours'
  ) then
    raise exception 'You already reported this message.';
  end if;

  clean_reason=left(trim(coalesce(p_reason,'')),120);
  clean_details=left(trim(coalesce(p_details,'')),2000);
  if char_length(clean_reason)<2 then raise exception 'Please provide a report reason.'; end if;
  insert into public.reports(reporter_id,target_type,target_id,reason,details)
  values(auth.uid(),'community_group_message',p_message_id,clean_reason,clean_details)
  returning id into report_id;
  return report_id;
end;
$$;

revoke all on function public.assign_community_group_moderator(uuid,uuid),public.report_community_group_message(uuid,text,text) from public,anon;
grant execute on function public.assign_community_group_moderator(uuid,uuid),public.report_community_group_message(uuid,text,text) to authenticated;

revoke execute on function public.is_platform_admin_or_moderator(uuid),public.is_community_group_moderator(uuid,uuid) from public,anon,authenticated;
