create or replace function public.get_my_direct_conversations()
returns table(
  conversation_id uuid,
  other_user_id uuid,
  other_username text,
  other_display_name text,
  other_avatar_url text,
  last_message text,
  last_message_at timestamptz,
  unread_count bigint,
  is_friend boolean,
  is_online boolean,
  last_seen_at timestamptz,
  is_message_request boolean
)
language sql
stable
security definer
set search_path=public
as $$
  with mine as (
    select conversation_id from public.conversation_members where user_id=auth.uid()
  ),
  direct as (
    select dc.conversation_id,
           case when dc.user_one=auth.uid() then dc.user_two else dc.user_one end as other_id
    from public.direct_conversations dc
    join mine m on m.conversation_id=dc.conversation_id
  ),
  latest as (
    select distinct on (m.conversation_id)
           m.conversation_id,
           case when m.deleted_at is null then m.body else coalesce(m.deletion_label,'Message deleted.') end as body,
           m.created_at
    from public.messages m
    join mine x on x.conversation_id=m.conversation_id
    order by m.conversation_id,m.created_at desc
  ),
  first_message as (
    select distinct on (m.conversation_id)
           m.conversation_id,
           m.sender_id
    from public.messages m
    join mine x on x.conversation_id=m.conversation_id
    order by m.conversation_id,m.created_at asc
  )
  select
    d.conversation_id,
    d.other_id,
    p.username,
    p.display_name,
    p.avatar_url,
    l.body,
    l.created_at,
    (
      select count(*)
      from public.messages m
      left join public.conversation_reads cr
        on cr.conversation_id=m.conversation_id and cr.user_id=auth.uid()
      where m.conversation_id=d.conversation_id
        and m.sender_id<>auth.uid()
        and (cr.last_read_at is null or m.created_at>cr.last_read_at)
    )::bigint,
    exists(
      select 1 from public.friendships f
      where f.user_id=auth.uid() and f.friend_id=d.other_id
    ),
    coalesce(up.is_online and up.last_seen_at>now()-interval '60 seconds',false),
    up.last_seen_at,
    (
      not exists(
        select 1 from public.friendships f
        where f.user_id=auth.uid() and f.friend_id=d.other_id
      )
      and fm.sender_id is not null
      and fm.sender_id<>auth.uid()
      and coalesce(rs.state,'pending') <> 'accepted'
    ) as is_message_request
  from direct d
  join public.profiles p on p.id=d.other_id
  left join latest l on l.conversation_id=d.conversation_id
  left join first_message fm on fm.conversation_id=d.conversation_id
  left join public.user_presence up on up.user_id=d.other_id
  left join public.direct_message_request_states rs
    on rs.conversation_id=d.conversation_id and rs.user_id=auth.uid()
  where not exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id=auth.uid() and ub.blocked_id=d.other_id)
       or (ub.blocker_id=d.other_id and ub.blocked_id=auth.uid())
  )
  order by l.created_at desc nulls last;
$$;

revoke all on function public.get_my_direct_conversations() from public,anon;
grant execute on function public.get_my_direct_conversations() to authenticated;

create or replace function public.accept_direct_message_request(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare first_sender uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated.'; end if;
  if not exists(select 1 from public.conversation_members where conversation_id=p_conversation_id and user_id=auth.uid()) then
    raise exception 'Conversation not found.';
  end if;
  select m.sender_id into first_sender from public.messages m where m.conversation_id=p_conversation_id order by m.created_at asc limit 1;
  if first_sender is null or first_sender=auth.uid() then raise exception 'This is not an incoming message request.'; end if;
  insert into public.direct_message_request_states(conversation_id,user_id,state,updated_at)
  values(p_conversation_id,auth.uid(),'accepted',now())
  on conflict (conversation_id,user_id) do update set state='accepted',updated_at=now();
  return true;
end;
$$;

create or replace function public.decline_direct_message_request(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare first_sender uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated.'; end if;
  if not exists(select 1 from public.conversation_members where conversation_id=p_conversation_id and user_id=auth.uid()) then
    raise exception 'Conversation not found.';
  end if;
  select m.sender_id into first_sender from public.messages m where m.conversation_id=p_conversation_id order by m.created_at asc limit 1;
  if first_sender is null or first_sender=auth.uid() then raise exception 'This is not an incoming message request.'; end if;
  insert into public.direct_message_request_states(conversation_id,user_id,state,updated_at)
  values(p_conversation_id,auth.uid(),'declined',now())
  on conflict (conversation_id,user_id) do update set state='declined',updated_at=now();
  return true;
end;
$$;

revoke all on function public.accept_direct_message_request(uuid), public.decline_direct_message_request(uuid) from public,anon;
grant execute on function public.accept_direct_message_request(uuid), public.decline_direct_message_request(uuid) to authenticated;

create or replace function public.remove_friend(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare affected boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated.'; end if;
  insert into public.direct_message_request_states(conversation_id,user_id,state,updated_at)
  select dc.conversation_id, u.user_id, 'accepted', now()
  from public.direct_conversations dc
  cross join lateral (values (dc.user_one),(dc.user_two)) as u(user_id)
  where ((dc.user_one=auth.uid() and dc.user_two=p_user_id) or (dc.user_one=p_user_id and dc.user_two=auth.uid()))
    and exists(select 1 from public.messages m where m.conversation_id=dc.conversation_id)
  on conflict (conversation_id,user_id) do update set state='accepted',updated_at=now();
  delete from public.friendships where (user_id=auth.uid() and friend_id=p_user_id) or (user_id=p_user_id and friend_id=auth.uid());
  affected := found;
  return affected;
end;
$$;

revoke all on function public.remove_friend(uuid) from public,anon;
grant execute on function public.remove_friend(uuid) to authenticated;

create or replace function public.send_direct_message(
  p_conversation_id uuid,
  p_body text,
  p_reply_to_message_id uuid default null,
  p_asset_ids uuid[] default '{}'::uuid[],
  p_deal_id uuid default null
)
returns public.messages
language plpgsql
security definer
set search_path=public
as $$
declare
  result public.messages;
  clean_body text:=trim(coalesce(p_body,''));
  target uuid;
  snapshot jsonb;
  asset_count integer:=coalesce(array_length(p_asset_ids,1),0);
  first_sender uuid;
  existing_message_count bigint;
  are_friends boolean;
  my_request_state text;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if char_length(clean_body)>5000 then raise exception 'Message must be 5000 characters or less.'; end if;
  if asset_count>4 then raise exception 'You can attach up to 4 media items.'; end if;
  if not exists(select 1 from public.conversation_members where conversation_id=p_conversation_id and user_id=auth.uid()) then raise exception 'You are not a member of this conversation.'; end if;

  select case when dc.user_one=auth.uid() then dc.user_two else dc.user_one end into target
  from public.direct_conversations dc where dc.conversation_id=p_conversation_id;
  if target is null then raise exception 'Direct conversation not found.'; end if;

  if exists(select 1 from public.user_blocks ub where (ub.blocker_id=auth.uid() and ub.blocked_id=target) or (ub.blocker_id=target and ub.blocked_id=auth.uid())) then
    raise exception 'Messaging is unavailable because one of you has blocked the other.';
  end if;

  select count(*) into existing_message_count from public.messages m where m.conversation_id=p_conversation_id;
  select exists(select 1 from public.friendships f where f.user_id=auth.uid() and f.friend_id=target) into are_friends;
  select m.sender_id into first_sender from public.messages m where m.conversation_id=p_conversation_id order by m.created_at asc limit 1;
  select rs.state into my_request_state from public.direct_message_request_states rs where rs.conversation_id=p_conversation_id and rs.user_id=auth.uid();

  if existing_message_count=0 and not are_friends and asset_count>0 then
    raise exception 'Your first message to someone who is not your friend must be text only.';
  end if;

  if first_sender is not null and first_sender<>auth.uid() and not are_friends and coalesce(my_request_state,'pending')<>'accepted' then
    raise exception 'Accept this message request before replying.';
  end if;

  if p_reply_to_message_id is not null and not exists(select 1 from public.messages rm where rm.id=p_reply_to_message_id and rm.conversation_id=p_conversation_id and rm.deleted_at is null) then
    raise exception 'You cannot reply to a deleted or unavailable message.';
  end if;
  if exists(select 1 from unnest(coalesce(p_asset_ids,'{}'::uuid[])) aid where not public.can_use_message_media_asset(aid)) then
    raise exception 'One or more media items are unavailable.';
  end if;
  if p_deal_id is not null then
    snapshot:=public.build_deal_message_snapshot(p_deal_id);
    if snapshot is null then raise exception 'Deal is unavailable.'; end if;
  end if;
  if clean_body='' and asset_count=0 and snapshot is null then raise exception 'Add text, media, or a deal before sending.'; end if;

  insert into public.messages(conversation_id,sender_id,body,reply_to_message_id,deal_id,deal_snapshot)
  values(p_conversation_id,auth.uid(),clean_body,p_reply_to_message_id,p_deal_id,snapshot)
  returning * into result;

  insert into public.direct_message_media(message_id,asset_id,position)
  select result.id,asset_id,(ord-1)::smallint
  from unnest(coalesce(p_asset_ids,'{}'::uuid[])) with ordinality as x(asset_id,ord)
  on conflict do nothing;
  return result;
end;
$$;

revoke all on function public.send_direct_message(uuid,text,uuid,uuid[],uuid) from public,anon;
grant execute on function public.send_direct_message(uuid,text,uuid,uuid[],uuid) to authenticated;