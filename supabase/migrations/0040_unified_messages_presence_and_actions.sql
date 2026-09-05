-- Unified Messages: direct-message actions, community forwarding/replies, friend presence, and secure block checks.

alter table public.messages
  add column if not exists reply_to_message_id uuid references public.messages(id) on delete set null,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists deletion_label text;

create index if not exists messages_reply_to_idx on public.messages(reply_to_message_id);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id,created_at desc);

create table if not exists public.message_stars(
  user_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,message_id)
);
alter table public.message_stars enable row level security;
revoke all on public.message_stars from public,anon,authenticated;
drop policy if exists "users can read own message stars" on public.message_stars;
drop policy if exists "users can manage own message stars" on public.message_stars;
create policy "users can read own message stars" on public.message_stars for select to authenticated using(user_id=auth.uid());
create policy "users can manage own message stars" on public.message_stars for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

create table if not exists public.user_presence(
  user_id uuid primary key references public.profiles(id) on delete cascade,
  is_online boolean not null default false,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_presence enable row level security;
revoke all on public.user_presence from public,anon,authenticated;
drop policy if exists "friends can read presence" on public.user_presence;
create policy "friends can read presence" on public.user_presence for select to authenticated using(user_id=auth.uid() or exists(select 1 from public.friendships f where f.user_id=auth.uid() and f.friend_id=user_presence.user_id));

create or replace function public.set_my_presence(p_online boolean default true)
returns public.user_presence language plpgsql security definer set search_path=public as $$
declare result public.user_presence;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.user_presence(user_id,is_online,last_seen_at,updated_at) values(auth.uid(),coalesce(p_online,true),now(),now())
  on conflict(user_id) do update set is_online=excluded.is_online,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at
  returning * into result;
  return result;
end; $$;

create or replace function public.get_presence_for_users(p_user_ids uuid[])
returns table(user_id uuid,is_online boolean,last_seen_at timestamptz)
language sql security definer set search_path=public as $$
select up.user_id,(up.is_online and up.last_seen_at>now()-interval '60 seconds') as is_online,up.last_seen_at
from public.user_presence up
where up.user_id=any(coalesce(p_user_ids,'{}'::uuid[]))
  and (up.user_id=auth.uid() or exists(select 1 from public.friendships f where f.user_id=auth.uid() and f.friend_id=up.user_id));
$$;

create or replace function public.get_or_create_direct_conversation(p_username text)
returns uuid language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); target uuid; c uuid; a uuid; b uuid;
begin
  if u is null then raise exception 'not authenticated'; end if;
  select id into target from public.profiles where username_chosen=true and lower(username)=lower(trim(p_username));
  if target is null then raise exception 'User not found.'; end if;
  if target=u then raise exception 'You cannot message yourself.'; end if;
  if exists(select 1 from public.user_blocks ub where (ub.blocker_id=u and ub.blocked_id=target) or (ub.blocker_id=target and ub.blocked_id=u)) then raise exception 'Messaging is unavailable because one of you has blocked the other.'; end if;
  a:=least(u,target); b:=greatest(u,target);
  select conversation_id into c from public.direct_conversations where user_one=a and user_two=b;
  if c is not null then return c; end if;
  insert into public.conversations default values returning id into c;
  insert into public.conversation_members(conversation_id,user_id) values(c,u),(c,target);
  insert into public.direct_conversations(conversation_id,user_one,user_two) values(c,a,b);
  return c;
end; $$;

drop function if exists public.get_my_direct_conversations();
create function public.get_my_direct_conversations()
returns table(conversation_id uuid,other_user_id uuid,other_username text,other_display_name text,other_avatar_url text,last_message text,last_message_at timestamptz,unread_count bigint,is_friend boolean,is_online boolean,last_seen_at timestamptz)
language sql stable security definer set search_path=public as $$
with mine as(select conversation_id from public.conversation_members where user_id=auth.uid()),
direct as(select dc.conversation_id,case when dc.user_one=auth.uid() then dc.user_two else dc.user_one end other_id from public.direct_conversations dc join mine m on m.conversation_id=dc.conversation_id),
latest as(select distinct on(m.conversation_id)m.conversation_id,case when m.deleted_at is null then m.body else coalesce(m.deletion_label,'Message deleted.') end body,m.created_at from public.messages m join mine x on x.conversation_id=m.conversation_id order by m.conversation_id,m.created_at desc)
select d.conversation_id,d.other_id,p.username,p.display_name,p.avatar_url,l.body,l.created_at,
(select count(*) from public.messages m left join public.conversation_reads cr on cr.conversation_id=m.conversation_id and cr.user_id=auth.uid() where m.conversation_id=d.conversation_id and m.sender_id<>auth.uid() and(cr.last_read_at is null or m.created_at>cr.last_read_at))::bigint,
exists(select 1 from public.friendships f where f.user_id=auth.uid() and f.friend_id=d.other_id),
coalesce(up.is_online and up.last_seen_at>now()-interval '60 seconds',false),up.last_seen_at
from direct d join public.profiles p on p.id=d.other_id left join latest l on l.conversation_id=d.conversation_id left join public.user_presence up on up.user_id=d.other_id
order by l.created_at desc nulls last;
$$;

drop function if exists public.get_direct_messages(uuid);
create function public.get_direct_messages(p_conversation_id uuid)
returns table(id uuid,conversation_id uuid,sender_id uuid,username text,display_name text,avatar_url text,body text,created_at timestamptz,updated_at timestamptz,is_deleted boolean,deleted_by_self boolean,reply_to_message_id uuid,reply_to_username text,reply_to_body text,is_starred boolean)
language sql stable security definer set search_path=public as $$
select m.id,m.conversation_id,m.sender_id,p.username,p.display_name,p.avatar_url,case when m.deleted_at is null then m.body else coalesce(m.deletion_label,'Message deleted.') end,m.created_at,m.updated_at,m.deleted_at is not null,m.deleted_by=auth.uid(),m.reply_to_message_id,rp.username,case when rm.deleted_at is null then rm.body else 'Message deleted.' end,exists(select 1 from public.message_stars s where s.user_id=auth.uid() and s.message_id=m.id)
from public.messages m join public.conversation_members me on me.conversation_id=m.conversation_id and me.user_id=auth.uid()
join public.profiles p on p.id=m.sender_id left join public.messages rm on rm.id=m.reply_to_message_id left join public.profiles rp on rp.id=rm.sender_id
where m.conversation_id=p_conversation_id order by m.created_at asc limit 500;
$$;

drop function if exists public.send_direct_message(uuid,text);
drop function if exists public.send_direct_message(uuid,text,uuid);
create function public.send_direct_message(p_conversation_id uuid,p_body text,p_reply_to_message_id uuid default null)
returns public.messages language plpgsql security definer set search_path=public as $$
declare result public.messages; clean_body text; target uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  clean_body=trim(coalesce(p_body,''));
  if char_length(clean_body)<1 or char_length(clean_body)>5000 then raise exception 'Message must be between 1 and 5000 characters.'; end if;
  if not exists(select 1 from public.conversation_members where conversation_id=p_conversation_id and user_id=auth.uid()) then raise exception 'You are not a member of this conversation.'; end if;
  select case when dc.user_one=auth.uid() then dc.user_two else dc.user_one end into target from public.direct_conversations dc where dc.conversation_id=p_conversation_id;
  if target is null then raise exception 'Direct conversation not found.'; end if;
  if exists(select 1 from public.user_blocks ub where (ub.blocker_id=auth.uid() and ub.blocked_id=target) or (ub.blocker_id=target and ub.blocked_id=auth.uid())) then raise exception 'Messaging is unavailable because one of you has blocked the other.'; end if;
  if p_reply_to_message_id is not null and not exists(select 1 from public.messages rm where rm.id=p_reply_to_message_id and rm.conversation_id=p_conversation_id) then raise exception 'Reply target not found.'; end if;
  insert into public.messages(conversation_id,sender_id,body,reply_to_message_id) values(p_conversation_id,auth.uid(),clean_body,p_reply_to_message_id) returning * into result;
  return result;
end; $$;

create or replace function public.delete_own_direct_message(p_message_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare msg public.messages;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  select * into msg from public.messages where id=p_message_id for update;
  if msg.id is null or msg.sender_id<>auth.uid() then raise exception 'You can only delete your own messages.'; end if;
  if msg.deleted_at is not null then return true; end if;
  if msg.created_at<now()-interval '15 minutes' then raise exception 'Messages can only be deleted within 15 minutes.'; end if;
  update public.messages set deleted_at=now(),deleted_by=auth.uid(),deletion_label=coalesce((select coalesce(display_name,username,'This user') from public.profiles where id=auth.uid()),'This user')||' deleted a message.' where id=p_message_id;
  return true;
end; $$;

create or replace function public.toggle_direct_message_star(p_message_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v boolean;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if not exists(select 1 from public.messages m join public.conversation_members cm on cm.conversation_id=m.conversation_id and cm.user_id=auth.uid() where m.id=p_message_id) then raise exception 'Message not found.'; end if;
  if exists(select 1 from public.message_stars where user_id=auth.uid() and message_id=p_message_id) then delete from public.message_stars where user_id=auth.uid() and message_id=p_message_id; v=false;
  else insert into public.message_stars(user_id,message_id) values(auth.uid(),p_message_id); v=true; end if;
  return v;
end; $$;

create or replace function public.get_my_starred_direct_messages()
returns table(message_id uuid,conversation_id uuid,other_user_id uuid,other_username text,other_display_name text,body text,created_at timestamptz,starred_at timestamptz)
language sql security definer set search_path=public as $$
select s.message_id,m.conversation_id,case when dc.user_one=auth.uid() then dc.user_two else dc.user_one end,op.username,op.display_name,m.body,m.created_at,s.created_at
from public.message_stars s join public.messages m on m.id=s.message_id join public.direct_conversations dc on dc.conversation_id=m.conversation_id
join public.profiles op on op.id=case when dc.user_one=auth.uid() then dc.user_two else dc.user_one end where s.user_id=auth.uid() order by s.created_at desc;
$$;

alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check check(target_type=any(array['deal','order','user','message','review','community_group_message','direct_message']));
create or replace function public.report_direct_message(p_message_id uuid,p_reason text,p_details text default '')
returns uuid language plpgsql security definer set search_path=public as $$
declare msg public.messages; rid uuid; clean_reason text; clean_details text;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  select * into msg from public.messages where id=p_message_id;
  if msg.id is null then raise exception 'Message not found.'; end if;
  if not exists(select 1 from public.conversation_members where conversation_id=msg.conversation_id and user_id=auth.uid()) then raise exception 'You are not a member of this conversation.'; end if;
  clean_reason=left(trim(coalesce(p_reason,'')),120);clean_details=left(trim(coalesce(p_details,'')),2000);
  if char_length(clean_reason)<2 then raise exception 'Please provide a report reason.'; end if;
  if exists(select 1 from public.reports where reporter_id=auth.uid() and target_type='direct_message' and target_id=p_message_id and created_at>now()-interval '24 hours') then raise exception 'You already reported this message.'; end if;
  insert into public.reports(reporter_id,target_type,target_id,reason,details) values(auth.uid(),'direct_message',p_message_id,clean_reason,clean_details) returning id into rid;
  return rid;
end; $$;

revoke all on function public.set_my_presence(boolean),public.get_presence_for_users(uuid[]) from public,anon;
grant execute on function public.set_my_presence(boolean),public.get_presence_for_users(uuid[]) to authenticated;
revoke all on function public.get_or_create_direct_conversation(text),public.get_my_direct_conversations(),public.get_direct_messages(uuid),public.send_direct_message(uuid,text,uuid),public.delete_own_direct_message(uuid),public.toggle_direct_message_star(uuid),public.get_my_starred_direct_messages(),public.report_direct_message(uuid,text,text) from public,anon;
grant execute on function public.get_or_create_direct_conversation(text),public.get_my_direct_conversations(),public.get_direct_messages(uuid),public.send_direct_message(uuid,text,uuid),public.delete_own_direct_message(uuid),public.toggle_direct_message_star(uuid),public.get_my_starred_direct_messages(),public.report_direct_message(uuid,text,text) to authenticated;
revoke all on public.user_presence from anon,public;
