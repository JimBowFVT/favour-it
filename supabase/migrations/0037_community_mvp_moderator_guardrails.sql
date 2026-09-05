create or replace function public.moderate_community_group_member(p_group_id uuid,p_user_id uuid,p_action text)
returns boolean language plpgsql security definer set search_path=public
as $$
declare action_name text; actor_is_platform boolean; target_is_moderator boolean; removed boolean;
begin
 if auth.uid() is null then raise exception 'You must be signed in.'; end if;
 actor_is_platform:=public.is_platform_admin_or_moderator(auth.uid());
 if not actor_is_platform and not exists(select 1 from public.community_group_moderators gm where gm.group_id=p_group_id and gm.user_id=auth.uid()) then raise exception 'Moderator access required.'; end if;
 action_name:=lower(trim(coalesce(p_action,'')));
 if action_name<>'remove' then raise exception 'Unsupported member action.'; end if;
 if p_user_id is null or p_user_id=auth.uid() then raise exception 'You cannot remove yourself from moderation.'; end if;
 target_is_moderator:=public.is_platform_admin_or_moderator(p_user_id) or exists(select 1 from public.community_group_moderators gm where gm.group_id=p_group_id and gm.user_id=p_user_id);
 if target_is_moderator and not actor_is_platform then raise exception 'Only a platform moderator can remove a moderator.'; end if;
 delete from public.community_group_members where group_id=p_group_id and user_id=p_user_id;
 get diagnostics removed=row_count;
 return removed>0;
end $$;
revoke execute on function public.moderate_community_group_member(uuid,uuid,text) from public,anon;
grant execute on function public.moderate_community_group_member(uuid,uuid,text) to authenticated;
