-- Keep birth dates out of public profiles and editable JWT metadata.
create schema if not exists private;
create table private.account_birth_dates (
  user_id uuid primary key references auth.users(id) on delete cascade,
  birth_date date not null check (birth_date >= date '1900-01-01'),
  recorded_at timestamptz not null default now()
);
alter table private.account_birth_dates enable row level security;
revoke all on private.account_birth_dates from public, anon, authenticated;

create function private.capture_signup_birth_date() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  supplied text := new.raw_user_meta_data->>'birth_date';
  birthday date;
  today date := (now() at time zone 'UTC')::date;
begin
  if supplied is null or supplied !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Enter a valid date of birth.';
  end if;
  begin birthday := supplied::date;
  exception when others then raise exception 'Enter a valid date of birth.'; end;
  if birthday < date '1900-01-01' or birthday > today then
    raise exception 'Enter a valid date of birth.';
  end if;
  if birthday > (today - interval '13 years')::date then
    raise exception 'You must be at least 13 to create a Favourit account.';
  end if;
  insert into private.account_birth_dates(user_id,birth_date) values(new.id,birthday);
  return new;
end;
$$;
revoke all on function private.capture_signup_birth_date() from public, anon, authenticated;
create trigger capture_signup_birth_date after insert on auth.users
for each row execute function private.capture_signup_birth_date();

-- Do not trust/backfill historical user-editable metadata. Existing accounts without
-- a birth date retain marketplace access and need a support-reviewed date for crypto.
create function public.get_my_age_eligibility() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare birthday date;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select birth_date into birthday from private.account_birth_dates where user_id=auth.uid();
  return jsonb_build_object(
    'birth_date_recorded', birthday is not null,
    'crypto_age_eligible', coalesce(birthday <= ((now() at time zone 'UTC')::date - interval '18 years')::date,false)
  );
end;
$$;
revoke all on function public.get_my_age_eligibility() from public, anon;
grant execute on function public.get_my_age_eligibility() to authenticated;

create function private.require_crypto_age() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Cancellation, failure and disconnect remain available, including to minors.
  if TG_TABLE_NAME = 'crypto_unlock_requests' then
    if new.status in ('cancelled','failed') then return new; end if;
  elsif TG_TABLE_NAME = 'crypto_wallets' then
    if not new.is_active then return new; end if;
  end if;
  if not exists (
    select 1 from private.account_birth_dates
    where user_id=new.user_id
      and birth_date <= ((now() at time zone 'UTC')::date - interval '18 years')::date
  ) then
    raise exception 'Crypto buying, selling and conversion require a recorded age of 18 or older.' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.require_crypto_age() from public, anon, authenticated;
-- Table guards cover RPCs, direct API writes and service-role processing alike.
-- A rejected insert rolls back any preceding balance/earned-lot deductions.
create trigger require_crypto_age before insert or update on public.crypto_unlock_requests
for each row execute function private.require_crypto_age();
create trigger require_crypto_age before insert or update on public.crypto_wallets
for each row execute function private.require_crypto_age();
create trigger require_crypto_age before insert on public.crypto_wallet_link_challenges
for each row execute function private.require_crypto_age();

-- Migration 0031 treated generated handles as chosen. Repair only untouched
-- generated handles; preserve all explicitly selected usernames.
update public.profiles set username_chosen=false
where username='user_'||substr(id::text,1,8) and username_last_changed_at is null;

create or replace function public.get_my_username_status()
returns table(username text, username_chosen boolean, display_name text, email text, username_last_changed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return query select p.username,coalesce(p.username_chosen,false),p.display_name,
    au.email::text,p.username_last_changed_at
  from public.profiles p join auth.users au on au.id=p.id where p.id=auth.uid();
end;
$$;
revoke all on function public.get_my_username_status() from public, anon;
grant execute on function public.get_my_username_status() to authenticated;
