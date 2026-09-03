-- Finish Mode: message read state only.
-- The richer notifications schema/triggers live in 0011_notifications.sql.
-- This migration intentionally does not redefine notifications or order triggers.

alter table public.messages
  add column if not exists read_at timestamptz;

create index if not exists messages_unread_by_conversation_idx
  on public.messages(conversation_id, created_at desc)
  where read_at is null;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation_id and user_id = v_user
  ) then
    raise exception 'not a conversation member';
  end if;

  update public.messages
     set read_at = now()
   where conversation_id = p_conversation_id
     and sender_id <> v_user
     and read_at is null;
  get diagnostics v_count = row_count;

  -- Keep the existing notification system in sync with the message state.
  update public.notifications
     set read_at = coalesce(read_at, now())
   where user_id = v_user
     and conversation_id = p_conversation_id
     and read_at is null;

  return v_count;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
