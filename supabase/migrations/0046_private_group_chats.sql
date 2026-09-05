-- Private group chats inside the unified Messages inbox.

alter table public.groups drop constraint if exists groups_name_key;

create table if not exists public.private_group_conversations (
  group_id uuid primary key references public.groups(id) on delete cascade,
  conversation_id uuid not null unique references public.conversations(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.private_group_conversations enable row level security;

drop policy if exists "public can view groups" on public.groups;
drop policy if exists "members can view group membership" on public.group_members;
revoke all on public.groups,public.group_members,public.private_group_conversations from anon,authenticated;

create index if not exists group_members_user_group_idx on public.group_members(user_id,group_id);
create index if not exists group_members_group_role_idx on public.group_members(group_id,role);

create or replace function public.get_my_private_groups()
returns table(group_id uuid,name text,description text,created_by uuid,my_role text,member_count bigint,conversation_id uuid,last_message text,last_message_at timestamptz,unread_count bigint)
language sql stable security definer set search_path=public as $$
  with mine as (
    select g.id,g.name,g.description,g.created_by,gm.role,pgc.conversation_id
    from public.group_members gm
    join public.groups g on g.id=gm.group_id
    join public.private_group_conversations pgc on pgc.group_id=g.id
    where gm.user_id=auth.uid()
  )
  select m.id,m.name,m.description,m.created_by,m.role,
    (select count(*) from public.group_members all_members where all_members.group_id=m.id)::bigint,
    m.conversation_id,latest.body,latest.created_at,
    (select count(*) from public.messages msg left join public.conversation_reads cr on cr.conversation_id=msg.conversation_id and cr.user_id=auth.uid() where msg.conversation_id=m.conversation_id and msg.sender_id<>auth.uid() and (cr.last_read_at is null or msg.created_at>cr.last_read_at))::bigint
  from mine m
  left join lateral (
    select case when msg.deleted_at is null then msg.body else coalesce(msg.deletion_label,'Message deleted.') end body,msg.created_at
    from public.messages msg where msg.conversation_id=m.conversation_id order by msg.created_at desc limit 1
  ) latest on true
  order by latest.created_at desc nulls last,m.name;
$$;

create or replace function public.create_private_group(p_name text,p_member_ids uuid[] default '{}'::uuid[])
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_owner uuid:=auth.uid(); v_name text:=left(trim(coalesce(p_name,'')),80); v_group uuid; v_conversation uuid; v_members uuid[]; v_member uuid;
begin
  if v_owner is null then raise exception 'You must be signed in.'; end if;
  if char_length(v_name)<2 then raise exception 'Group name must be at least 2 characters.'; end if;
  select coalesce(array_agg(distinct x),'{}'::uuid[]) into v_members from unnest(coalesce(p_member_ids,'{}'::uuid[])) x where x is not null and x<>v_owner;
  if coalesce(array_length(v_members,1),0)<1 then raise exception 'Choose at least one friend.'; end if;
  if coalesce(array_length(v_members,1),0)>19 then raise exception 'Private groups can have up to 20 members including you.'; end if;
  foreach v_member in array v_members loop
    if not exists(select 1 from public.profiles p where p.id=v_member) then raise exception 'One selected member no longer exists.'; end if;
    if not exists(select 1 from public.friendships f where f.user_id=v_owner and f.friend_id=v_member) then raise exception 'Private groups can only be created with friends.'; end if;
    if exists(select 1 from public.user_blocks b where (b.blocker_id=v_owner and b.blocked_id=v_member) or (b.blocker_id=v_member and b.blocked_id=v_owner)) then raise exception 'A selected member is unavailable.'; end if;
  end loop;
  insert into public.groups(name,description,created_by) values(v_name,'',v_owner) returning id into v_group;
  insert into public.conversations default values returning id into v_conversation;
  insert into public.private_group_conversations(group_id,conversation_id) values(v_group,v_conversation);
  insert into public.group_members(group_id,user_id,role) values(v_group,v_owner,'owner');
  insert into public.group_members(group_id,user_id,role) select v_group,x,'member' from unnest(v_members) x;
  insert into public.conversation_members(conversation_id,user_id) values(v_conversation,v_owner);
  insert into public.conversation_members(conversation_id,user_id) select v_conversation,x from unnest(v_members) x on conflict do nothing;
  return v_group;
end;
$$;

create or replace function public.send_private_group_message(p_group_id uuid,p_body text,p_reply_to_message_id uuid default null)
returns public.messages language plpgsql security definer set search_path=public as $$
declare
  v_conversation uuid; v_body text:=trim(coalesce(p_body,'')); v_result public.messages; v_recent integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if char_length(v_body)<1 or char_length(v_body)>5000 then raise exception 'Message must be between 1 and 5000 characters.'; end if;
  select pgc.conversation_id into v_conversation from public.private_group_conversations pgc join public.group_members gm on gm.group_id=pgc.group_id and gm.user_id=auth.uid() where pgc.group_id=p_group_id;
  if v_conversation is null then raise exception 'You are not a member of this group.'; end if;
  if p_reply_to_message_id is not null and not exists(select 1 from public.messages m where m.id=p_reply_to_message_id and m.conversation_id=v_conversation and m.deleted_at is null) then raise exception 'You cannot reply to a deleted or unavailable message.'; end if;
  select count(*) into v_recent from public.messages m where m.conversation_id=v_conversation and m.sender_id=auth.uid() and m.created_at>now()-interval '30 seconds';
  if v_recent>=12 then raise exception 'You are sending messages too quickly. Please wait a moment.'; end if;
  insert into public.messages(conversation_id,sender_id,body,reply_to_message_id) values(v_conversation,auth.uid(),v_body,p_reply_to_message_id) returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.leave_private_group(p_group_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_conversation uuid; v_role text; v_next_owner uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  select gm.role,pgc.conversation_id into v_role,v_conversation from public.group_members gm join public.private_group_conversations pgc on pgc.group_id=gm.group_id where gm.group_id=p_group_id and gm.user_id=auth.uid() for update;
  if v_conversation is null then return false; end if;
  if v_role='owner' then
    select gm.user_id into v_next_owner from public.group_members gm where gm.group_id=p_group_id and gm.user_id<>auth.uid() order by case gm.role when 'moderator' then 0 else 1 end,gm.joined_at limit 1;
    if v_next_owner is null then delete from public.groups where id=p_group_id; return true; end if;
    update public.group_members set role='owner' where group_id=p_group_id and user_id=v_next_owner;
    update public.groups set created_by=v_next_owner where id=p_group_id;
  end if;
  delete from public.group_members where group_id=p_group_id and user_id=auth.uid();
  delete from public.conversation_members where conversation_id=v_conversation and user_id=auth.uid();
  return true;
end;
$$;

revoke execute on function public.get_my_private_groups(),public.create_private_group(text,uuid[]),public.send_private_group_message(uuid,text,uuid),public.leave_private_group(uuid) from public,anon;
grant execute on function public.get_my_private_groups(),public.create_private_group(text,uuid[]),public.send_private_group_message(uuid,text,uuid),public.leave_private_group(uuid) to authenticated;
