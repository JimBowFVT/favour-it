create table if not exists public.direct_message_request_states (
  conversation_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  state text not null check (state in ('accepted','declined')),
  updated_at timestamptz not null default now(),
  primary key (conversation_id,user_id)
);

alter table public.direct_message_request_states enable row level security;
revoke all on public.direct_message_request_states from anon, authenticated;

insert into public.direct_message_request_states(conversation_id,user_id,state)
select dc.conversation_id, u.user_id, 'accepted'
from public.direct_conversations dc
cross join lateral (values (dc.user_one),(dc.user_two)) as u(user_id)
where exists (
  select 1 from public.friendships f
  where (f.user_id=dc.user_one and f.friend_id=dc.user_two)
     or (f.user_id=dc.user_two and f.friend_id=dc.user_one)
)
or exists (
  select 1 from public.friend_requests fr
  where fr.status='accepted'
    and ((fr.sender_id=dc.user_one and fr.receiver_id=dc.user_two)
      or (fr.sender_id=dc.user_two and fr.receiver_id=dc.user_one))
)
on conflict (conversation_id,user_id) do update set state='accepted',updated_at=now();

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

drop function if exists public.get_my_direct_conversations();
create function public.get_my_direct_conversations()
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
    from public.direct_conversations dc join mine m on m.conversation_id=dc.conversation_id
  ),
  latest as (
    select distinct on (m.conversation_id) m.conversation_id,
           case when m.deleted_at is null then m.body else coalesce(m.deletion_label,'Message deleted.') end as body,
           m.created_at
    from public.messages m join mine x on x.conversation_id=m.conversation_id
    order by m.conversation_id,m.created_at desc
  ),
  first_message as (
    select distinct on (m.conversation_id) m.conversation_id,m.sender_id
    from public.messages m join mine x on x.conversation_id=m.conversation_id
    order by m.conversation_id,m.created_at asc
  )
  select d.conversation_id,d.other_id,p.username,p.display_name,p.avatar_url,l.body,l.created_at,
    (select count(*) from public.messages m left join public.conversation_reads cr on cr.conversation_id=m.conversation_id and cr.user_id=auth.uid()
      where m.conversation_id=d.conversation_id and m.sender_id<>auth.uid() and (cr.last_read_at is null or m.created_at>cr.last_read_at))::bigint,
    exists(select 1 from public.friendships f where f.user_id=auth.uid() and f.friend_id=d.other_id),
    coalesce(up.is_online and up.last_seen_at>now()-interval '60 seconds',false),
    up.last_seen_at,
    (
      not exists(select 1 from public.friendships f where f.user_id=auth.uid() and f.friend_id=d.other_id)
      and fm.sender_id is not null and fm.sender_id<>auth.uid()
      and coalesce(rs.state,'pending') <> 'accepted'
    ) as is_message_request
  from direct d
  join public.profiles p on p.id=d.other_id
  left join latest l on l.conversation_id=d.conversation_id
  left join first_message fm on fm.conversation_id=d.conversation_id
  left join public.user_presence up on up.user_id=d.other_id
  left join public.direct_message_request_states rs on rs.conversation_id=d.conversation_id and rs.user_id=auth.uid()
  where coalesce(rs.state,'pending') <> 'declined'
  order by l.created_at desc nulls last;
$$;
revoke all on function public.get_my_direct_conversations() from public,anon;
grant execute on function public.get_my_direct_conversations() to authenticated;

create or replace function public.remove_friend(p_user_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare affected boolean;
begin
  insert into public.direct_message_request_states(conversation_id,user_id,state,updated_at)
  select dc.conversation_id, u.user_id, 'accepted', now()
  from public.direct_conversations dc
  cross join lateral (values (dc.user_one),(dc.user_two)) as u(user_id)
  where (dc.user_one=auth.uid() and dc.user_two=p_user_id) or (dc.user_one=p_user_id and dc.user_two=auth.uid())
  on conflict (conversation_id,user_id) do update set state='accepted',updated_at=now();

  delete from public.friendships where (user_id=auth.uid() and friend_id=p_user_id) or (user_id=p_user_id and friend_id=auth.uid());
  affected := found;
  return affected;
end; $$;
revoke all on function public.remove_friend(uuid) from public,anon;
grant execute on function public.remove_friend(uuid) to authenticated;
