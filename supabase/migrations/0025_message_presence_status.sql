create or replace function public.get_conversation_read_state(p_conversation_id uuid)
returns table(other_user_id uuid, other_last_read_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select cm.user_id, cr.last_read_at
  from public.conversation_members cm
  left join public.conversation_reads cr
    on cr.conversation_id = cm.conversation_id
   and cr.user_id = cm.user_id
  where cm.conversation_id = p_conversation_id
    and cm.user_id <> auth.uid()
    and exists (
      select 1 from public.conversation_members me
      where me.conversation_id = p_conversation_id
        and me.user_id = auth.uid()
    );
$$;

revoke all on function public.get_conversation_read_state(uuid) from public, anon;
grant execute on function public.get_conversation_read_state(uuid) to authenticated;
