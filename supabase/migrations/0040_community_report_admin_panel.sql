create or replace function public.admin_list_community_reports()
returns table(
  report_id uuid, reporter_id uuid, reporter_username text, reporter_display_name text,
  group_id uuid, group_name text, message_id uuid, message_sender_id uuid,
  message_username text, message_display_name text, message_body text,
  message_created_at timestamptz, message_deleted_at timestamptz,
  reason text, details text, status text, created_at timestamptz
)
language sql security definer set search_path=public as $$
  select r.id,r.reporter_id,rp.username,rp.display_name,
    m.group_id,g.name,m.id,m.sender_id,mp.username,mp.display_name,m.body,
    m.created_at,m.deleted_at,r.reason,r.details,r.status,r.created_at
  from public.reports r
  join public.community_group_messages m on m.id=r.target_id
  join public.community_groups g on g.id=m.group_id
  join public.profiles rp on rp.id=r.reporter_id
  join public.profiles mp on mp.id=m.sender_id
  where r.target_type='community_group_message'
    and exists(select 1 from public.moderators mod where mod.user_id=auth.uid() and mod.role in ('admin','moderator'))
  order by r.created_at desc
  limit 200;
$$;
revoke execute on function public.admin_list_community_reports() from public,anon;
grant execute on function public.admin_list_community_reports() to authenticated;
