-- Community moderation: reports, soft-delete, moderator controls and message rate limiting.

alter table public.community_group_messages
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id),
  add column if not exists moderation_reason text;

create index if not exists community_group_messages_visible_idx
  on public.community_group_messages(group_id,created_at desc)
  where deleted_at is null;

create or replace function public.is_platform_admin_or_moderator(p_user_id uuid)
returns boolean language sql security definer set search_path=public as $$
  select exists(select 1 from public.moderators m where m.user_id=p_user_id and m.role in ('admin','moderator','middleman'));
$$;

create or replace function public.is_community_group_moderator(p_group_id uuid,p_user_id uuid)
returns boolean language sql security definer set search_path=public as $$
  select public.is_platform_admin_or_moderator(p_user_id)
    or exists(select 1 from public.community_group_moderators gm where gm.group_id=p_group_id and gm.user_id=p_user_id);
$$;

create or replace function public.assign_community_group_moderator(p_group_id uuid,p_user_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not exists(select 1 from public.moderators m where m.user_id=auth.uid() and m.role='admin') then raise exception 'Admin access required.'; end if;
  if not exists(select 1 from public.community_groups where id=p_group_id) then raise exception 'Community group not found.'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'User not found.'; end if;
  insert into public.community_group_moderators(group_id,user_id) values(p_group_id,p_user_id) on conflict do nothing;
  return true;
end; $$;

create or replace function public.remove_community_group_moderator(p_group_id uuid,p_user_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not exists(select 1 from public.moderators m where m.user_id=auth.uid() and m.role='admin') then raise exception 'Admin access required.'; end if;
  delete from public.community_group_moderators where group_id=p_group_id and user_id=p_user_id;
  return found;
end; $$;

create or replace function public.report_community_group_message(p_message_id uuid,p_reason text,p_details text default '')
returns uuid language plpgsql security definer set search_path=public as $$
declare msg public.community_group_messages; report_id uuid; clean_reason text; clean_details text;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  select * into msg from public.community_group_messages where id=p_message_id;
  if msg.id is null then raise exception 'Message not found.'; end if;
  if not exists(select 1 from public.community_group_members where group_id=msg.group_id and user_id=auth.uid()) then raise exception 'Join this group before reporting messages.'; end if;
  clean_reason=left(trim(coalesce(p_reason,'')),120);
  clean_details=left(trim(coalesce(p_details,'')),2000);
  if char_length(clean_reason)<2 then raise exception 'Please provide a report reason.'; end if;
  insert into public.reports(reporter_id,target_type,target_id,reason,details)
    values(auth.uid(),'community_group_message',p_message_id,clean_reason,clean_details)
    returning id into report_id;
  return report_id;
end; $$;

create or replace function public.moderate_community_group_message(p_message_id uuid,p_action text,p_reason text default '')
returns boolean language plpgsql security definer set search_path=public as $$
declare msg public.community_group_messages; action_name text;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  select * into msg from public.community_group_messages where id=p_message_id for update;
  if msg.id is null then raise exception 'Message not found.'; end if;
  if not public.is_community_group_moderator(msg.group_id,auth.uid()) then raise exception 'Moderator access required.'; end if;
  action_name=lower(trim(coalesce(p_action,'')));
  if action_name <> 'delete' then raise exception 'Unsupported moderation action.'; end if;
  if msg.deleted_at is null then
    update public.community_group_messages
      set deleted_at=now(),deleted_by=auth.uid(),moderation_reason=left(trim(coalesce(p_reason,'Removed by a community moderator.')),500)
      where id=p_message_id;
  end if;
  return true;
end; $$;

create or replace function public.moderate_community_group_member(p_group_id uuid,p_user_id uuid,p_action text)
returns boolean language plpgsql security definer set search_path=public as $$
declare action_name text;
begin
  if auth.uid() is null or not public.is_community_group_moderator(p_group_id,auth.uid()) then raise exception 'Moderator access required.'; end if;
  action_name=lower(trim(coalesce(p_action,'')));
  if action_name <> 'remove' then raise exception 'Unsupported member action.'; end if;
  delete from public.community_group_members where group_id=p_group_id and user_id=p_user_id;
  return found;
end; $$;

drop function if exists public.get_community_group_messages(uuid);
drop function if exists public.get_community_group_members(uuid);

create or replace function public.get_community_group_messages(p_group_id uuid)
returns table(id uuid,group_id uuid,sender_id uuid,username text,display_name text,avatar_url text,body text,created_at timestamptz,is_deleted boolean,is_moderator boolean)
language sql security definer set search_path=public as $$
  select m.id,m.group_id,m.sender_id,p.username,p.display_name,p.avatar_url,
    case when m.deleted_at is null then m.body else 'This message was removed by a moderator.' end,
    m.created_at,m.deleted_at is not null,public.is_community_group_moderator(p_group_id,auth.uid())
  from public.community_group_messages m
  join public.profiles p on p.id=m.sender_id
  where m.group_id=p_group_id
    and exists(select 1 from public.community_groups g where g.id=p_group_id and g.is_public)
    and exists(select 1 from public.community_group_members gm where gm.group_id=p_group_id and gm.user_id=auth.uid())
  order by m.created_at asc limit 200;
$$;

create or replace function public.send_community_group_message(p_group_id uuid,p_body text)
returns public.community_group_messages language plpgsql security definer set search_path=public as $$
declare result public.community_group_messages; clean_body text; recent_count integer;
begin
  clean_body=trim(coalesce(p_body,''));
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if char_length(clean_body)<1 or char_length(clean_body)>2000 then raise exception 'Message must be between 1 and 2000 characters.'; end if;
  if not exists(select 1 from public.community_group_members where group_id=p_group_id and user_id=auth.uid()) then raise exception 'Join this group before posting.'; end if;
  select count(*) into recent_count from public.community_group_messages where group_id=p_group_id and sender_id=auth.uid() and created_at > now() - interval '30 seconds';
  if recent_count >= 10 then raise exception 'You are sending messages too quickly. Please wait a moment.'; end if;
  insert into public.community_group_messages(group_id,sender_id,body) values(p_group_id,auth.uid(),clean_body) returning * into result;
  return result;
end; $$;

create or replace function public.get_community_group_members(p_group_id uuid)
returns table(user_id uuid,username text,display_name text,avatar_url text,joined_at timestamptz,is_moderator boolean)
language sql security definer set search_path=public as $$
  select p.id,p.username,p.display_name,p.avatar_url,m.joined_at,public.is_community_group_moderator(p_group_id,p.id)
  from public.community_group_members m join public.profiles p on p.id=m.user_id
  where m.group_id=p_group_id
    and exists(select 1 from public.community_groups g where g.id=p_group_id and g.is_public)
  order by m.joined_at asc limit 200;
$$;

revoke all on function public.is_platform_admin_or_moderator(uuid),public.is_community_group_moderator(uuid,uuid),public.assign_community_group_moderator(uuid,uuid),public.remove_community_group_moderator(uuid,uuid),public.report_community_group_message(uuid,text,text),public.moderate_community_group_message(uuid,text,text),public.moderate_community_group_member(uuid,uuid,text) from public,anon;
grant execute on function public.is_platform_admin_or_moderator(uuid),public.is_community_group_moderator(uuid,uuid),public.assign_community_group_moderator(uuid,uuid),public.remove_community_group_moderator(uuid,uuid),public.report_community_group_message(uuid,text,text),public.moderate_community_group_message(uuid,text,text),public.moderate_community_group_member(uuid,uuid,text),public.get_community_group_messages(uuid),public.send_community_group_message(uuid,text),public.get_community_group_members(uuid) to authenticated;
