revoke insert,update,delete on public.messages from anon,authenticated;
revoke insert,update,delete on public.user_blocks from anon,authenticated;
grant select on public.user_blocks to authenticated;
drop policy if exists "users can inspect their own block relationships" on public.user_blocks;
create policy "users can inspect their own block relationships" on public.user_blocks for select to authenticated using(blocker_id=auth.uid() or blocked_id=auth.uid());
revoke execute on function public.get_presence_for_users(uuid[]) from public,anon;
grant execute on function public.get_presence_for_users(uuid[]) to authenticated;
