create or replace function public.is_favourit_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select lower(coalesce(auth.email(), '')) = 'adamzoharlevi@gmail.com'
$$;

create or replace function public.admin_list_users(p_search text default '')
returns table (
  user_id uuid,
  email text,
  username text,
  display_name text,
  role text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_search text := lower(trim(coalesce(p_search, '')));
begin
  if not public.is_favourit_admin() then raise exception 'admin access required'; end if;
  return query
  select u.id, u.email::text, p.username, p.display_name, coalesce(m.role, 'user')::text, u.created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.moderators m on m.user_id = u.id
  where v_search = '' or lower(coalesce(u.email,'')) like '%'||v_search||'%' or lower(coalesce(p.username,'')) like '%'||v_search||'%' or lower(coalesce(p.display_name,'')) like '%'||v_search||'%'
  order by u.created_at desc
  limit 100;
end;
$$;

create or replace function public.admin_set_middleman_role(p_user_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_username text; v_display_name text;
begin
  if not public.is_favourit_admin() then raise exception 'admin access required'; end if;
  if not exists (select 1 from auth.users where id=p_user_id) then raise exception 'user not found'; end if;
  if p_user_id = auth.uid() then raise exception 'admin account cannot be changed here'; end if;
  if p_enabled then
    if exists (select 1 from public.moderators where user_id=p_user_id and role='admin') then raise exception 'admin role cannot be replaced'; end if;
    if not exists (select 1 from public.profiles where id=p_user_id) then
      select coalesce(nullif(split_part(email::text,'@',1),''),'favourit_user') into v_username from auth.users where id=p_user_id;
      v_username := regexp_replace(lower(v_username),'[^a-z0-9_]+','','g') || '_' || substr(p_user_id::text,1,8);
      v_display_name := coalesce(nullif((select raw_user_meta_data->>'display_name' from auth.users where id=p_user_id),''), v_username);
      insert into public.profiles(id, username, display_name) values(p_user_id, left(v_username,50), left(v_display_name,100));
    end if;
    insert into public.moderators(user_id, role) values(p_user_id,'middleman') on conflict(user_id) do update set role='middleman';
  else
    update public.moderators set role='moderator' where user_id=p_user_id and role='middleman';
    update public.order_middlemen set active=false, unassigned_at=coalesce(unassigned_at,now()) where middleman_id=p_user_id and active=true;
  end if;
end;
$$;

revoke all on function public.is_favourit_admin() from public, anon, authenticated;
revoke all on function public.admin_list_users(text) from public, anon, authenticated;
revoke all on function public.admin_set_middleman_role(uuid, boolean) from public, anon, authenticated;
grant execute on function public.is_favourit_admin() to authenticated;
grant execute on function public.admin_list_users(text) to authenticated;
grant execute on function public.admin_set_middleman_role(uuid, boolean) to authenticated;
