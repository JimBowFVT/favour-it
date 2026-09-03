-- Read receipts are stored per conversation in conversation_reads.
-- This RPC gives the current user a safe, atomic way to mark a conversation read.
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns public.conversation_reads
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.conversation_reads;
begin
  if not exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation_id
      and user_id = auth.uid()
  ) then
    raise exception 'Not a conversation member';
  end if;

  insert into public.conversation_reads(conversation_id, user_id, last_read_at)
  values (p_conversation_id, auth.uid(), now())
  on conflict (conversation_id, user_id)
  do update set last_read_at = greatest(public.conversation_reads.last_read_at, excluded.last_read_at)
  returning * into result;

  return result;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
