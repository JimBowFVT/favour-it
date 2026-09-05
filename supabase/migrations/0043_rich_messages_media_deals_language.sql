-- Rich messaging: private media, deal widgets, forwardable rich drafts and per-user translation language.

alter table public.profiles
  add column if not exists preferred_language text not null default 'en';

alter table public.messages
  add column if not exists deal_id uuid references public.deals(id) on delete set null,
  add column if not exists deal_snapshot jsonb;

alter table public.community_group_messages
  add column if not exists deal_id uuid references public.deals(id) on delete set null,
  add column if not exists deal_snapshot jsonb;

alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_check check (char_length(body) <= 5000);
alter table public.community_group_messages drop constraint if exists community_group_messages_body_check;
alter table public.community_group_messages add constraint community_group_messages_body_check check (char_length(body) <= 2000);

create table if not exists public.message_media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  media_type text not null check (media_type in ('image','video')),
  mime_type text not null,
  file_name text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  created_at timestamptz not null default now()
);

create table if not exists public.direct_message_media (
  message_id uuid not null references public.messages(id) on delete cascade,
  asset_id uuid not null references public.message_media_assets(id) on delete restrict,
  position smallint not null default 0 check (position >= 0 and position < 8),
  primary key (message_id, asset_id)
);

create table if not exists public.community_message_media (
  message_id uuid not null references public.community_group_messages(id) on delete cascade,
  asset_id uuid not null references public.message_media_assets(id) on delete restrict,
  position smallint not null default 0 check (position >= 0 and position < 8),
  primary key (message_id, asset_id)
);

alter table public.message_media_assets enable row level security;
alter table public.direct_message_media enable row level security;
alter table public.community_message_media enable row level security;
revoke all on public.message_media_assets, public.direct_message_media, public.community_message_media from public, anon, authenticated;

create index if not exists direct_message_media_asset_idx on public.direct_message_media(asset_id);
create index if not exists community_message_media_asset_idx on public.community_message_media(asset_id);
create index if not exists message_media_assets_owner_created_idx on public.message_media_assets(owner_id, created_at desc);
create index if not exists messages_deal_idx on public.messages(deal_id) where deal_id is not null;
create index if not exists community_group_messages_deal_idx on public.community_group_messages(deal_id) where deal_id is not null;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'message-media','message-media',false,52428800,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']::text[]
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.can_use_message_media_asset(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1 from public.message_media_assets a
    where a.id=p_asset_id and (
      a.owner_id=auth.uid()
      or exists(
        select 1
        from public.direct_message_media dma
        join public.messages m on m.id=dma.message_id
        join public.conversation_members cm on cm.conversation_id=m.conversation_id and cm.user_id=auth.uid()
        where dma.asset_id=a.id
      )
      or exists(
        select 1
        from public.community_message_media cma
        join public.community_group_messages gm on gm.id=cma.message_id
        join public.community_group_members member on member.group_id=gm.group_id and member.user_id=auth.uid()
        where cma.asset_id=a.id
      )
    )
  );
$$;

create or replace function public.can_access_message_media_path(p_path text)
returns boolean
language sql
stable
security definer
set search_path=public,storage
as $$
  select exists(
    select 1 from public.message_media_assets a
    where a.storage_path=p_path and public.can_use_message_media_asset(a.id)
  );
$$;

revoke all on function public.can_use_message_media_asset(uuid), public.can_access_message_media_path(text) from public,anon;
grant execute on function public.can_use_message_media_asset(uuid), public.can_access_message_media_path(text) to authenticated;

drop policy if exists "favourit message media insert" on storage.objects;
drop policy if exists "favourit message media select" on storage.objects;
create policy "favourit message media insert"
on storage.objects for insert to authenticated
with check (
  bucket_id='message-media'
  and split_part(name,'/',1)=auth.uid()::text
  and position('..' in name)=0
);
create policy "favourit message media select"
on storage.objects for select to authenticated
using (
  bucket_id='message-media'
  and public.can_access_message_media_path(name)
);

create or replace function public.register_message_media_asset(
  p_storage_path text,
  p_media_type text,
  p_mime_type text,
  p_file_name text,
  p_size_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path=public,storage
as $$
declare
  v_id uuid;
  v_path text:=trim(coalesce(p_storage_path,''));
  v_type text:=lower(trim(coalesce(p_media_type,'')));
  v_mime text:=lower(trim(coalesce(p_mime_type,'')));
  v_name text:=left(trim(coalesce(p_file_name,'media')),240);
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if v_path='' or split_part(v_path,'/',1)<>auth.uid()::text or position('..' in v_path)>0 then raise exception 'Invalid media path.'; end if;
  if v_type not in ('image','video') then raise exception 'Unsupported media type.'; end if;
  if (v_type='image' and v_mime not in ('image/jpeg','image/png','image/webp','image/gif'))
     or (v_type='video' and v_mime not in ('video/mp4','video/webm','video/quicktime')) then
    raise exception 'Unsupported media format.';
  end if;
  if coalesce(p_size_bytes,0)<1 or p_size_bytes>52428800 then raise exception 'Media must be 50 MB or smaller.'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='message-media' and o.name=v_path) then raise exception 'Uploaded media was not found.'; end if;

  select id into v_id from public.message_media_assets where storage_path=v_path and owner_id=auth.uid();
  if v_id is not null then return v_id; end if;

  insert into public.message_media_assets(owner_id,storage_path,media_type,mime_type,file_name,size_bytes)
  values(auth.uid(),v_path,v_type,v_mime,v_name,p_size_bytes)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.register_message_media_asset(text,text,text,text,bigint) from public,anon;
grant execute on function public.register_message_media_asset(text,text,text,text,bigint) to authenticated;

create or replace function public.build_deal_message_snapshot(p_deal_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  select jsonb_build_object(
    'id',d.id,
    'title',d.title,
    'description',left(d.description,260),
    'category',d.category,
    'price_fav',d.price_fav,
    'delivery_days',d.delivery_days,
    'seller_id',d.seller_id,
    'seller_name',coalesce(p.display_name,p.username,'Favourit seller')
  )
  from public.deals d
  join public.profiles p on p.id=d.seller_id
  where d.id=p_deal_id and d.status='published';
$$;
revoke all on function public.build_deal_message_snapshot(uuid) from public,anon,authenticated;

create or replace function public.get_my_preferred_language()
returns text
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(nullif(preferred_language,''),'en') from public.profiles where id=auth.uid();
$$;

create or replace function public.update_my_preferred_language(p_language text)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare v_language text:=lower(trim(coalesce(p_language,'')));
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if v_language !~ '^[a-z]{2,3}$' then raise exception 'Choose a supported language.'; end if;
  update public.profiles set preferred_language=v_language,updated_at=now() where id=auth.uid();
  if not found then raise exception 'Profile not found.'; end if;
  return v_language;
end;
$$;
revoke all on function public.get_my_preferred_language(), public.update_my_preferred_language(text) from public,anon;
grant execute on function public.get_my_preferred_language(), public.update_my_preferred_language(text) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_language text:=lower(coalesce(nullif(trim(new.raw_user_meta_data->>'preferred_language'),''),'en'));
  v_display_name text:=coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''),nullif(split_part(new.email,'@',1),''),'Favourit User');
begin
  if v_language !~ '^[a-z]{2,3}$' then v_language:='en'; end if;
  insert into public.profiles(id,username,display_name,username_chosen,preferred_language)
  values(new.id,'user_'||substr(new.id::text,1,8),left(v_display_name,80),false,v_language)
  on conflict(id) do update set preferred_language=coalesce(nullif(public.profiles.preferred_language,''),excluded.preferred_language);
  insert into public.wallets(user_id) values(new.id) on conflict(user_id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public,anon,authenticated;

create or replace function public.get_my_favorite_deals()
returns table(
  id uuid,title text,description text,category text,price_fav bigint,delivery_days integer,
  seller_id uuid,seller_name text,seller_username text
)
language sql
stable
security definer
set search_path=public
as $$
  select d.id,d.title,d.description,d.category,d.price_fav,d.delivery_days,d.seller_id,
         coalesce(p.display_name,p.username,'Favourit seller'),p.username
  from public.favorites f
  join public.deals d on d.id=f.deal_id and d.status='published'
  join public.profiles p on p.id=d.seller_id
  where f.user_id=auth.uid()
  order by f.created_at desc;
$$;
revoke all on function public.get_my_favorite_deals() from public,anon;
grant execute on function public.get_my_favorite_deals() to authenticated;

drop function if exists public.send_direct_message(uuid,text,uuid);
create function public.send_direct_message(
  p_conversation_id uuid,
  p_body text,
  p_reply_to_message_id uuid default null,
  p_asset_ids uuid[] default '{}'::uuid[],
  p_deal_id uuid default null
)
returns public.messages
language plpgsql
security definer
set search_path=public
as $$
declare
  result public.messages;
  clean_body text:=trim(coalesce(p_body,''));
  target uuid;
  snapshot jsonb;
  asset_count integer:=coalesce(array_length(p_asset_ids,1),0);
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if char_length(clean_body)>5000 then raise exception 'Message must be 5000 characters or less.'; end if;
  if asset_count>4 then raise exception 'You can attach up to 4 media items.'; end if;
  if not exists(select 1 from public.conversation_members where conversation_id=p_conversation_id and user_id=auth.uid()) then raise exception 'You are not a member of this conversation.'; end if;
  select case when dc.user_one=auth.uid() then dc.user_two else dc.user_one end into target from public.direct_conversations dc where dc.conversation_id=p_conversation_id;
  if target is null then raise exception 'Direct conversation not found.'; end if;
  if exists(select 1 from public.user_blocks ub where (ub.blocker_id=auth.uid() and ub.blocked_id=target) or (ub.blocker_id=target and ub.blocked_id=auth.uid())) then raise exception 'Messaging is unavailable because one of you has blocked the other.'; end if;
  if p_reply_to_message_id is not null and not exists(select 1 from public.messages rm where rm.id=p_reply_to_message_id and rm.conversation_id=p_conversation_id and rm.deleted_at is null) then raise exception 'You cannot reply to a deleted or unavailable message.'; end if;
  if exists(select 1 from unnest(coalesce(p_asset_ids,'{}'::uuid[])) aid where not public.can_use_message_media_asset(aid)) then raise exception 'One or more media items are unavailable.'; end if;
  if p_deal_id is not null then
    snapshot:=public.build_deal_message_snapshot(p_deal_id);
    if snapshot is null then raise exception 'Deal is unavailable.'; end if;
  end if;
  if clean_body='' and asset_count=0 and snapshot is null then raise exception 'Add text, media, or a deal before sending.'; end if;

  insert into public.messages(conversation_id,sender_id,body,reply_to_message_id,deal_id,deal_snapshot)
  values(p_conversation_id,auth.uid(),clean_body,p_reply_to_message_id,p_deal_id,snapshot)
  returning * into result;

  insert into public.direct_message_media(message_id,asset_id,position)
  select result.id,asset_id,(ord-1)::smallint
  from unnest(coalesce(p_asset_ids,'{}'::uuid[])) with ordinality as x(asset_id,ord)
  on conflict do nothing;
  return result;
end;
$$;
revoke all on function public.send_direct_message(uuid,text,uuid,uuid[],uuid) from public,anon;
grant execute on function public.send_direct_message(uuid,text,uuid,uuid[],uuid) to authenticated;

drop function if exists public.send_community_group_message(uuid,text);
drop function if exists public.send_community_group_message(uuid,text,uuid);
create function public.send_community_group_message(
  p_group_id uuid,
  p_body text,
  p_reply_to_message_id uuid default null,
  p_asset_ids uuid[] default '{}'::uuid[],
  p_deal_id uuid default null
)
returns public.community_group_messages
language plpgsql
security definer
set search_path=public
as $$
declare
  result public.community_group_messages;
  clean_body text:=trim(coalesce(p_body,''));
  recent_count integer;
  snapshot jsonb;
  asset_count integer:=coalesce(array_length(p_asset_ids,1),0);
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if char_length(clean_body)>2000 then raise exception 'Message must be 2000 characters or less.'; end if;
  if asset_count>4 then raise exception 'You can attach up to 4 media items.'; end if;
  if not exists(select 1 from public.community_group_members where group_id=p_group_id and user_id=auth.uid()) then raise exception 'Join this group before posting.'; end if;
  if p_reply_to_message_id is not null and not exists(select 1 from public.community_group_messages where id=p_reply_to_message_id and group_id=p_group_id and deleted_at is null) then raise exception 'You cannot reply to a deleted or unavailable message.'; end if;
  if exists(select 1 from unnest(coalesce(p_asset_ids,'{}'::uuid[])) aid where not public.can_use_message_media_asset(aid)) then raise exception 'One or more media items are unavailable.'; end if;
  if p_deal_id is not null then
    snapshot:=public.build_deal_message_snapshot(p_deal_id);
    if snapshot is null then raise exception 'Deal is unavailable.'; end if;
  end if;
  if clean_body='' and asset_count=0 and snapshot is null then raise exception 'Add text, media, or a deal before sending.'; end if;
  select count(*) into recent_count from public.community_group_messages where group_id=p_group_id and sender_id=auth.uid() and created_at>now()-interval '30 seconds';
  if recent_count>=10 then raise exception 'You are sending messages too quickly. Please wait a moment.'; end if;

  insert into public.community_group_messages(group_id,sender_id,body,reply_to_message_id,deal_id,deal_snapshot)
  values(p_group_id,auth.uid(),clean_body,p_reply_to_message_id,p_deal_id,snapshot)
  returning * into result;

  insert into public.community_message_media(message_id,asset_id,position)
  select result.id,asset_id,(ord-1)::smallint
  from unnest(coalesce(p_asset_ids,'{}'::uuid[])) with ordinality as x(asset_id,ord)
  on conflict do nothing;
  return result;
end;
$$;
revoke all on function public.send_community_group_message(uuid,text,uuid,uuid[],uuid) from public,anon;
grant execute on function public.send_community_group_message(uuid,text,uuid,uuid[],uuid) to authenticated;

drop function if exists public.get_direct_messages(uuid);
create function public.get_direct_messages(p_conversation_id uuid)
returns table(
  id uuid,conversation_id uuid,sender_id uuid,username text,display_name text,avatar_url text,
  body text,created_at timestamptz,updated_at timestamptz,is_deleted boolean,deleted_by_self boolean,
  reply_to_message_id uuid,reply_to_username text,reply_to_body text,is_starred boolean,
  attachments jsonb,deal jsonb
)
language sql
stable
security definer
set search_path=public
as $$
  select
    m.id,m.conversation_id,m.sender_id,p.username,p.display_name,p.avatar_url,
    case when m.deleted_at is null then m.body else coalesce(m.deletion_label,'Message deleted.') end,
    m.created_at,m.updated_at,m.deleted_at is not null,m.deleted_by=auth.uid(),m.reply_to_message_id,rp.username,
    case
      when rm.id is null then null
      when rm.deleted_at is not null then 'Message deleted.'
      when nullif(trim(rm.body),'') is not null then rm.body
      when rm.deal_id is not null then 'Deal'
      when exists(select 1 from public.direct_message_media rmedia where rmedia.message_id=rm.id) then 'Media'
      else 'Message'
    end,
    exists(select 1 from public.message_stars s where s.user_id=auth.uid() and s.message_id=m.id),
    case when m.deleted_at is not null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'asset_id',a.id,'storage_path',a.storage_path,'media_type',a.media_type,'mime_type',a.mime_type,
        'file_name',a.file_name,'size_bytes',a.size_bytes
      ) order by dma.position)
      from public.direct_message_media dma
      join public.message_media_assets a on a.id=dma.asset_id
      where dma.message_id=m.id
    ),'[]'::jsonb) end,
    case when m.deleted_at is null then m.deal_snapshot else null end
  from public.messages m
  join public.conversation_members me on me.conversation_id=m.conversation_id and me.user_id=auth.uid()
  join public.profiles p on p.id=m.sender_id
  left join public.messages rm on rm.id=m.reply_to_message_id
  left join public.profiles rp on rp.id=rm.sender_id
  where m.conversation_id=p_conversation_id
  order by m.created_at asc
  limit 500;
$$;
revoke all on function public.get_direct_messages(uuid) from public,anon;
grant execute on function public.get_direct_messages(uuid) to authenticated;

drop function if exists public.get_community_group_messages(uuid);
create function public.get_community_group_messages(p_group_id uuid)
returns table(
  id uuid,group_id uuid,sender_id uuid,username text,display_name text,avatar_url text,
  body text,created_at timestamptz,is_deleted boolean,is_moderator boolean,
  reply_to_message_id uuid,reply_to_username text,reply_to_body text,
  deleted_by_self boolean,deletion_label text,is_starred boolean,
  attachments jsonb,deal jsonb
)
language sql
security definer
set search_path=public
as $$
  select
    m.id,m.group_id,m.sender_id,p.username,p.display_name,p.avatar_url,
    case
      when m.deleted_at is null then m.body
      when m.deleted_by=auth.uid() then 'You deleted this message.'
      when m.moderation_reason='Deleted by author.' then coalesce(p.display_name,p.username,'This user')||' deleted a message.'
      else 'This message was removed by a moderator.'
    end,
    m.created_at,m.deleted_at is not null,public.is_community_group_moderator(p_group_id,auth.uid()),
    m.reply_to_message_id,rp.username,
    case
      when rm.id is null then null
      when rm.deleted_at is not null then 'Message deleted.'
      when nullif(trim(rm.body),'') is not null then rm.body
      when rm.deal_id is not null then 'Deal'
      when exists(select 1 from public.community_message_media rmedia where rmedia.message_id=rm.id) then 'Media'
      else 'Message'
    end,
    m.deleted_by=auth.uid(),
    case
      when m.deleted_at is null then null
      when m.deleted_by=auth.uid() then 'You deleted this message.'
      when m.moderation_reason='Deleted by author.' then coalesce(p.display_name,p.username,'This user')||' deleted a message.'
      else 'This message was removed by a moderator.'
    end,
    exists(select 1 from public.community_group_message_stars s where s.user_id=auth.uid() and s.message_id=m.id),
    case when m.deleted_at is not null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'asset_id',a.id,'storage_path',a.storage_path,'media_type',a.media_type,'mime_type',a.mime_type,
        'file_name',a.file_name,'size_bytes',a.size_bytes
      ) order by cma.position)
      from public.community_message_media cma
      join public.message_media_assets a on a.id=cma.asset_id
      where cma.message_id=m.id
    ),'[]'::jsonb) end,
    case when m.deleted_at is null then m.deal_snapshot else null end
  from public.community_group_messages m
  join public.profiles p on p.id=m.sender_id
  left join public.community_group_messages rm on rm.id=m.reply_to_message_id
  left join public.profiles rp on rp.id=rm.sender_id
  where m.group_id=p_group_id
    and exists(select 1 from public.community_groups g where g.id=p_group_id and g.is_public)
    and exists(select 1 from public.community_group_members gm where gm.group_id=p_group_id and gm.user_id=auth.uid())
  order by m.created_at asc
  limit 200;
$$;
revoke all on function public.get_community_group_messages(uuid) from public,anon;
grant execute on function public.get_community_group_messages(uuid) to authenticated;

create or replace function public.get_my_direct_conversations()
returns table(
  conversation_id uuid,other_user_id uuid,other_username text,other_display_name text,other_avatar_url text,
  last_message text,last_message_at timestamptz,unread_count bigint,is_friend boolean,is_online boolean,last_seen_at timestamptz,is_message_request boolean
)
language sql
stable
security definer
set search_path=public
as $$
  with mine as (
    select conversation_id from public.conversation_members where user_id=auth.uid()
  ),
  direct as (
    select dc.conversation_id,case when dc.user_one=auth.uid() then dc.user_two else dc.user_one end other_id
    from public.direct_conversations dc join mine m on m.conversation_id=dc.conversation_id
  ),
  latest as (
    select distinct on (m.conversation_id) m.conversation_id,
      case
        when m.deleted_at is not null then coalesce(m.deletion_label,'Message deleted.')
        when nullif(trim(m.body),'') is not null then m.body
        when m.deal_id is not null then '★ Deal'
        when exists(select 1 from public.direct_message_media media where media.message_id=m.id) then 'Media'
        else 'Message'
      end body,
      m.created_at
    from public.messages m join mine x on x.conversation_id=m.conversation_id
    order by m.conversation_id,m.created_at desc
  ),
  first_message as (
    select distinct on (m.conversation_id) m.conversation_id,m.sender_id
    from public.messages m join mine x on x.conversation_id=m.conversation_id
    order by m.conversation_id,m.created_at asc
  )
  select d.conversation_id,d.other_id,p.username,p.display_name,p.avatar_url,l.body,l.created_at,
    (select count(*) from public.messages m left join public.conversation_reads cr on cr.conversation_id=m.conversation_id and cr.user_id=auth.uid()
     where m.conversation_id=d.conversation_id and m.sender_id<>auth.uid() and (cr.last_read_at is null or m.created_at>cr.last_read_at))::bigint,
    exists(select 1 from public.friendships f where f.user_id=auth.uid() and f.friend_id=d.other_id),
    coalesce(up.is_online and up.last_seen_at>now()-interval '60 seconds',false),up.last_seen_at,
    (not exists(select 1 from public.friendships f where f.user_id=auth.uid() and f.friend_id=d.other_id)
      and fm.sender_id is not null and fm.sender_id<>auth.uid())
  from direct d
  join public.profiles p on p.id=d.other_id
  left join latest l on l.conversation_id=d.conversation_id
  left join first_message fm on fm.conversation_id=d.conversation_id
  left join public.user_presence up on up.user_id=d.other_id
  order by l.created_at desc nulls last;
$$;
revoke all on function public.get_my_direct_conversations() from public,anon;
grant execute on function public.get_my_direct_conversations() to authenticated;

create or replace function public.toggle_direct_message_star(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare v boolean;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if not exists(select 1 from public.messages m join public.conversation_members cm on cm.conversation_id=m.conversation_id and cm.user_id=auth.uid() where m.id=p_message_id and m.deleted_at is null) then raise exception 'This message is unavailable.'; end if;
  if exists(select 1 from public.message_stars where user_id=auth.uid() and message_id=p_message_id) then
    delete from public.message_stars where user_id=auth.uid() and message_id=p_message_id; v=false;
  else
    insert into public.message_stars(user_id,message_id) values(auth.uid(),p_message_id); v=true;
  end if;
  return v;
end;
$$;

create or replace function public.toggle_community_group_message_star(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare now_starred boolean;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if not exists(
    select 1 from public.community_group_messages m
    join public.community_group_members gm on gm.group_id=m.group_id and gm.user_id=auth.uid()
    where m.id=p_message_id and m.deleted_at is null
  ) then raise exception 'This message is unavailable.'; end if;
  if exists(select 1 from public.community_group_message_stars where user_id=auth.uid() and message_id=p_message_id) then
    delete from public.community_group_message_stars where user_id=auth.uid() and message_id=p_message_id; now_starred=false;
  else
    insert into public.community_group_message_stars(user_id,message_id) values(auth.uid(),p_message_id); now_starred=true;
  end if;
  return now_starred;
end;
$$;
revoke all on function public.toggle_direct_message_star(uuid), public.toggle_community_group_message_star(uuid) from public,anon;
grant execute on function public.toggle_direct_message_star(uuid), public.toggle_community_group_message_star(uuid) to authenticated;
