create or replace function public.admin_get_dashboard_metrics()
returns jsonb
language plpgsql
security definer
set search_path to 'public','auth'
as $$
declare result jsonb;
begin
  if not public.is_favourit_admin() then raise exception 'admin access required'; end if;
  select jsonb_build_object(
    'users', (select count(*) from auth.users),
    'published_deals', (select count(*) from public.deals where status='published'),
    'active_orders', (select count(*) from public.orders where status in ('funded','in_progress','delivered','disputed')),
    'open_disputes', (select count(*) from public.disputes where status in ('open','under_review')),
    'middlemen', (select count(*) from public.moderators where role='middleman'),
    'open_reports', (select count(*) from public.reports where status in ('open','reviewing')),
    'available_fav', coalesce((select sum(available_fav) from public.wallets),0),
    'held_fav', coalesce((select sum(held_fav) from public.wallets),0),
    'platform_fav', coalesce((select available_fav from public.platform_accounts where id=true),0)
  ) into result;
  return result;
end;
$$;

create or replace function public.admin_list_mediation_orders()
returns table(order_id uuid, deal_title text, status text, amount_fav bigint, fee_fav bigint, buyer_id uuid, buyer_username text, buyer_display_name text, seller_id uuid, seller_username text, seller_display_name text, dispute_id uuid, dispute_status text, dispute_reason text, dispute_created_at timestamptz, middleman_id uuid, middleman_username text, middleman_display_name text, assigned_at timestamptz, created_at timestamptz)
language sql security definer set search_path to 'public','auth' as $$
  select o.id,d.title,o.status::text,o.amount_fav,o.fee_fav,o.buyer_id,bp.username,bp.display_name,o.seller_id,sp.username,sp.display_name,dis.id,dis.status,dis.reason,dis.created_at,case when om.active then om.middleman_id else null end,case when om.active then mp.username else null end,case when om.active then mp.display_name else null end,case when om.active then om.assigned_at else null end,o.created_at
  from public.orders o
  join public.deals d on d.id=o.deal_id
  join public.profiles bp on bp.id=o.buyer_id
  join public.profiles sp on sp.id=o.seller_id
  left join public.disputes dis on dis.order_id=o.id
  left join public.order_middlemen om on om.order_id=o.id
  left join public.profiles mp on mp.id=om.middleman_id
  where public.is_favourit_admin() and (o.status in ('funded','in_progress','delivered','disputed') or dis.status in ('open','under_review'))
  order by case when o.status='disputed' then 0 else 1 end, coalesce(dis.created_at,o.created_at) desc
  limit 250;
$$;

create or replace function public.admin_list_middlemen()
returns table(user_id uuid, username text, display_name text, active_assignments bigint, joined_at timestamptz)
language sql security definer set search_path to 'public','auth' as $$
  select m.user_id,p.username,p.display_name,(select count(*) from public.order_middlemen om where om.middleman_id=m.user_id and om.active=true)::bigint as active_assignments,m.created_at
  from public.moderators m
  join public.profiles p on p.id=m.user_id
  where public.is_favourit_admin() and m.role='middleman'
  order by 4 asc, p.display_name nulls last, p.username;
$$;

create or replace function public.get_my_middleman_queue()
returns table(order_id uuid, deal_title text, order_status text, amount_fav bigint, fee_fav bigint, buyer_id uuid, buyer_username text, buyer_display_name text, seller_id uuid, seller_username text, seller_display_name text, dispute_id uuid, dispute_status text, dispute_reason text, assigned_at timestamptz, created_at timestamptz)
language sql security definer set search_path to 'public' as $$
  select o.id,d.title,o.status::text,o.amount_fav,o.fee_fav,o.buyer_id,bp.username,bp.display_name,o.seller_id,sp.username,sp.display_name,dis.id,dis.status,dis.reason,om.assigned_at,o.created_at
  from public.order_middlemen om
  join public.orders o on o.id=om.order_id
  join public.deals d on d.id=o.deal_id
  join public.profiles bp on bp.id=o.buyer_id
  join public.profiles sp on sp.id=o.seller_id
  left join public.disputes dis on dis.order_id=o.id
  where om.middleman_id=auth.uid() and om.active=true and exists(select 1 from public.moderators m where m.user_id=auth.uid() and m.role='middleman')
  order by case when o.status='disputed' then 0 else 1 end, om.assigned_at desc;
$$;

create or replace function public.get_my_staff_role()
returns text language sql stable security definer set search_path to 'public' as $$
  select case when public.is_favourit_admin() then 'admin' else coalesce((select role from public.moderators where user_id=auth.uid()),'user') end;
$$;

revoke execute on function public.admin_get_dashboard_metrics() from public,anon;
revoke execute on function public.admin_list_mediation_orders() from public,anon;
revoke execute on function public.admin_list_middlemen() from public,anon;
revoke execute on function public.get_my_middleman_queue() from public,anon;
revoke execute on function public.get_my_staff_role() from public,anon;
grant execute on function public.admin_get_dashboard_metrics() to authenticated;
grant execute on function public.admin_list_mediation_orders() to authenticated;
grant execute on function public.admin_list_middlemen() to authenticated;
grant execute on function public.get_my_middleman_queue() to authenticated;
grant execute on function public.get_my_staff_role() to authenticated;
