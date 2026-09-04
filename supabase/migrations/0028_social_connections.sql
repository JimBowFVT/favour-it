-- Social graph: friend requests, friendships and blocks.
create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (sender_id <> receiver_id)
);
create unique index if not exists friend_requests_pending_unique on public.friend_requests(sender_id, receiver_id) where status='pending';
create index if not exists friend_requests_receiver_idx on public.friend_requests(receiver_id,status,created_at desc);
create index if not exists friend_requests_sender_idx on public.friend_requests(sender_id,status,created_at desc);

create table if not exists public.friendships (
  user_id uuid not null references public.profiles(id) on delete cascade,
  friend_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
create index if not exists friendships_friend_idx on public.friendships(friend_id);

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks(blocked_id);

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.user_blocks enable row level security;

revoke all on public.friend_requests, public.friendships, public.user_blocks from anon, authenticated;

create or replace function public.send_friend_request(p_user_id uuid)
returns public.friend_requests language plpgsql security definer set search_path=public as $$
declare result public.friend_requests;
begin
  if auth.uid() is null or p_user_id is null or p_user_id = auth.uid() then raise exception 'Invalid friend request.'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'User not found.'; end if;
  if exists(select 1 from public.user_blocks where (blocker_id=auth.uid() and blocked_id=p_user_id) or (blocker_id=p_user_id and blocked_id=auth.uid())) then raise exception 'You cannot connect with this user.'; end if;
  if exists(select 1 from public.friendships where user_id=auth.uid() and friend_id=p_user_id) then raise exception 'You are already friends.'; end if;
  if exists(select 1 from public.friend_requests where sender_id=p_user_id and receiver_id=auth.uid() and status='pending') then raise exception 'This user already sent you a request. Accept it instead.'; end if;
  if exists(select 1 from public.friend_requests where sender_id=auth.uid() and receiver_id=p_user_id and status='pending') then raise exception 'Friend request already sent.'; end if;
  insert into public.friend_requests(sender_id,receiver_id) values(auth.uid(),p_user_id) returning * into result;
  return result;
end; $$;

create or replace function public.respond_friend_request(p_request_id uuid, p_action text)
returns public.friend_requests language plpgsql security definer set search_path=public as $$
declare req public.friend_requests; result public.friend_requests;
begin
  select * into req from public.friend_requests where id=p_request_id and receiver_id=auth.uid() and status='pending' for update;
  if req.id is null then raise exception 'Friend request not found.'; end if;
  if p_action not in ('accept','reject') then raise exception 'Invalid action.'; end if;
  update public.friend_requests set status=case when p_action='accept' then 'accepted' else 'rejected' end,responded_at=now() where id=req.id returning * into result;
  if p_action='accept' then
    insert into public.friendships(user_id,friend_id) values(req.sender_id,req.receiver_id),(req.receiver_id,req.sender_id) on conflict do nothing;
  end if;
  return result;
end; $$;

create or replace function public.cancel_friend_request(p_request_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.friend_requests set status='cancelled',responded_at=now() where id=p_request_id and sender_id=auth.uid() and status='pending';
  return found;
end; $$;

create or replace function public.remove_friend(p_user_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  delete from public.friendships where (user_id=auth.uid() and friend_id=p_user_id) or (user_id=p_user_id and friend_id=auth.uid());
  return found;
end; $$;

create or replace function public.block_user(p_user_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or p_user_id is null or p_user_id=auth.uid() then raise exception 'Invalid block target.'; end if;
  insert into public.user_blocks(blocker_id,blocked_id) values(auth.uid(),p_user_id) on conflict do nothing;
  delete from public.friendships where (user_id=auth.uid() and friend_id=p_user_id) or (user_id=p_user_id and friend_id=auth.uid());
  update public.friend_requests set status='cancelled',responded_at=now() where status='pending' and ((sender_id=auth.uid() and receiver_id=p_user_id) or (sender_id=p_user_id and receiver_id=auth.uid()));
  return true;
end; $$;

create or replace function public.unblock_user(p_user_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin delete from public.user_blocks where blocker_id=auth.uid() and blocked_id=p_user_id; return found; end; $$;

create or replace function public.get_my_social_graph()
returns jsonb language sql security definer set search_path=public as $$
select jsonb_build_object(
 'friends', coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url) order by p.display_name) from public.friendships f join public.profiles p on p.id=f.friend_id where f.user_id=auth.uid()),'[]'::jsonb),
 'incoming', coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'user_id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'created_at',r.created_at) order by r.created_at desc) from public.friend_requests r join public.profiles p on p.id=r.sender_id where r.receiver_id=auth.uid() and r.status='pending'),'[]'::jsonb),
 'outgoing', coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'user_id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'created_at',r.created_at) order by r.created_at desc) from public.friend_requests r join public.profiles p on p.id=r.receiver_id where r.sender_id=auth.uid() and r.status='pending'),'[]'::jsonb),
 'blocked', coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name) order by p.display_name) from public.user_blocks b join public.profiles p on p.id=b.blocked_id where b.blocker_id=auth.uid()),'[]'::jsonb)
); $$;

revoke all on function public.send_friend_request(uuid),public.respond_friend_request(uuid,text),public.cancel_friend_request(uuid),public.remove_friend(uuid),public.block_user(uuid),public.unblock_user(uuid),public.get_my_social_graph() from public,anon;
grant execute on function public.send_friend_request(uuid),public.respond_friend_request(uuid,text),public.cancel_friend_request(uuid),public.remove_friend(uuid),public.block_user(uuid),public.unblock_user(uuid),public.get_my_social_graph() to authenticated;
