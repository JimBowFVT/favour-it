-- Message-report guardrails and deal-like RPCs.

create or replace function public.report_direct_message(p_message_id uuid,p_reason text,p_details text default '')
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  msg public.messages;
  rid uuid;
  clean_reason text;
  clean_details text;
  recent_reports integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  select * into msg from public.messages where id=p_message_id;
  if msg.id is null then raise exception 'Message not found.'; end if;
  if not exists(select 1 from public.conversation_members where conversation_id=msg.conversation_id and user_id=auth.uid()) then
    raise exception 'You are not a member of this conversation.';
  end if;
  if msg.sender_id=auth.uid() then raise exception 'You cannot report your own message.'; end if;

  select count(*) into recent_reports
  from public.reports
  where reporter_id=auth.uid()
    and target_type='direct_message'
    and created_at>now()-interval '10 minutes';
  if recent_reports>=10 then raise exception 'Too many reports. Please try again later.'; end if;

  clean_reason=left(trim(coalesce(p_reason,'')),120);
  clean_details=left(trim(coalesce(p_details,'')),2000);
  if char_length(clean_reason)<2 then raise exception 'Please provide a report reason.'; end if;
  if exists(select 1 from public.reports where reporter_id=auth.uid() and target_type='direct_message' and target_id=p_message_id and created_at>now()-interval '24 hours') then
    raise exception 'You already reported this message.';
  end if;

  insert into public.reports(reporter_id,target_type,target_id,reason,details)
  values(auth.uid(),'direct_message',p_message_id,clean_reason,clean_details)
  returning id into rid;
  return rid;
end;
$$;

create or replace function public.report_community_group_message(p_message_id uuid,p_reason text,p_details text default '')
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  msg public.community_group_messages;
  report_id uuid;
  clean_reason text;
  clean_details text;
  recent_reports integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  select * into msg from public.community_group_messages where id=p_message_id;
  if msg.id is null then raise exception 'Message not found.'; end if;
  if not exists(select 1 from public.community_group_members where group_id=msg.group_id and user_id=auth.uid()) then
    raise exception 'Join this group before reporting messages.';
  end if;
  if msg.sender_id=auth.uid() then raise exception 'You cannot report your own message.'; end if;

  select count(*) into recent_reports
  from public.reports r
  where r.reporter_id=auth.uid()
    and r.target_type='community_group_message'
    and r.created_at>now()-interval '10 minutes';
  if recent_reports>=10 then raise exception 'Too many reports. Please try again later.'; end if;

  if exists(select 1 from public.reports r where r.reporter_id=auth.uid() and r.target_type='community_group_message' and r.target_id=p_message_id and r.created_at>now()-interval '24 hours') then
    raise exception 'You already reported this message.';
  end if;

  clean_reason=left(trim(coalesce(p_reason,'')),120);
  clean_details=left(trim(coalesce(p_details,'')),2000);
  if char_length(clean_reason)<2 then raise exception 'Please provide a report reason.'; end if;

  insert into public.reports(reporter_id,target_type,target_id,reason,details)
  values(auth.uid(),'community_group_message',p_message_id,clean_reason,clean_details)
  returning id into report_id;
  return report_id;
end;
$$;

create or replace function public.get_my_liked_deal_ids()
returns table(deal_id uuid)
language sql
stable
security definer
set search_path=public
as $$
  select f.deal_id
  from public.favorites f
  where f.user_id=auth.uid()
  order by f.created_at desc;
$$;

create or replace function public.set_deal_liked(p_deal_id uuid,p_liked boolean)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if p_deal_id is null then raise exception 'Deal not found.'; end if;
  if not exists(select 1 from public.deals d where d.id=p_deal_id and (d.status='published' or d.seller_id=auth.uid())) then
    raise exception 'Deal not found.';
  end if;

  if coalesce(p_liked,false) then
    insert into public.favorites(user_id,deal_id)
    values(auth.uid(),p_deal_id)
    on conflict(user_id,deal_id) do nothing;
    return true;
  end if;

  delete from public.favorites where user_id=auth.uid() and deal_id=p_deal_id;
  return false;
end;
$$;

revoke execute on function public.report_direct_message(uuid,text,text),public.report_community_group_message(uuid,text,text),public.get_my_liked_deal_ids(),public.set_deal_liked(uuid,boolean) from public,anon;
grant execute on function public.report_direct_message(uuid,text,text),public.report_community_group_message(uuid,text,text),public.get_my_liked_deal_ids(),public.set_deal_liked(uuid,boolean) to authenticated;
