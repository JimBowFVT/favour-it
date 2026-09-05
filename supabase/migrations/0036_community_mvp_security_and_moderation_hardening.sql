-- Community MVP hardening: lock down read RPCs and expose reliable current-user/moderator state.
drop function if exists public.get_community_group_members(uuid);

create function public.get_community_group_members(p_group_id uuid)
returns table(user_id uuid, username text, display_name text, avatar_url text, is_moderator boolean, is_current_user boolean)
language sql
security definer
set search_path=public
as $$
  select p.id,
         p.username,
         p.display_name,
         p.avatar_url,
         exists (
           select 1
           from public.community_group_moderators gm
           where gm.group_id=p_group_id and gm.user_id=p.id
         ) as is_moderator,
         p.id=auth.uid() as is_current_user
  from public.community_group_members m
  join public.profiles p on p.id=m.user_id
  where m.group_id=p_group_id
    and exists (select 1 from public.community_groups g where g.id=p_group_id and g.is_public=true)
  order by case when p.id=auth.uid() then 0 else 1 end, p.display_name nulls last, p.username;
$$;

revoke execute on function public.get_community_group_members(uuid) from public,anon;
grant execute on function public.get_community_group_members(uuid) to authenticated;
revoke execute on function public.get_community_group_messages(uuid) from public,anon;
grant execute on function public.get_community_group_messages(uuid) to authenticated;

create index if not exists community_group_members_group_user_idx on public.community_group_members(group_id,user_id);
create index if not exists community_group_messages_group_created_idx on public.community_group_messages(group_id,created_at desc);
create index if not exists community_group_moderators_group_user_idx on public.community_group_moderators(group_id,user_id);
create index if not exists friend_requests_receiver_status_idx on public.friend_requests(receiver_id,status);
create index if not exists friend_requests_sender_status_idx on public.friend_requests(sender_id,status);
