-- Public discovery for Community. Keep search scoped to public profile fields.
create or replace function public.search_community_people(p_query text)
returns table(id uuid,username text,display_name text,avatar_url text,bio text)
language sql security definer set search_path=public as $$
  select p.id,p.username,p.display_name,p.avatar_url,p.bio
  from public.profiles p
  where p.id <> auth.uid()
    and nullif(trim(coalesce(p.username,'')||' '||coalesce(p.display_name,'')||' '||coalesce(p.bio,'')),'') is not null
    and (p.username ilike '%'||trim(replace(coalesce(p_query,''),'@',''))||'%' or p.display_name ilike '%'||trim(coalesce(p_query,''))||'%' or p.bio ilike '%'||trim(coalesce(p_query,''))||'%')
    and not exists(select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=auth.uid()))
  order by p.display_name,p.username
  limit 24;
$$;
revoke all on function public.search_community_people(text) from public,anon;
grant execute on function public.search_community_people(text) to authenticated;
