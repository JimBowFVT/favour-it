-- Keep existing direct-message history after blocking, but prevent new direct conversations/messages.
create or replace function public.get_or_create_direct_conversation(p_username text)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  u uuid := auth.uid();
  target uuid;
  c uuid;
  a uuid;
  b uuid;
begin
  if u is null then raise exception 'not authenticated'; end if;
  select id into target from public.profiles
  where username_chosen=true and lower(username)=lower(trim(p_username));
  if target is null then raise exception 'User not found.'; end if;
  if target=u then raise exception 'You cannot message yourself.'; end if;
  if exists(select 1 from public.user_blocks where (blocker_id=u and blocked_id=target) or (blocker_id=target and blocked_id=u)) then
    raise exception 'Messaging is unavailable because one of you has blocked the other.';
  end if;
  a := least(u,target); b := greatest(u,target);
  select conversation_id into c from public.direct_conversations where user_one=a and user_two=b;
  if c is not null then return c; end if;
  insert into public.conversations default values returning id into c;
  insert into public.conversation_members(conversation_id,user_id) values(c,u),(c,target);
  insert into public.direct_conversations(conversation_id,user_one,user_two) values(c,a,b);
  return c;
end $$;
revoke all on function public.get_or_create_direct_conversation(text) from public, anon;
grant execute on function public.get_or_create_direct_conversation(text) to authenticated;

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated with check (
  sender_id=auth.uid()
  and is_conversation_member(conversation_id,auth.uid())
  and not exists (
    select 1 from public.direct_conversations dc
    where dc.conversation_id=messages.conversation_id
      and exists(
        select 1 from public.user_blocks ub
        where (ub.blocker_id=auth.uid() and ub.blocked_id=case when dc.user_one=auth.uid() then dc.user_two else dc.user_one end)
           or (ub.blocker_id=case when dc.user_one=auth.uid() then dc.user_two else dc.user_one end and ub.blocked_id=auth.uid())
      )
  )
);