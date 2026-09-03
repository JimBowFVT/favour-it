alter table public.profiles add column if not exists username_last_changed_at timestamptz;

create or replace function public.change_username(p_username text)
returns public.profiles
language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); clean text; result public.profiles; last_changed timestamptz;
begin
 if u is null then raise exception 'not authenticated'; end if;
 clean:=lower(trim(p_username));
 if clean !~ '^[a-z0-9_]{3,20}$' then raise exception 'Username must be 3-20 characters using letters, numbers or underscores.'; end if;
 if clean in ('admin','administrator','support','favourit','favouritteam','middleman','moderator','system','official','help') then raise exception 'That username is reserved.'; end if;
 select username_last_changed_at into last_changed from public.profiles where id=u;
 if last_changed is not null and last_changed > now()-interval '30 days' then raise exception 'You can change your @ once every 30 days.'; end if;
 if exists(select 1 from public.profiles where lower(username)=clean and id<>u) then raise exception 'That username is already taken.'; end if;
 update public.profiles set username=clean,username_chosen=true,username_last_changed_at=now(),updated_at=now() where id=u returning * into result;
 if not found then raise exception 'Profile not found'; end if;
 return result;
end;$$;

drop function if exists public.get_my_username_status();
create function public.get_my_username_status()
returns table(username text, username_chosen boolean, display_name text, email text, username_last_changed_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); begin
 if u is null then raise exception 'not authenticated'; end if;
 return query select p.username,p.username_chosen,p.display_name,au.email::text,p.username_last_changed_at from public.profiles p join auth.users au on au.id=p.id where p.id=u;
end;$$;
revoke all on function public.change_username(text) from public,anon; grant execute on function public.change_username(text) to authenticated;
revoke all on function public.get_my_username_status() from public,anon; grant execute on function public.get_my_username_status() to authenticated;

create or replace function public.get_my_direct_conversations()
returns table(conversation_id uuid,other_user_id uuid,other_username text,other_display_name text,other_avatar_url text,last_message text,last_message_at timestamptz,unread_count bigint)
language sql security definer stable set search_path=public as $$
 with mine as (select conversation_id from public.conversation_members where user_id=auth.uid()),
 direct as (select dc.conversation_id,case when dc.user_one=auth.uid() then dc.user_two else dc.user_one end other_id from public.direct_conversations dc join mine m on m.conversation_id=dc.conversation_id),
 latest as (select distinct on (m.conversation_id) m.conversation_id,m.body,m.created_at from public.messages m join mine x on x.conversation_id=m.conversation_id order by m.conversation_id,m.created_at desc)
 select d.conversation_id,d.other_id,p.username,p.display_name,p.avatar_url,l.body,l.created_at,
 (select count(*) from public.messages m left join public.conversation_reads cr on cr.conversation_id=m.conversation_id and cr.user_id=auth.uid() where m.conversation_id=d.conversation_id and m.sender_id<>auth.uid() and (cr.last_read_at is null or m.created_at>cr.last_read_at))::bigint
 from direct d join public.profiles p on p.id=d.other_id left join latest l on l.conversation_id=d.conversation_id order by l.created_at desc nulls last;
$$;
revoke all on function public.get_my_direct_conversations() from public,anon; grant execute on function public.get_my_direct_conversations() to authenticated;

create or replace function public.notify_direct_message()
returns trigger language plpgsql security definer set search_path=public as $$
declare recipient uuid; sender_name text;
begin
 select coalesce(p.display_name,p.username,'Someone') into sender_name from public.profiles p where p.id=new.sender_id;
 for recipient in select cm.user_id from public.conversation_members cm where cm.conversation_id=new.conversation_id and cm.user_id<>new.sender_id loop
  insert into public.notifications(user_id,type,title,body,data) values(recipient,'message','New message',coalesce(sender_name,'Someone') || ' sent you a message.',jsonb_build_object('conversation_id',new.conversation_id,'sender_id',new.sender_id));
 end loop;
 return new;
end;$$;
drop trigger if exists trg_direct_message_notification on public.messages;
create trigger trg_direct_message_notification after insert on public.messages for each row execute function public.notify_direct_message();
revoke all on function public.notify_direct_message() from public,anon,authenticated;
