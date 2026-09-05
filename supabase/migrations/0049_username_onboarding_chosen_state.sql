create or replace function public.get_my_username_status()
returns table(username text, username_chosen boolean, display_name text, email text, username_last_changed_at timestamptz)
language plpgsql
security definer
set search_path=public
as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not authenticated'; end if;
  return query
  select p.username,
         coalesce(p.username_chosen,false),
         p.display_name,
         au.email::text,
         p.username_last_changed_at
  from public.profiles p
  join auth.users au on au.id=p.id
  where p.id=u;
end;
$$;

create or replace function public.complete_username(p_username text)
returns public.profiles
language plpgsql
security definer
set search_path=public
as $$
declare
  u uuid := auth.uid();
  clean text;
  result public.profiles;
begin
  if u is null then raise exception 'not authenticated'; end if;
  clean := lower(trim(p_username));
  if clean !~ '^[a-z0-9_]{3,20}$' then raise exception 'Username must be 3-20 characters using letters, numbers or underscores.'; end if;
  if clean in ('admin','administrator','support','favourit','favouritteam','middleman','moderator','system','official','help') then raise exception 'That username is reserved.'; end if;

  select * into result from public.profiles where id=u;
  if result.id is null then raise exception 'Profile not found'; end if;

  if coalesce(result.username_chosen,false) then return result; end if;
  if exists(select 1 from public.profiles where lower(username)=clean and id<>u) then raise exception 'That username is already taken.'; end if;

  update public.profiles
  set username=clean,
      username_chosen=true,
      username_last_changed_at=now(),
      updated_at=now()
  where id=u
  returning * into result;
  return result;
end;
$$;

revoke all on function public.get_my_username_status() from public,anon;
grant execute on function public.get_my_username_status() to authenticated;
revoke all on function public.complete_username(text) from public,anon;
grant execute on function public.complete_username(text) to authenticated;
