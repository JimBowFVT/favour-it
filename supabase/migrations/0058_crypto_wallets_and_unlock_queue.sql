-- FAV crypto wallet linking + testnet unlock queue
--
-- Business decisions locked for the first testnet phase:
-- - Base Sepolia only (chain id 84532)
-- - initial on-chain cap: 10,000,000 FAV = 10,000,000,000,000 micro-FAV
-- - crypto unlock fee: read from economy_config (currently 2.5%)
-- - only earned_fav can be reserved for an on-chain unlock
-- - unlocks stay disabled until a token deployment is recorded and explicitly enabled

create extension if not exists pgcrypto;

create table if not exists public.crypto_chain_config (
  id boolean primary key default true check (id = true),
  chain_id bigint not null default 84532 check (chain_id > 0),
  network_name text not null default 'Base Sepolia',
  token_address text,
  initial_cap_micro_fav bigint not null default 10000000000000 check (initial_cap_micro_fav > 0),
  unlock_enabled boolean not null default false,
  confirmations_required integer not null default 5 check (confirmations_required between 1 and 1000),
  deployment_tx_hash text,
  deployed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint crypto_chain_config_token_address_check check (
    token_address is null or token_address ~ '^0x[0-9a-f]{40}$'
  ),
  constraint crypto_chain_config_deployment_tx_hash_check check (
    deployment_tx_hash is null or deployment_tx_hash ~ '^0x[0-9a-f]{64}$'
  )
);

insert into public.crypto_chain_config(
  id, chain_id, network_name, initial_cap_micro_fav, unlock_enabled, confirmations_required
) values (
  true, 84532, 'Base Sepolia', 10000000000000, false, 5
)
on conflict (id) do update
set chain_id = 84532,
    network_name = 'Base Sepolia',
    initial_cap_micro_fav = 10000000000000,
    updated_at = now();

alter table public.crypto_chain_config enable row level security;
drop policy if exists "authenticated users can read crypto chain config" on public.crypto_chain_config;
create policy "authenticated users can read crypto chain config"
  on public.crypto_chain_config for select
  to authenticated
  using (true);

grant select on public.crypto_chain_config to authenticated;

create or replace function public.touch_crypto_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists crypto_chain_config_touch_updated_at on public.crypto_chain_config;
create trigger crypto_chain_config_touch_updated_at
before update on public.crypto_chain_config
for each row execute function public.touch_crypto_updated_at();

create table if not exists public.crypto_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  chain_id bigint not null,
  wallet_address text not null,
  verified_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crypto_wallets_address_check check (
    wallet_address = lower(wallet_address)
    and wallet_address ~ '^0x[0-9a-f]{40}$'
  ),
  unique(user_id, chain_id),
  unique(chain_id, wallet_address)
);

alter table public.crypto_wallets enable row level security;
drop policy if exists "users can read their verified crypto wallets" on public.crypto_wallets;
create policy "users can read their verified crypto wallets"
  on public.crypto_wallets for select
  to authenticated
  using (user_id = auth.uid());

grant select on public.crypto_wallets to authenticated;

drop trigger if exists crypto_wallets_touch_updated_at on public.crypto_wallets;
create trigger crypto_wallets_touch_updated_at
before update on public.crypto_wallets
for each row execute function public.touch_crypto_updated_at();

create table if not exists public.crypto_wallet_link_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  chain_id bigint not null,
  wallet_address text not null,
  nonce text not null,
  message text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint crypto_wallet_link_challenges_address_check check (
    wallet_address = lower(wallet_address)
    and wallet_address ~ '^0x[0-9a-f]{40}$'
  )
);

create index if not exists crypto_wallet_link_challenges_user_created_idx
  on public.crypto_wallet_link_challenges(user_id, created_at desc);

alter table public.crypto_wallet_link_challenges enable row level security;
drop policy if exists "users can read their wallet link challenges" on public.crypto_wallet_link_challenges;
create policy "users can read their wallet link challenges"
  on public.crypto_wallet_link_challenges for select
  to authenticated
  using (user_id = auth.uid());

grant select on public.crypto_wallet_link_challenges to authenticated;

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
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if v_address !~ '^0x[0-9a-f]{40}$' then raise exception 'invalid EVM wallet address'; end if;

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

create table if not exists public.crypto_unlock_requests (
  id uuid primary key,
  client_request_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  wallet_id uuid not null references public.crypto_wallets(id) on delete restrict,
  chain_id bigint not null,
  token_address text not null,
  destination_address text not null,
  gross_fav bigint not null check (gross_fav > 0),
  fee_fav bigint not null check (fee_fav >= 0),
  net_fav bigint not null check (net_fav > 0),
  mint_reference text not null,
  status text not null default 'pending' check (status in ('pending','processing','broadcast','confirmed','failed','cancelled')),
  tx_hash text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  processing_started_at timestamptz,
  broadcast_at timestamptz,
  confirmed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crypto_unlock_amount_check check (gross_fav = fee_fav + net_fav),
  constraint crypto_unlock_token_address_check check (token_address ~ '^0x[0-9a-f]{40}$'),
  constraint crypto_unlock_destination_address_check check (
    destination_address = lower(destination_address)
    and destination_address ~ '^0x[0-9a-f]{40}$'
  ),
  constraint crypto_unlock_mint_reference_check check (mint_reference ~ '^0x[0-9a-f]{64}$'),
  constraint crypto_unlock_tx_hash_check check (tx_hash is null or tx_hash ~ '^0x[0-9a-f]{64}$'),
  unique(user_id, client_request_id),
  unique(mint_reference),
  unique(tx_hash)
);

create index if not exists crypto_unlock_requests_user_created_idx
  on public.crypto_unlock_requests(user_id, created_at desc);
create index if not exists crypto_unlock_requests_processing_idx
  on public.crypto_unlock_requests(status, created_at)
  where status in ('pending','processing','broadcast');

alter table public.crypto_unlock_requests enable row level security;
drop policy if exists "users can read their crypto unlock requests" on public.crypto_unlock_requests;
create policy "users can read their crypto unlock requests"
  on public.crypto_unlock_requests for select
  to authenticated
  using (user_id = auth.uid());

grant select on public.crypto_unlock_requests to authenticated;

drop trigger if exists crypto_unlock_requests_touch_updated_at on public.crypto_unlock_requests;
create trigger crypto_unlock_requests_touch_updated_at
before update on public.crypto_unlock_requests
for each row execute function public.touch_crypto_updated_at();

create or replace function public.get_crypto_chain_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'chain_id', chain_id,
    'network_name', network_name,
    'token_address', token_address,
    'initial_cap_micro_fav', initial_cap_micro_fav,
    'unlock_enabled', unlock_enabled,
    'confirmations_required', confirmations_required,
    'deployment_tx_hash', deployment_tx_hash,
    'deployed_at', deployed_at
  )
  from public.crypto_chain_config
  where id = true;
$$;

revoke all on function public.get_crypto_chain_status() from public;
grant execute on function public.get_crypto_chain_status() to authenticated;

create or replace function public.create_crypto_unlock_request(
  p_amount_fav bigint,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_config public.crypto_chain_config%rowtype;
  v_wallet public.crypto_wallets%rowtype;
  v_request_id uuid := gen_random_uuid();
  v_fee bigint;
  v_net bigint;
  v_reference text;
  v_existing public.crypto_unlock_requests%rowtype;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_client_request_id is null then raise exception 'client request id is required'; end if;
  if p_amount_fav is null or p_amount_fav <= 0 then raise exception 'unlock amount must be positive'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':crypto-unlock:' || p_client_request_id::text, 0));

  select * into v_existing
  from public.crypto_unlock_requests
  where user_id = v_user and client_request_id = p_client_request_id;

  if found then
    if v_existing.gross_fav <> p_amount_fav then raise exception 'client request id was reused with a different amount'; end if;
    return jsonb_build_object(
      'id', v_existing.id,
      'gross_fav', v_existing.gross_fav,
      'fee_fav', v_existing.fee_fav,
      'net_fav', v_existing.net_fav,
      'status', v_existing.status,
      'destination_address', v_existing.destination_address,
      'chain_id', v_existing.chain_id
    );
  end if;

  select * into v_config
  from public.crypto_chain_config
  where id = true;

  if not found or not v_config.unlock_enabled then raise exception 'crypto unlock is not enabled yet'; end if;
  if v_config.chain_id <> 84532 then raise exception 'crypto unlock is restricted to Base Sepolia in this phase'; end if;
  if v_config.token_address is null then raise exception 'FAV token is not deployed yet'; end if;

  select * into v_wallet
  from public.crypto_wallets
  where user_id = v_user
    and chain_id = v_config.chain_id
    and is_active = true
  for update;

  if not found then raise exception 'verify a Base Sepolia wallet before unlocking FAV'; end if;

  v_fee := ceil(p_amount_fav::numeric * public.current_crypto_unlock_fee_bps() / 10000)::bigint;
  v_net := p_amount_fav - v_fee;
  if v_net <= 0 then raise exception 'unlock amount is too small after fee'; end if;

  -- Keep lock order aligned with marketplace checkout: wallet first, provenance second.
  update public.wallets
  set available_fav = available_fav - p_amount_fav,
      updated_at = now()
  where user_id = v_user and available_fav >= p_amount_fav;
  if not found then raise exception 'insufficient available FAV'; end if;

  update public.fav_balance_sources
  set earned_fav = earned_fav - p_amount_fav
  where user_id = v_user and earned_fav >= p_amount_fav;
  if not found then raise exception 'only FAV earned from completed services can be unlocked to crypto'; end if;

  v_reference := '0x' || encode(digest('favourit:unlock:' || v_request_id::text, 'sha256'), 'hex');

  insert into public.crypto_unlock_requests(
    id, client_request_id, user_id, wallet_id, chain_id, token_address, destination_address,
    gross_fav, fee_fav, net_fav, mint_reference, status
  ) values (
    v_request_id, p_client_request_id, v_user, v_wallet.id, v_config.chain_id,
    v_config.token_address, v_wallet.wallet_address,
    p_amount_fav, v_fee, v_net, v_reference, 'pending'
  );

  update public.crypto_wallets set last_used_at = now() where id = v_wallet.id;

  insert into public.ledger_entries(user_id, entry_type, amount_fav, idempotency_key, metadata)
  values(
    v_user,
    'adjustment',
    -p_amount_fav,
    'crypto-unlock-hold:' || v_request_id::text,
    jsonb_build_object(
      'kind', 'crypto_unlock_hold',
      'crypto_unlock_id', v_request_id,
      'gross_fav', p_amount_fav,
      'fee_fav', v_fee,
      'net_fav', v_net,
      'chain_id', v_config.chain_id,
      'destination_address', v_wallet.wallet_address,
      'mint_reference', v_reference
    )
  );

  return jsonb_build_object(
    'id', v_request_id,
    'gross_fav', p_amount_fav,
    'fee_fav', v_fee,
    'net_fav', v_net,
    'status', 'pending',
    'destination_address', v_wallet.wallet_address,
    'chain_id', v_config.chain_id,
    'mint_reference', v_reference
  );
end;
$$;

revoke all on function public.create_crypto_unlock_request(bigint,uuid) from public;
grant execute on function public.create_crypto_unlock_request(bigint,uuid) to authenticated;

create or replace function public.cancel_my_crypto_unlock_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_request public.crypto_unlock_requests%rowtype;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_request
  from public.crypto_unlock_requests
  where id = p_request_id and user_id = v_user
  for update;

  if not found then raise exception 'crypto unlock request not found'; end if;
  if v_request.status = 'cancelled' then return true; end if;
  if v_request.status <> 'pending' then raise exception 'crypto unlock can no longer be cancelled'; end if;

  insert into public.wallets(user_id, available_fav)
  values(v_user, v_request.gross_fav)
  on conflict(user_id) do update
    set available_fav = public.wallets.available_fav + excluded.available_fav,
        updated_at = now();

  insert into public.fav_balance_sources(user_id, earned_fav)
  values(v_user, v_request.gross_fav)
  on conflict(user_id) do update
    set earned_fav = public.fav_balance_sources.earned_fav + excluded.earned_fav;

  update public.crypto_unlock_requests
  set status = 'cancelled', cancelled_at = now(), last_error = null
  where id = v_request.id;

  insert into public.ledger_entries(user_id, entry_type, amount_fav, idempotency_key, metadata)
  values(
    v_user,
    'adjustment',
    v_request.gross_fav,
    'crypto-unlock-cancel:' || v_request.id::text,
    jsonb_build_object('kind', 'crypto_unlock_cancel', 'crypto_unlock_id', v_request.id, 'provenance_restored', true)
  );

  return true;
end;
$$;

revoke all on function public.cancel_my_crypto_unlock_request(uuid) from public;
grant execute on function public.cancel_my_crypto_unlock_request(uuid) to authenticated;

create or replace function public.claim_next_crypto_unlock()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.crypto_unlock_requests%rowtype;
  v_confirmations integer;
  v_enabled boolean;
begin
  select unlock_enabled, confirmations_required
  into v_enabled, v_confirmations
  from public.crypto_chain_config
  where id = true;

  if not coalesce(v_enabled, false) then return null; end if;

  select * into v_request
  from public.crypto_unlock_requests
  where status = 'pending'
     or (status = 'processing' and processing_started_at < now() - interval '5 minutes' and tx_hash is null)
  order by created_at
  for update skip locked
  limit 1;

  if not found then return null; end if;

  update public.crypto_unlock_requests
  set status = 'processing',
      processing_started_at = now(),
      attempt_count = attempt_count + 1
  where id = v_request.id
  returning * into v_request;

  return jsonb_build_object(
    'id', v_request.id,
    'user_id', v_request.user_id,
    'chain_id', v_request.chain_id,
    'token_address', v_request.token_address,
    'destination_address', v_request.destination_address,
    'gross_fav', v_request.gross_fav,
    'fee_fav', v_request.fee_fav,
    'net_fav', v_request.net_fav,
    'mint_reference', v_request.mint_reference,
    'attempt_count', v_request.attempt_count,
    'confirmations_required', v_confirmations
  );
end;
$$;

revoke all on function public.claim_next_crypto_unlock() from public;
revoke all on function public.claim_next_crypto_unlock() from anon;
revoke all on function public.claim_next_crypto_unlock() from authenticated;
grant execute on function public.claim_next_crypto_unlock() to service_role;

create or replace function public.mark_crypto_unlock_broadcast(
  p_request_id uuid,
  p_tx_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.crypto_unlock_requests%rowtype;
  v_tx_hash text := lower(trim(coalesce(p_tx_hash, '')));
begin
  if v_tx_hash !~ '^0x[0-9a-f]{64}$' then raise exception 'invalid transaction hash'; end if;

  select * into v_request
  from public.crypto_unlock_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'crypto unlock request not found'; end if;
  if v_request.status = 'confirmed' and v_request.tx_hash = v_tx_hash then return true; end if;
  if v_request.status not in ('processing','broadcast') then raise exception 'crypto unlock request is not processing'; end if;
  if v_request.tx_hash is not null and v_request.tx_hash <> v_tx_hash then raise exception 'crypto unlock already has a different transaction hash'; end if;

  update public.crypto_unlock_requests
  set status = 'broadcast', tx_hash = v_tx_hash, broadcast_at = coalesce(broadcast_at, now()), last_error = null
  where id = v_request.id;

  return true;
end;
$$;

revoke all on function public.mark_crypto_unlock_broadcast(uuid,text) from public;
revoke all on function public.mark_crypto_unlock_broadcast(uuid,text) from anon;
revoke all on function public.mark_crypto_unlock_broadcast(uuid,text) from authenticated;
grant execute on function public.mark_crypto_unlock_broadcast(uuid,text) to service_role;

create or replace function public.requeue_crypto_unlock(
  p_request_id uuid,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.crypto_unlock_requests%rowtype;
begin
  select * into v_request
  from public.crypto_unlock_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'crypto unlock request not found'; end if;
  if v_request.status = 'pending' then return true; end if;
  if v_request.status <> 'processing' or v_request.tx_hash is not null then raise exception 'only an unbroadcast processing request can be requeued'; end if;

  update public.crypto_unlock_requests
  set status = 'pending', processing_started_at = null, last_error = left(coalesce(p_reason, 'retry requested'), 1000)
  where id = v_request.id;

  return true;
end;
$$;

revoke all on function public.requeue_crypto_unlock(uuid,text) from public;
revoke all on function public.requeue_crypto_unlock(uuid,text) from anon;
revoke all on function public.requeue_crypto_unlock(uuid,text) from authenticated;
grant execute on function public.requeue_crypto_unlock(uuid,text) to service_role;

create or replace function public.get_crypto_unlocks_for_reconciliation(p_limit integer default 25)
returns table(
  id uuid,
  chain_id bigint,
  token_address text,
  destination_address text,
  net_fav bigint,
  mint_reference text,
  tx_hash text,
  confirmations_required integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select r.id, r.chain_id, r.token_address, r.destination_address, r.net_fav,
         r.mint_reference, r.tx_hash, c.confirmations_required
  from public.crypto_unlock_requests r
  join public.crypto_chain_config c on c.id = true
  where r.status = 'broadcast' and r.tx_hash is not null
  order by r.broadcast_at nulls last, r.created_at
  limit greatest(1, least(coalesce(p_limit, 25), 100));
end;
$$;

revoke all on function public.get_crypto_unlocks_for_reconciliation(integer) from public;
revoke all on function public.get_crypto_unlocks_for_reconciliation(integer) from anon;
revoke all on function public.get_crypto_unlocks_for_reconciliation(integer) from authenticated;
grant execute on function public.get_crypto_unlocks_for_reconciliation(integer) to service_role;

create or replace function public.finalize_crypto_unlock_success(
  p_request_id uuid,
  p_tx_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.crypto_unlock_requests%rowtype;
  v_tx_hash text := case when p_tx_hash is null then null else lower(trim(p_tx_hash)) end;
begin
  if v_tx_hash is not null and v_tx_hash !~ '^0x[0-9a-f]{64}$' then raise exception 'invalid transaction hash'; end if;

  select * into v_request
  from public.crypto_unlock_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'crypto unlock request not found'; end if;
  if v_request.status = 'confirmed' then return true; end if;
  if v_request.status in ('failed','cancelled') then raise exception 'crypto unlock request is already closed'; end if;
  if v_request.status not in ('processing','broadcast') then raise exception 'crypto unlock request is not ready to finalize'; end if;
  if v_request.tx_hash is not null and v_tx_hash is not null and v_request.tx_hash <> v_tx_hash then raise exception 'transaction hash mismatch'; end if;

  update public.platform_accounts
  set available_fav = available_fav + v_request.fee_fav,
      updated_at = now()
  where id = true;

  update public.crypto_unlock_requests
  set status = 'confirmed',
      tx_hash = coalesce(tx_hash, v_tx_hash),
      confirmed_at = now(),
      last_error = null
  where id = v_request.id;

  return true;
end;
$$;

revoke all on function public.finalize_crypto_unlock_success(uuid,text) from public;
revoke all on function public.finalize_crypto_unlock_success(uuid,text) from anon;
revoke all on function public.finalize_crypto_unlock_success(uuid,text) from authenticated;
grant execute on function public.finalize_crypto_unlock_success(uuid,text) to service_role;

create or replace function public.finalize_crypto_unlock_failure(
  p_request_id uuid,
  p_reason text,
  p_tx_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.crypto_unlock_requests%rowtype;
  v_tx_hash text := case when p_tx_hash is null then null else lower(trim(p_tx_hash)) end;
begin
  if v_tx_hash is not null and v_tx_hash !~ '^0x[0-9a-f]{64}$' then raise exception 'invalid transaction hash'; end if;

  select * into v_request
  from public.crypto_unlock_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'crypto unlock request not found'; end if;
  if v_request.status = 'failed' then return true; end if;
  if v_request.status = 'cancelled' then return true; end if;
  if v_request.status = 'confirmed' then raise exception 'confirmed crypto unlock cannot be failed'; end if;
  if v_request.status not in ('processing','broadcast') then raise exception 'crypto unlock request is not processing'; end if;
  if v_request.tx_hash is not null and v_tx_hash is not null and v_request.tx_hash <> v_tx_hash then raise exception 'transaction hash mismatch'; end if;

  insert into public.wallets(user_id, available_fav)
  values(v_request.user_id, v_request.gross_fav)
  on conflict(user_id) do update
    set available_fav = public.wallets.available_fav + excluded.available_fav,
        updated_at = now();

  insert into public.fav_balance_sources(user_id, earned_fav)
  values(v_request.user_id, v_request.gross_fav)
  on conflict(user_id) do update
    set earned_fav = public.fav_balance_sources.earned_fav + excluded.earned_fav;

  update public.crypto_unlock_requests
  set status = 'failed',
      tx_hash = coalesce(tx_hash, v_tx_hash),
      failed_at = now(),
      last_error = left(coalesce(nullif(trim(p_reason), ''), 'on-chain mint failed'), 1000)
  where id = v_request.id;

  insert into public.ledger_entries(user_id, entry_type, amount_fav, idempotency_key, metadata)
  values(
    v_request.user_id,
    'adjustment',
    v_request.gross_fav,
    'crypto-unlock-refund:' || v_request.id::text,
    jsonb_build_object(
      'kind', 'crypto_unlock_refund',
      'crypto_unlock_id', v_request.id,
      'provenance_restored', true,
      'reason', left(coalesce(p_reason, 'on-chain mint failed'), 1000)
    )
  );

  return true;
end;
$$;

revoke all on function public.finalize_crypto_unlock_failure(uuid,text,text) from public;
revoke all on function public.finalize_crypto_unlock_failure(uuid,text,text) from anon;
revoke all on function public.finalize_crypto_unlock_failure(uuid,text,text) from authenticated;
grant execute on function public.finalize_crypto_unlock_failure(uuid,text,text) to service_role;

create or replace function public.record_fav_token_deployment(
  p_token_address text,
  p_deployment_tx_hash text default null,
  p_enable_unlock boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_address text := lower(trim(coalesce(p_token_address, '')));
  v_tx_hash text := case when p_deployment_tx_hash is null then null else lower(trim(p_deployment_tx_hash)) end;
  v_config public.crypto_chain_config%rowtype;
begin
  if v_address !~ '^0x[0-9a-f]{40}$' then raise exception 'invalid token address'; end if;
  if v_tx_hash is not null and v_tx_hash !~ '^0x[0-9a-f]{64}$' then raise exception 'invalid deployment transaction hash'; end if;

  update public.crypto_chain_config
  set token_address = v_address,
      deployment_tx_hash = v_tx_hash,
      deployed_at = now(),
      unlock_enabled = coalesce(p_enable_unlock, false),
      updated_at = now()
  where id = true
  returning * into v_config;

  return jsonb_build_object(
    'chain_id', v_config.chain_id,
    'token_address', v_config.token_address,
    'initial_cap_micro_fav', v_config.initial_cap_micro_fav,
    'unlock_enabled', v_config.unlock_enabled,
    'deployment_tx_hash', v_config.deployment_tx_hash,
    'deployed_at', v_config.deployed_at
  );
end;
$$;

revoke all on function public.record_fav_token_deployment(text,text,boolean) from public;
revoke all on function public.record_fav_token_deployment(text,text,boolean) from anon;
revoke all on function public.record_fav_token_deployment(text,text,boolean) from authenticated;
grant execute on function public.record_fav_token_deployment(text,text,boolean) to service_role;

create or replace function public.set_fav_crypto_unlock_enabled(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_enabled and not exists(
    select 1 from public.crypto_chain_config where id = true and token_address is not null and deployed_at is not null
  ) then
    raise exception 'cannot enable crypto unlock before a token deployment is recorded';
  end if;

  update public.crypto_chain_config
  set unlock_enabled = coalesce(p_enabled, false), updated_at = now()
  where id = true;

  return true;
end;
$$;

revoke all on function public.set_fav_crypto_unlock_enabled(boolean) from public;
revoke all on function public.set_fav_crypto_unlock_enabled(boolean) from anon;
revoke all on function public.set_fav_crypto_unlock_enabled(boolean) from authenticated;
grant execute on function public.set_fav_crypto_unlock_enabled(boolean) to service_role;

-- Extend the existing wallet breakdown with crypto reservations without changing source semantics.
create or replace function public.get_my_fav_balance_breakdown()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'available_fav', coalesce(w.available_fav, 0),
    'held_fav', coalesce(w.held_fav, 0),
    'reward_fav', coalesce(s.reward_fav, 0),
    'purchased_fav', coalesce(s.purchased_fav, 0),
    'earned_fav', coalesce(s.earned_fav, 0),
    'legacy_fav', coalesce(s.legacy_fav, 0),
    'crypto_eligible_fav', coalesce(s.earned_fav, 0),
    'pending_crypto_unlock_fav', coalesce((
      select sum(r.gross_fav)
      from public.crypto_unlock_requests r
      where r.user_id = u.user_id and r.status in ('pending','processing','broadcast')
    ), 0),
    'crypto_unlock_fee_bps', public.current_crypto_unlock_fee_bps()
  )
  from (select auth.uid() as user_id) u
  left join public.wallets w on w.user_id = u.user_id
  left join public.fav_balance_sources s on s.user_id = u.user_id;
$$;

revoke all on function public.get_my_fav_balance_breakdown() from public;
grant execute on function public.get_my_fav_balance_breakdown() to authenticated;
