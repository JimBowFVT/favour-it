-- Internal authorization helpers must not be callable by clients.
revoke execute on function public.is_platform_admin_or_moderator(uuid),public.is_community_group_moderator(uuid,uuid) from public,anon,authenticated;
