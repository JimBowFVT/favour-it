alter table public.profiles add column if not exists username_chosen boolean not null default false;
create index if not exists profiles_username_lower_idx on public.profiles (lower(username));

create or replace function public.complete_username(p_username text) returns public.profiles language plpgsql security definer set search_path=public as $$
declare u uuid := auth.uid(); clean text; result public.profiles;
begin
 if u is null then raise exception 'not authenticated'; end if;
 clean := lower(trim(p_username));
 if clean !~ '^[a-z0-9_]{3,20}$' then raise exception 'Username must be 3-20 characters using letters, numbers or underscores.'; end if;
 if clean in ('admin','administrator','support','favourit','favouritteam','middleman','moderator','system','official','help') then raise exception 'That username is reserved.'; end if;
 if exists(select 1 from public.profiles where lower(username)=clean and id<>u) then raise exception 'That username is already taken.'; end if;
 update public.profiles set username=clean, username_chosen=true, updated_at=now() where id=u returning * into result;
 if not found then raise exception 'Profile not found'; end if;
 return result;
end $$;
revoke all on function public.complete_username(text) from public, anon; grant execute on function public.complete_username(text) to authenticated;

create or replace function public.get_my_username_status() returns table (username text, username_chosen boolean, display_name text, email text) language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); begin if u is null then raise exception 'not authenticated'; end if; return query select p.username,p.username_chosen,p.display_name,au.email::text from public.profiles p join auth.users au on au.id=p.id where p.id=u; end $$;
revoke all on function public.get_my_username_status() from public, anon; grant execute on function public.get_my_username_status() to authenticated;

create or replace function public.search_users_by_username(p_query text) returns table (user_id uuid, username text, display_name text, avatar_url text) language sql security definer set search_path=public as $$ select p.id,p.username,p.display_name,p.avatar_url from public.profiles p where p.username_chosen=true and lower(p.username) like lower(trim(p_query)) || '%' order by lower(p.username) limit 20; $$;
revoke all on function public.search_users_by_username(text) from public, anon; grant execute on function public.search_users_by_username(text) to authenticated;

create or replace function public.get_or_create_direct_conversation(p_username text) returns uuid language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); target uuid; c uuid;
begin if u is null then raise exception 'not authenticated'; end if; select id into target from public.profiles where username_chosen=true and lower(username)=lower(trim(p_username)); if target is null then raise exception 'User not found.'; end if; if target=u then raise exception 'You cannot message yourself.'; end if; select dc.conversation_id into c from public.direct_conversations dc where dc.user_one=least(u,target) and dc.user_two=greatest(u,target); if c is not null then return c; end if; insert into public.conversations default values returning id into c; insert into public.conversation_members(conversation_id,user_id) values(c,u),(c,target); insert into public.direct_conversations(conversation_id,user_one,user_two) values(c,least(u,target),greatest(u,target)); return c; end $$;
revoke all on function public.get_or_create_direct_conversation(text) from public, anon; grant execute on function public.get_or_create_direct_conversation(text) to authenticated;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into public.profiles(id,username,display_name,username_chosen) values(new.id,'user_'||substr(new.id::text,1,8),coalesce(nullif(split_part(new.email,'@',1),''),'Favourit User'),false) on conflict(id) do nothing; insert into public.wallets(user_id) values(new.id) on conflict(user_id) do nothing; return new; end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
update public.profiles set username_chosen=false where username_chosen is null;
