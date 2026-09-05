-- Community message actions: author deletion, replies, stars and richer moderation/report state.
alter table public.community_group_messages
  add column if not exists reply_to_message_id uuid references public.community_group_messages(id) on delete set null;

create index if not exists community_group_messages_reply_idx
  on public.community_group_messages(reply_to_message_id);

create table if not exists public.community_group_message_stars (
  user_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.community_group_messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

alter table public.community_group_message_stars enable row level security;
revoke all on public.community_group_message_stars from public, anon, authenticated;

drop policy if exists "users can read own community stars" on public.community_group_message_stars;
drop policy if exists "users can manage own community stars" on public.community_group_message_stars;
create policy "users can read own community stars" on public.community_group_message_stars for select to authenticated using (user_id=auth.uid());
create policy "users can manage own community stars" on public.community_group_message_stars for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

drop function if exists public.get_community_group_messages(uuid);
create function public.get_community_group_messages(p_group_id uuid)
returns table(
  id uuid, group_id uuid, sender_id uuid, username text, display_name text, avatar_url text,
  body text, created_at timestamptz, is_deleted boolean, is_moderator boolean,
  reply_to_message_id uuid, reply_to_username text, reply_to_body text,
  deleted_by_self boolean, deletion_label text, is_starred boolean
)
language sql security definer set search_path=public as $$
  select
    m.id, m.group_id, m.sender_id, p.username, p.display_name, p.avatar_url,
    case
      when m.deleted_at is null then m.body
      else case when m.deleted_by=auth.uid() then 'You deleted this message.'
                when m.moderation_reason='Deleted by author.' then coalesce(p.display_name,p.username,'This user') || ' deleted a message.'
                else 'This message was removed by a moderator.' end
    end as body,
    m.created_at,
    m.deleted_at is not null,
    public.is_community_group_moderator(p_group_id,auth.uid()),
    m.reply_to_message_id,
    rp.username,
    case when rm.deleted_at is null then rm.body else 'Message deleted.' end,
    m.deleted_by=auth.uid(),
    case
      when m.deleted_at is null then null
      when m.deleted_by=auth.uid() then 'You deleted this message.'
      when m.moderation_reason='Deleted by author.' then coalesce(p.display_name,p.username,'This user') || ' deleted a message.'
      else 'This message was removed by a moderator.'
    end,
    exists(select 1 from public.community_group_message_stars s where s.user_id=auth.uid() and s.message_id=m.id)
  from public.community_group_messages m
  join public.profiles p on p.id=m.sender_id
  left join public.community_group_messages rm on rm.id=m.reply_to_message_id
  left join public.profiles rp on rp.id=rm.sender_id
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

create or replace function public.send_community_group_message(p_group_id uuid,p_body text,p_reply_to_message_id uuid)
returns public.community_group_messages language plpgsql security definer set search_path=public as $$
declare result public.community_group_messages; clean_body text; recent_count integer;
begin
  clean_body=trim(coalesce(p_body,''));
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if char_length(clean_body)<1 or char_length(clean_body)>2000 then raise exception 'Message must be between 1 and 2000 characters.'; end if;
  if not exists(select 1 from public.community_group_members where group_id=p_group_id and user_id=auth.uid()) then raise exception 'Join this group before posting.'; end if;
  if p_reply_to_message_id is not null and not exists(select 1 from public.community_group_messages where id=p_reply_to_message_id and group_id=p_group_id) then raise exception 'Reply target not found.'; end if;
  select count(*) into recent_count from public.community_group_messages where group_id=p_group_id and sender_id=auth.uid() and created_at > now() - interval '30 seconds';
  if recent_count >= 10 then raise exception 'You are sending messages too quickly. Please wait a moment.'; end if;
  insert into public.community_group_messages(group_id,sender_id,body,reply_to_message_id) values(p_group_id,auth.uid(),clean_body,p_reply_to_message_id) returning * into result;
  return result;
end; $$;

create or replace function public.delete_own_community_group_message(p_message_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare msg public.community_group_messages;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  select * into msg from public.community_group_messages where id=p_message_id for update;
  if msg.id is null then raise exception 'Message not found.'; end if;
  if msg.sender_id<>auth.uid() then raise exception 'You can only delete your own messages.'; end if;
  if msg.deleted_at is not null then return true; end if;
  if msg.created_at < now() - interval '15 minutes' then raise exception 'Messages can only be deleted within 15 minutes.'; end if;
  update public.community_group_messages
    set deleted_at=now(), deleted_by=auth.uid(), moderation_reason='Deleted by author.'
    where id=p_message_id;
  return true;
end; $$;

create or replace function public.toggle_community_group_message_star(p_message_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare now_starred boolean;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if not exists(select 1 from public.community_group_messages m join public.community_group_members gm on gm.group_id=m.group_id and gm.user_id=auth.uid() where m.id=p_message_id) then raise exception 'You must be a group member.'; end if;
  if exists(select 1 from public.community_group_message_stars where user_id=auth.uid() and message_id=p_message_id) then
    delete from public.community_group_message_stars where user_id=auth.uid() and message_id=p_message_id;
    now_starred=false;
  else
    insert into public.community_group_message_stars(user_id,message_id) values(auth.uid(),p_message_id);
    now_starred=true;
  end if;
  return now_starred;
end; $$;

create or replace function public.get_my_starred_community_messages()
returns table(message_id uuid, group_id uuid, group_name text, sender_id uuid, username text, display_name text, body text, created_at timestamptz, starred_at timestamptz)
language sql security definer set search_path=public as $$
  select s.message_id,m.group_id,g.name,m.sender_id,p.username,p.display_name,m.body,m.created_at,s.created_at
  from public.community_group_message_stars s
  join public.community_group_messages m on m.id=s.message_id
  join public.community_groups g on g.id=m.group_id
  join public.profiles p on p.id=m.sender_id
  where s.user_id=auth.uid()
  order by s.created_at desc;
$$;

create or replace function public.report_community_group_message(p_message_id uuid,p_reason text,p_details text default '')
returns uuid language plpgsql security definer set search_path=public as $$
declare msg public.community_group_messages; report_id uuid; clean_reason text; clean_details text; recent_reports integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  select * into msg from public.community_group_messages where id=p_message_id;
  if msg.id is null then raise exception 'Message not found.'; end if;
  if not exists(select 1 from public.community_group_members where group_id=msg.group_id and user_id=auth.uid()) then raise exception 'Join this group before reporting messages.'; end if;
  select count(*) into recent_reports from public.reports r where r.reporter_id=auth.uid() and r.target_type='community_group_message' and r.created_at > now() - interval '10 minutes';
  if recent_reports >= 10 then raise exception 'Too many reports. Please try again later.'; end if;
  if exists(select 1 from public.reports r where r.reporter_id=auth.uid() and r.target_type='community_group_message' and r.target_id=p_message_id and r.created_at > now() - interval '24 hours') then raise exception 'You already reported this message.'; end if;
  clean_reason=left(trim(coalesce(p_reason,'')),120); clean_details=left(trim(coalesce(p_details,'')),2000);
  if char_length(clean_reason)<2 then raise exception 'Please provide a report reason.'; end if;
  insert into public.reports(reporter_id,target_type,target_id,reason,details) values(auth.uid(),'community_group_message',p_message_id,clean_reason,clean_details) returning id into report_id;
  return report_id;
end; $$;

revoke all on function public.delete_own_community_group_message(uuid),public.toggle_community_group_message_star(uuid),public.get_my_starred_community_messages() from public,anon;
grant execute on function public.delete_own_community_group_message(uuid),public.toggle_community_group_message_star(uuid),public.get_my_starred_community_messages() to authenticated;
revoke execute on function public.send_community_group_message(uuid,text),public.send_community_group_message(uuid,text,uuid),public.get_community_group_messages(uuid),public.report_community_group_message(uuid,text,text) from public,anon;
grant execute on function public.send_community_group_message(uuid,text),public.send_community_group_message(uuid,text,uuid),public.get_community_group_messages(uuid),public.report_community_group_message(uuid,text,text) to authenticated;
