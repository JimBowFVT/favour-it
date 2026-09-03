-- Favourit auth bootstrap
-- Creates the application profile and wallet whenever Supabase Auth creates a user.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_username text;
  v_username text;
begin
  v_base_username := lower(regexp_replace(coalesce(nullif(trim(new.raw_user_meta_data ->> 'username'), ''), split_part(coalesce(new.email, 'member'), '@', 1), 'member'), '[^a-zA-Z0-9_]+', '-', 'g'));
  v_base_username := left(trim(both '-' from v_base_username), 36);
  if v_base_username = '' then v_base_username := 'member'; end if;
  v_username := left(v_base_username || '-' || substr(new.id::text, 1, 8), 50);

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    v_username,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1), 'Favourit member')
  )
  on conflict (id) do nothing;

  insert into public.wallets (user_id, available_fav, held_fav)
  values (new.id, 0, 0)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill application records for any auth users created before this migration.
insert into public.profiles (id, username, display_name)
select
  u.id,
  left(trim(both '-' from lower(regexp_replace(coalesce(nullif(trim(u.raw_user_meta_data ->> 'username'), ''), split_part(coalesce(u.email, 'member'), '@', 1), 'member'), '[^a-zA-Z0-9_]+', '-', 'g'))), 41)
    || '-' || substr(u.id::text, 1, 8),
  coalesce(nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(u.email, ''), '@', 1), 'Favourit member')
from auth.users u
on conflict (id) do nothing;

insert into public.wallets (user_id, available_fav, held_fav)
select u.id, 0, 0
from auth.users u
on conflict (user_id) do nothing;

comment on function public.handle_new_user() is 'Creates a Favourit profile and zero-balance wallet for each newly registered Auth user.';
