-- Harden wallet verification lifecycle before the first Base Sepolia deployment.

create index if not exists crypto_wallet_link_challenges_expires_idx
  on public.crypto_wallet_link_challenges(expires_at);

create or replace function public.create_wallet_link_challenge(
  p_wallet_address text,
  p_chain_id bigint default 84532
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_address text := lower(trim(coalesce(p_wallet_address, '')));
  v_chain_id bigint;
  v_nonce text;
  v_challenge_id uuid := gen_random_uuid();
  v_issued_at timestamptz := now();
  v_expires_at timestamptz := now() + interval '10 minutes';
  v_message text;
  v_recent integer;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if v_address !~ '^0x[0-9a-f]{40}$' then raise exception 'invalid EVM wallet address'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':wallet-link', 0));

  select chain_id into v_chain_id
  from public.crypto_chain_config
  where id = true;

  if v_chain_id is null or p_chain_id <> v_chain_id then
    raise exception 'unsupported crypto network';
  end if;

  if exists(
    select 1 from public.crypto_wallets
    where chain_id = p_chain_id
      and wallet_address = v_address
      and user_id <> v_user
  ) then
    raise exception 'wallet is already linked to another Favourit account';
  end if;

  select count(*)::integer into v_recent
  from public.crypto_wallet_link_challenges
  where user_id = v_user and created_at > now() - interval '10 minutes';

  if v_recent >= 5 then
    raise exception 'too many wallet verification attempts; try again later';
  end if;

  -- Keep at most one usable challenge per account/network. Old signatures cannot become valid again.
  update public.crypto_wallet_link_challenges
  set consumed_at = coalesce(consumed_at, now())
  where user_id = v_user
    and chain_id = p_chain_id
    and consumed_at is null;

  v_nonce := encode(gen_random_bytes(24), 'hex');
  v_message := concat(
    'Favourit Wallet Verification', E'\n\n',
    'Favourit user: ', v_user::text, E'\n',
    'Wallet: ', v_address, E'\n',
    'Chain ID: ', p_chain_id::text, E'\n',
    'Nonce: ', v_nonce, E'\n',
    'Issued at: ', to_char(v_issued_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), E'\n',
    'Expires at: ', to_char(v_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), E'\n\n',
    'Signing this message only proves wallet ownership. It does not send a transaction or spend funds.'
  );

  insert into public.crypto_wallet_link_challenges(
    id, user_id, chain_id, wallet_address, nonce, message, expires_at, created_at
  ) values (
    v_challenge_id, v_user, p_chain_id, v_address, v_nonce, v_message, v_expires_at, v_issued_at
  );

  return jsonb_build_object(
    'challenge_id', v_challenge_id,
    'wallet_address', v_address,
    'chain_id', p_chain_id,
    'message', v_message,
    'expires_at', v_expires_at
  );
end;
$$;

revoke all on function public.create_wallet_link_challenge(text,bigint) from public;
grant execute on function public.create_wallet_link_challenge(text,bigint) to authenticated;

create or replace function public.complete_crypto_wallet_link(
  p_user_id uuid,
  p_challenge_id uuid,
  p_verified_address text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge public.crypto_wallet_link_challenges%rowtype;
  v_address text := lower(trim(coalesce(p_verified_address, '')));
  v_wallet public.crypto_wallets%rowtype;
  v_existing public.crypto_wallets%rowtype;
begin
  if p_user_id is null or p_challenge_id is null then raise exception 'wallet verification identifiers are required'; end if;
  if v_address !~ '^0x[0-9a-f]{40}$' then raise exception 'invalid verified wallet address'; end if;

  select * into v_challenge
  from public.crypto_wallet_link_challenges
  where id = p_challenge_id and user_id = p_user_id
  for update;

  if not found then raise exception 'wallet verification challenge not found'; end if;
  if v_challenge.consumed_at is not null then raise exception 'wallet verification challenge already used'; end if;
  if v_challenge.expires_at <= now() then raise exception 'wallet verification challenge expired'; end if;
  if v_challenge.wallet_address <> v_address then raise exception 'wallet signature does not match the challenge'; end if;

  if exists(
    select 1 from public.crypto_wallets
    where chain_id = v_challenge.chain_id
      and wallet_address = v_address
      and user_id <> p_user_id
  ) then
    raise exception 'wallet is already linked to another Favourit account';
  end if;

  select * into v_existing
  from public.crypto_wallets
  where user_id = p_user_id and chain_id = v_challenge.chain_id
  for update;

  if found and v_existing.wallet_address <> v_address and exists(
    select 1 from public.crypto_unlock_requests
    where user_id = p_user_id and status in ('pending','processing','broadcast')
  ) then
    raise exception 'cannot change wallet while a crypto unlock is pending';
  end if;

  insert into public.crypto_wallets(user_id, chain_id, wallet_address, verified_at, last_used_at, is_active)
  values(p_user_id, v_challenge.chain_id, v_address, now(), now(), true)
  on conflict (user_id, chain_id) do update
    set wallet_address = excluded.wallet_address,
        verified_at = excluded.verified_at,
        last_used_at = excluded.last_used_at,
        is_active = true
  returning * into v_wallet;

  update public.crypto_wallet_link_challenges
  set consumed_at = now()
  where id = v_challenge.id;

  return jsonb_build_object(
    'id', v_wallet.id,
    'user_id', v_wallet.user_id,
    'chain_id', v_wallet.chain_id,
    'wallet_address', v_wallet.wallet_address,
    'verified_at', v_wallet.verified_at,
    'is_active', v_wallet.is_active
  );
end;
$$;

revoke all on function public.complete_crypto_wallet_link(uuid,uuid,text) from public;
revoke all on function public.complete_crypto_wallet_link(uuid,uuid,text) from anon;
revoke all on function public.complete_crypto_wallet_link(uuid,uuid,text) from authenticated;
grant execute on function public.complete_crypto_wallet_link(uuid,uuid,text) to service_role;

create or replace function public.disconnect_my_crypto_wallet(p_chain_id bigint default 84532)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  if exists(
    select 1 from public.crypto_unlock_requests
    where user_id = v_user and status in ('pending','processing','broadcast')
  ) then
    raise exception 'cannot disconnect wallet while a crypto unlock is pending';
  end if;

  update public.crypto_wallets
  set is_active = false, updated_at = now()
  where user_id = v_user and chain_id = p_chain_id;

  return true;
end;
$$;

revoke all on function public.disconnect_my_crypto_wallet(bigint) from public;
grant execute on function public.disconnect_my_crypto_wallet(bigint) to authenticated;
