create or replace function public.search_community_people(p_query text)
returns table(id uuid, username text, display_name text, avatar_url text, bio text)
language sql
stable
security definer
set search_path=public
as $$
  with params as (
    select trim(replace(coalesce(p_query,''),'@','')) as q, auth.uid() as me
  ),
  my_groups as (
    select cgm.group_id from public.community_group_members cgm, params p where cgm.user_id=p.me
  ),
  my_categories as (
    select distinct lower(trim(d.category)) as category
    from public.deals d, params p
    where d.seller_id=p.me and nullif(trim(d.category),'') is not null
  ),
  my_friends as (
    select case when f.user_id=p.me then f.friend_id else f.user_id end as friend_id
    from public.friendships f, params p
    where f.user_id=p.me or f.friend_id=p.me
  ),
  candidates as (
    select pr.id,pr.username,pr.display_name,pr.avatar_url,pr.bio,pr.is_verified,
      (select count(*) from public.community_group_members cgm join my_groups mg on mg.group_id=cgm.group_id where cgm.user_id=pr.id) as shared_groups,
      (select count(distinct case when f.user_id=pr.id then f.friend_id else f.user_id end)
       from public.friendships f
       join my_friends mf on mf.friend_id=case when f.user_id=pr.id then f.friend_id else f.user_id end
       where f.user_id=pr.id or f.friend_id=pr.id) as mutual_friends,
      (select count(distinct lower(trim(d.category))) from public.deals d join my_categories mc on mc.category=lower(trim(d.category)) where d.seller_id=pr.id) as shared_categories,
      (select count(*) from public.deals d where d.seller_id=pr.id and d.status::text in ('published','active')) as active_deals
    from public.profiles pr, params p
    where pr.id<>p.me
      and nullif(trim(coalesce(pr.username,'')||' '||coalesce(pr.display_name,'')||' '||coalesce(pr.bio,'')),'') is not null
      and not exists(select 1 from public.user_blocks b where (b.blocker_id=p.me and b.blocked_id=pr.id) or (b.blocker_id=pr.id and b.blocked_id=p.me))
  )
  select c.id,c.username,c.display_name,c.avatar_url,c.bio
  from candidates c, params p
  where p.q=''
     or c.username ilike '%'||p.q||'%'
     or c.display_name ilike '%'||p.q||'%'
     or c.bio ilike '%'||p.q||'%'
  order by
    case when p.q<>'' and lower(c.username)=lower(p.q) then 0
         when p.q<>'' and c.username ilike p.q||'%' then 1
         when p.q<>'' and c.display_name ilike p.q||'%' then 2
         when p.q<>'' then 3
         else 4 end,
    case when p.q='' then (c.shared_groups*8 + c.mutual_friends*6 + c.shared_categories*4 + least(c.active_deals,5)*2 + case when c.is_verified then 2 else 0 end) else 0 end desc,
    c.display_name nulls last,c.username
  limit 24;
$$;
revoke all on function public.search_community_people(text) from public,anon;
grant execute on function public.search_community_people(text) to authenticated;
