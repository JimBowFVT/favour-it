create or replace function public.admin_list_message_reports()
returns table(id uuid,target_type text,target_id uuid,reporter_id uuid,reporter_username text,reporter_display_name text,reason text,details text,status text,created_at timestamptz,resolved_by uuid,resolved_at timestamptz,message_body text,message_created_at timestamptz,message_sender_id uuid,message_sender_username text,message_sender_display_name text,community_id uuid,community_name text,is_deleted boolean)
language sql security definer set search_path=public as $$
select r.id,r.target_type,r.target_id,r.reporter_id,rp.username,rp.display_name,r.reason,r.details,r.status,r.created_at,r.resolved_by,r.resolved_at,
case when r.target_type='community_group_message' then coalesce(cm.body,'') else coalesce(dm.body,'') end,
case when r.target_type='community_group_message' then cm.created_at else dm.created_at end,
case when r.target_type='community_group_message' then cm.sender_id else dm.sender_id end,
case when r.target_type='community_group_message' then cp.username else dp.username end,
case when r.target_type='community_group_message' then cp.display_name else dp.display_name end,
case when r.target_type='community_group_message' then cm.group_id else null end,
case when r.target_type='community_group_message' then cg.name else null end,
case when r.target_type='community_group_message' then cm.deleted_at is not null else dm.deleted_at is not null end
from public.reports r join public.profiles rp on rp.id=r.reporter_id
left join public.community_group_messages cm on r.target_type='community_group_message' and cm.id=r.target_id
left join public.community_groups cg on cg.id=cm.group_id
left join public.profiles cp on cp.id=cm.sender_id
left join public.messages dm on r.target_type='direct_message' and dm.id=r.target_id
left join public.profiles dp on dp.id=dm.sender_id
where exists(select 1 from public.moderators m where m.user_id=auth.uid() and m.role in('moderator','admin'))
and r.target_type in('community_group_message','direct_message') order by r.created_at desc limit 500;
$$;
revoke all on function public.admin_list_message_reports() from public,anon,authenticated;
grant execute on function public.admin_list_message_reports() to authenticated;
