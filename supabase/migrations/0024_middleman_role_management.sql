-- Middleman role management: admins can grant/revoke the role from existing users.
-- The role is stored in the existing moderators table so it works with the
-- mediation permissions already implemented for assigned orders.

create or replace function public.grant_middleman_role(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.moderators
    where user_id = v_actor and role = 'admin'
  ) then
    raise exception 'admin access required';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user not found';
  end if;

  insert into public.moderators (user_id, role)
  values (p_user_id, 'middleman')
  on conflict (user_id) do update
    set role = 'middleman';
end;
$$;

create or replace function public.revoke_middleman_role(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.moderators
    where user_id = v_actor and role = 'admin'
  ) then
    raise exception 'admin access required';
  end if;

  update public.moderators
  set role = 'moderator'
  where user_id = p_user_id and role = 'middleman';

  update public.order_middlemen
  set active = false,
      unassigned_at = coalesce(unassigned_at, now())
  where middleman_id = p_user_id and active = true;
end;
$$;

revoke all on function public.grant_middleman_role(uuid) from public, anon, authenticated;
revoke all on function public.revoke_middleman_role(uuid) from public, anon, authenticated;
grant execute on function public.grant_middleman_role(uuid) to authenticated;
grant execute on function public.revoke_middleman_role(uuid) to authenticated;

drop policy if exists moderators_admin_select on public.moderators;
create policy moderators_admin_select on public.moderators
for select to authenticated
using (
  exists (
    select 1 from public.moderators m
    where m.user_id = auth.uid() and m.role = 'admin'
  )
  or user_id = auth.uid()
);
