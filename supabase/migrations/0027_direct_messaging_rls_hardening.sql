drop policy if exists conversations_select on public.conversations;
drop policy if exists conversations_insert on public.conversations;
drop policy if exists conversations_update on public.conversations;
drop policy if exists messages_select on public.messages;
drop policy if exists messages_insert on public.messages;

create policy conversations_select on public.conversations for select to authenticated using (public.is_conversation_member(id, auth.uid()));
create policy messages_select on public.messages for select to authenticated using (public.is_conversation_member(conversation_id, auth.uid()));
create policy messages_insert on public.messages for insert to authenticated with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id, auth.uid()));

create index if not exists idx_messages_conversation_created_at on public.messages(conversation_id, created_at);
create index if not exists idx_conversation_members_user_conversation on public.conversation_members(user_id, conversation_id);
