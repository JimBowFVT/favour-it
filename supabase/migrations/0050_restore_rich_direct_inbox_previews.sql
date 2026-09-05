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
           case
             when m.deleted_at is not null then coalesce(m.deletion_label,'Message deleted.')
             when nullif(trim(m.body),'') is not null then m.body
             when m.deal_id is not null then '★ Deal'
             when exists(select 1 from public.direct_message_media media where media.message_id=m.id) then 'Media'
             else 'Message'
           end as body,
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
    and (
      coalesce(rs.state,'pending') <> 'declined'
      or exists(
        select 1 from public.friendships f
        where f.user_id=auth.uid() and f.friend_id=d.other_id
      )
    )
  order by l.created_at desc nulls last;
$$;

revoke all on function public.get_my_direct_conversations() from public,anon;
grant execute on function public.get_my_direct_conversations() to authenticated;