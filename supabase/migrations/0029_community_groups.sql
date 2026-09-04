-- Community skill groups: public communities with moderated group chat.
create table if not exists public.community_groups (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null unique,
  description text not null default '',
  skill_tags text[] not null default '{}',
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.community_group_members (
  group_id uuid not null references public.community_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id,user_id)
);

create table if not exists public.community_group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.community_groups(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.community_group_moderators (
  group_id uuid not null references public.community_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (group_id,user_id)
);

create index if not exists community_group_members_user_idx on public.community_group_members(user_id,joined_at desc);
create index if not exists community_group_messages_group_idx on public.community_group_messages(group_id,created_at desc);

alter table public.community_groups enable row level security;
alter table public.community_group_members enable row level security;
alter table public.community_group_messages enable row level security;
alter table public.community_group_moderators enable row level security;
revoke all on public.community_groups,public.community_group_members,public.community_group_messages,public.community_group_moderators from anon,authenticated;

create or replace function public.list_public_community_groups()
returns table(id uuid,slug text,name text,description text,skill_tags text[],member_count bigint,is_joined boolean)
language sql security definer set search_path=public as $$
  select g.id,g.slug,g.name,g.description,g.skill_tags,
    (select count(*) from public.community_group_members m where m.group_id=g.id),
    exists(select 1 from public.community_group_members me where me.group_id=g.id and me.user_id=auth.uid())
  from public.community_groups g
  where g.is_public=true
  order by (select count(*) from public.community_group_members m where m.group_id=g.id) desc,g.name;
$$;

create or replace function public.join_community_group(p_group_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if not exists(select 1 from public.community_groups where id=p_group_id and is_public) then raise exception 'Community group not found.'; end if;
  insert into public.community_group_members(group_id,user_id) values(p_group_id,auth.uid()) on conflict do nothing;
  return true;
end; $$;

create or replace function public.leave_community_group(p_group_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  delete from public.community_group_members where group_id=p_group_id and user_id=auth.uid();
  return found;
end; $$;

create or replace function public.get_community_group_messages(p_group_id uuid)
returns table(id uuid,group_id uuid,sender_id uuid,username text,display_name text,avatar_url text,body text,created_at timestamptz)
language sql security definer set search_path=public as $$
  select m.id,m.group_id,m.sender_id,p.username,p.display_name,p.avatar_url,m.body,m.created_at
  from public.community_group_messages m
  join public.profiles p on p.id=m.sender_id
  where m.group_id=p_group_id
    and exists(select 1 from public.community_groups g where g.id=p_group_id and g.is_public)
    and exists(select 1 from public.community_group_members gm where gm.group_id=p_group_id and gm.user_id=auth.uid())
  order by m.created_at asc limit 200;
$$;

create or replace function public.send_community_group_message(p_group_id uuid,p_body text)
returns public.community_group_messages language plpgsql security definer set search_path=public as $$
declare result public.community_group_messages; clean_body text;
begin
  clean_body=trim(coalesce(p_body,''));
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if char_length(clean_body)<1 or char_length(clean_body)>2000 then raise exception 'Message must be between 1 and 2000 characters.'; end if;
  if not exists(select 1 from public.community_group_members where group_id=p_group_id and user_id=auth.uid()) then raise exception 'Join this group before posting.'; end if;
  insert into public.community_group_messages(group_id,sender_id,body) values(p_group_id,auth.uid(),clean_body) returning * into result;
  return result;
end; $$;

create or replace function public.get_community_group_members(p_group_id uuid)
returns table(user_id uuid,username text,display_name text,avatar_url text,joined_at timestamptz)
language sql security definer set search_path=public as $$
  select p.id,p.username,p.display_name,p.avatar_url,m.joined_at
  from public.community_group_members m join public.profiles p on p.id=m.user_id
  where m.group_id=p_group_id
    and exists(select 1 from public.community_groups g where g.id=p_group_id and g.is_public)
  order by m.joined_at asc limit 200;
$$;

insert into public.community_groups(slug,name,description,skill_tags) values
('designers','Designers','Share design knowledge, feedback, workflows and collaboration opportunities.','{"design","ui","ux","branding","figma"}'),
('developers','Developers','Talk code, products, APIs, frameworks and building better software.','{"development","programming","react","web","software"}'),
('video-editors','Video Editors','Editing workflows, motion, storytelling, tools and creative feedback.','{"video","editing","motion","premiere","after-effects"}'),
('musicians','Musicians','Connect with musicians, producers and creators across every genre.','{"music","production","audio","songwriting"}'),
('marketers','Marketers','Share growth ideas, campaigns, positioning and practical marketing advice.','{"marketing","growth","branding","social"}'),
('photographers','Photographers','A space for photographers to share techniques, feedback and opportunities.','{"photography","photo","editing","creative"}'),
('writers','Writers','Writing, copy, storytelling and feedback for creators of every kind.','{"writing","copywriting","content","storytelling"}'),
('entrepreneurs','Entrepreneurs','Build, learn and collaborate with people turning skills into businesses.','{"business","startup","entrepreneurship","growth"}')
on conflict (slug) do update set description=excluded.description,skill_tags=excluded.skill_tags;

revoke all on function public.list_public_community_groups(),public.join_community_group(uuid),public.leave_community_group(uuid),public.get_community_group_messages(uuid),public.send_community_group_message(uuid,text),public.get_community_group_members(uuid) from public,anon;
grant execute on function public.list_public_community_groups(),public.join_community_group(uuid),public.leave_community_group(uuid),public.get_community_group_messages(uuid),public.send_community_group_message(uuid,text),public.get_community_group_members(uuid) to authenticated;
