-- Public profile read model + blocked-account management.
-- Public profile data is exposed through controlled RPCs instead of broad profile/table access.

create or replace function public.get_public_profile(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; viewer uuid := auth.uid(); target public.profiles; friend_status text := 'none'; blocked_by_me boolean := false; blocked_me boolean := false; completed_deals integer := 0; published_deals integer := 0; avg_rating numeric := 0; review_count integer := 0;
begin
 if viewer is null then raise exception 'You must be signed in.'; end if;
 select * into target from public.profiles where id=p_user_id; if target.id is null then raise exception 'User not found.'; end if;
 select exists(select 1 from public.user_blocks where blocker_id=viewer and blocked_id=p_user_id) into blocked_by_me;
 select exists(select 1 from public.user_blocks where blocker_id=p_user_id and blocked_id=viewer) into blocked_me;
 if exists(select 1 from public.friendships where user_id=viewer and friend_id=p_user_id) then friend_status:='friends'; elsif exists(select 1 from public.friend_requests where sender_id=viewer and receiver_id=p_user_id and status='pending') then friend_status:='outgoing'; elsif exists(select 1 from public.friend_requests where sender_id=p_user_id and receiver_id=viewer and status='pending') then friend_status:='incoming'; end if;
 select count(*)::integer into published_deals from public.deals where seller_id=p_user_id and status='published';
 select count(*)::integer into completed_deals from public.orders where seller_id=p_user_id and status='completed';
 select coalesce(round(avg(r.rating)::numeric,2),0),count(*)::integer into avg_rating,review_count from public.reviews r where r.seller_id=p_user_id;
 select jsonb_build_object('id',target.id,'username',target.username,'display_name',target.display_name,'bio',coalesce(target.bio,''),'avatar_url',target.avatar_url,'is_verified',target.is_verified,'created_at',target.created_at,'friend_status',friend_status,'blocked_by_me',blocked_by_me,'blocked_me',blocked_me,'stats',jsonb_build_object('published_deals',published_deals,'completed_deals',completed_deals,'rating',avg_rating,'review_count',review_count),'deals',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'description',d.description,'category',d.category,'price_fav',d.price_fav,'delivery_days',d.delivery_days,'created_at',d.created_at) order by d.created_at desc) from public.deals d where d.seller_id=p_user_id and d.status='published'),'[]'::jsonb),'reviews',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'rating',r.rating,'body',coalesce(r.body,''),'created_at',r.created_at,'reviewer',jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url)) order by r.created_at desc) from public.reviews r join public.profiles p on p.id=r.reviewer_id where r.seller_id=p_user_id limit 20),'[]'::jsonb),'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'slug',g.slug,'name',g.name,'description',g.description) order by g.name) from public.community_group_members gm join public.community_groups g on g.id=gm.group_id where gm.user_id=p_user_id and g.is_public=true),'[]'::jsonb)) into result;
 return result;
end; $$;

create or replace function public.get_public_profile_by_username(p_username text)
returns jsonb language sql security definer set search_path=public as $$
 select public.get_public_profile(p.id) from public.profiles p where lower(p.username)=lower(trim(both '@' from p_username)) limit 1;
$$;

create or replace function public.get_blocked_accounts()
returns jsonb language sql security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'blocked_at',b.created_at) order by b.created_at desc),'[]'::jsonb) from public.user_blocks b join public.profiles p on p.id=b.blocked_id where b.blocker_id=auth.uid();
$$;

revoke all on function public.get_public_profile(uuid),public.get_public_profile_by_username(text),public.get_blocked_accounts() from public,anon;
grant execute on function public.get_public_profile(uuid),public.get_public_profile_by_username(text),public.get_blocked_accounts() to authenticated;
create index if not exists orders_seller_status_idx on public.orders(seller_id,status,created_at desc);
create index if not exists deals_seller_status_created_idx on public.deals(seller_id,status,created_at desc);
