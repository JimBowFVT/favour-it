-- Per-user message read state. This avoids mutating message rows when a recipient opens a conversation.
create table if not exists public.conversation_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.conversation_reads enable row level security;

drop policy if exists "users can view own conversation reads" on public.conversation_reads;
create policy "users can view own conversation reads" on public.conversation_reads
  for select using (user_id = auth.uid());

drop policy if exists "users can insert own conversation reads" on public.conversation_reads;
create policy "users can insert own conversation reads" on public.conversation_reads
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = conversation_id and cm.user_id = auth.uid()
    )
  );

drop policy if exists "users can update own conversation reads" on public.conversation_reads;
create policy "users can update own conversation reads" on public.conversation_reads
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if not exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation_id and user_id = v_user
  ) then raise exception 'not a conversation participant'; end if;

  insert into public.conversation_reads(conversation_id, user_id, last_read_at)
    values (p_conversation_id, v_user, v_now)
  on conflict (conversation_id, user_id)
    do update set last_read_at = excluded.last_read_at;

  return 1;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

create index if not exists conversation_reads_user_idx
  on public.conversation_reads(user_id, last_read_at desc);

create index if not exists messages_sender_idx
  on public.messages(sender_id, created_at desc);
