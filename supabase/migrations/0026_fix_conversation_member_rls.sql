drop policy if exists conversation_members_select on public.conversation_members;
drop policy if exists conversation_members_insert on public.conversation_members;
drop policy if exists conversation_members_update on public.conversation_members;
drop policy if exists conversation_members_delete on public.conversation_members;

create or replace function public.is_conversation_member(p_conversation_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.conversation_members cm where cm.conversation_id = p_conversation_id and cm.user_id = coalesce(p_user_id, auth.uid()));
$$;

revoke all on function public.is_conversation_member(uuid, uuid) from public, anon;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;

create policy conversation_members_select on public.conversation_members for select to authenticated using (user_id = auth.uid() or public.is_conversation_member(conversation_id, auth.uid()));
create policy conversation_members_insert on public.conversation_members for insert to authenticated with check (user_id = auth.uid() or public.is_conversation_member(conversation_id, auth.uid()));
create policy conversation_members_update on public.conversation_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy conversation_members_delete on public.conversation_members for delete to authenticated using (user_id = auth.uid());
