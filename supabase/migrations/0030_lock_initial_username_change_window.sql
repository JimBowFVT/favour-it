create or replace function public.complete_username(p_username text)
returns public.profiles
language plpgsql security definer set search_path=public as $$
declare u uuid := auth.uid(); clean text; result public.profiles;
begin
 if u is null then raise exception 'not authenticated'; end if;
 clean:=lower(trim(p_username));
 if clean !~ '^[a-z0-9_]{3,20}$' then raise exception 'Username must be 3-20 characters using letters, numbers or underscores.'; end if;
 if clean in ('admin','administrator','support','favourit','favouritteam','middleman','moderator','system','official','help') then raise exception 'That username is reserved.'; end if;
 if exists(select 1 from public.profiles where lower(username)=clean and id<>u) then raise exception 'That username is already taken.'; end if;
 update public.profiles set username=clean,username_chosen=true,username_last_changed_at=now(),updated_at=now() where id=u and username_chosen=false returning * into result;
 if not found then raise exception 'Username has already been chosen.'; end if;
 return result;
end;$$;
revoke all on function public.complete_username(text) from public,anon; grant execute on function public.complete_username(text) to authenticated;
