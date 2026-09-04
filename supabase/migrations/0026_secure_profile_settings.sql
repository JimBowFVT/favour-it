-- 0026: keep profile edits server-authorized instead of exposing direct profile writes.
create or replace function public.update_my_profile(p_display_name text, p_bio text default '')
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.profiles;
  clean_name text := btrim(coalesce(p_display_name, ''));
  clean_bio text := btrim(coalesce(p_bio, ''));
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if char_length(clean_name) < 1 or char_length(clean_name) > 80 then raise exception 'Display name must be between 1 and 80 characters.'; end if;
  if char_length(clean_bio) > 500 then raise exception 'Bio must be 500 characters or less.'; end if;

  update public.profiles
  set display_name = clean_name, bio = clean_bio
  where id = auth.uid()
  returning * into result;

  if result.id is null then raise exception 'Profile not found.'; end if;
  return result;
end;
$$;

revoke all on function public.update_my_profile(text, text) from public, anon;
grant execute on function public.update_my_profile(text, text) to authenticated;

-- The client should use the RPC above for profile writes.
revoke insert, update, delete on public.profiles from authenticated;
