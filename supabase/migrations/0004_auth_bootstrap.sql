-- Favourit auth bootstrap
-- Creates the application profile and wallet whenever Supabase Auth creates a user.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), 'Favourit member')
  )
  on conflict (id) do nothing;

  insert into public.wallets (user_id, available_micro_fav, held_micro_fav)
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
insert into public.profiles (id, display_name)
select
  u.id,
  coalesce(nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''), split_part(u.email, '@', 1), 'Favourit member')
from auth.users u
on conflict (id) do nothing;

insert into public.wallets (user_id, available_micro_fav, held_micro_fav)
select u.id, 0, 0
from auth.users u
on conflict (user_id) do nothing;

comment on function public.handle_new_user() is 'Creates a Favourit profile and zero-balance wallet for each newly registered Auth user.';
