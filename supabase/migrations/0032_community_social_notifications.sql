-- Social notifications for friend requests and accepted connections.

create or replace function public.send_friend_request(p_user_id uuid)
returns public.friend_requests language plpgsql security definer set search_path=public as $$
declare result public.friend_requests; sender_name text;
begin
  if auth.uid() is null or p_user_id is null or p_user_id=auth.uid() then raise exception 'Invalid friend request.'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'User not found.'; end if;
  if exists(select 1 from public.user_blocks where (blocker_id=auth.uid() and blocked_id=p_user_id) or (blocker_id=p_user_id and blocked_id=auth.uid())) then raise exception 'You cannot connect with this user.'; end if;
  if exists(select 1 from public.friendships where user_id=auth.uid() and friend_id=p_user_id) then raise exception 'You are already friends.'; end if;
  if exists(select 1 from public.friend_requests where sender_id=p_user_id and receiver_id=auth.uid() and status='pending') then raise exception 'This user already sent you a request. Accept it instead.'; end if;
  if exists(select 1 from public.friend_requests where sender_id=auth.uid() and receiver_id=p_user_id and status='pending') then raise exception 'Friend request already sent.'; end if;
  insert into public.friend_requests(sender_id,receiver_id) values(auth.uid(),p_user_id) returning * into result;
  select coalesce(display_name,username,'A Favourit member') into sender_name from public.profiles where id=auth.uid();
  perform public.notify_user(p_user_id,'friend_request','New friend request',sender_name || ' wants to connect with you.',jsonb_build_object('request_id',result.id,'user_id',auth.uid()));
  return result;
end; $$;

create or replace function public.respond_friend_request(p_request_id uuid,p_action text)
returns public.friend_requests language plpgsql security definer set search_path=public as $$
declare req public.friend_requests; result public.friend_requests; responder_name text;
begin
  select * into req from public.friend_requests where id=p_request_id and receiver_id=auth.uid() and status='pending' for update;
  if req.id is null then raise exception 'Friend request not found.'; end if;
  if p_action not in ('accept','reject') then raise exception 'Invalid action.'; end if;
  update public.friend_requests set status=case when p_action='accept' then 'accepted' else 'rejected' end,responded_at=now() where id=req.id returning * into result;
  if p_action='accept' then
    insert into public.friendships(user_id,friend_id) values(req.sender_id,req.receiver_id),(req.receiver_id,req.sender_id) on conflict do nothing;
    select coalesce(display_name,username,'A Favourit member') into responder_name from public.profiles where id=auth.uid();
    perform public.notify_user(req.sender_id,'friend_request_accepted','Connection accepted',responder_name || ' accepted your friend request.',jsonb_build_object('user_id',auth.uid()));
  end if;
  return result;
end; $$;

revoke all on function public.send_friend_request(uuid),public.respond_friend_request(uuid,text) from public,anon;
grant execute on function public.send_friend_request(uuid),public.respond_friend_request(uuid,text) to authenticated;
