-- Lock the confirmed Base Sepolia deployment policy without enabling crypto unlock.
-- Public addresses are safe to persist; private keys never belong in Postgres.

alter table public.crypto_chain_config
  add column if not exists admin_address text,
  add column if not exists minter_address text,
  add column if not exists deployment_verified_at timestamptz;

alter table public.crypto_chain_config
  drop constraint if exists crypto_chain_config_admin_address_check,
  add constraint crypto_chain_config_admin_address_check check (
    admin_address is null or (
      admin_address = lower(admin_address)
      and admin_address ~ '^0x[0-9a-f]{40}$'
    )
  ),
  drop constraint if exists crypto_chain_config_minter_address_check,
  add constraint crypto_chain_config_minter_address_check check (
    minter_address is null or (
      minter_address = lower(minter_address)
      and minter_address ~ '^0x[0-9a-f]{40}$'
    )
  );

update public.crypto_chain_config
set chain_id = 84532,
    network_name = 'Base Sepolia',
    initial_cap_micro_fav = 10000000000000,
    admin_address = lower('0xB15bd11EBF03feceE5F92F260def797542E0f570'),
    unlock_enabled = false,
    updated_at = now()
where id = true;

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
    'deployed_at', deployed_at,
    'admin_address', admin_address,
    'minter_address', minter_address,
    'deployment_verified_at', deployment_verified_at
  )
  from public.crypto_chain_config
  where id = true;
$$;

revoke all on function public.get_crypto_chain_status() from public;
grant execute on function public.get_crypto_chain_status() to authenticated;

create or replace function public.record_fav_testnet_role_addresses(
  p_admin_address text,
  p_minter_address text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin text := lower(trim(coalesce(p_admin_address, '')));
  v_minter text := lower(trim(coalesce(p_minter_address, '')));
  v_expected_admin text;
  v_config public.crypto_chain_config%rowtype;
begin
  if v_admin !~ '^0x[0-9a-f]{40}$' then raise exception 'invalid admin address'; end if;
  if v_minter !~ '^0x[0-9a-f]{40}$' then raise exception 'invalid minter address'; end if;

  select admin_address into v_expected_admin
  from public.crypto_chain_config
  where id = true
  for update;

  if v_expected_admin is null then raise exception 'FAV testnet admin policy is not configured'; end if;
  if v_admin <> v_expected_admin then raise exception 'admin address does not match locked FAV testnet policy'; end if;

  update public.crypto_chain_config
  set minter_address = v_minter,
      updated_at = now()
  where id = true
  returning * into v_config;

  return jsonb_build_object(
    'chain_id', v_config.chain_id,
    'admin_address', v_config.admin_address,
    'minter_address', v_config.minter_address,
    'initial_cap_micro_fav', v_config.initial_cap_micro_fav,
    'unlock_enabled', v_config.unlock_enabled
  );
end;
$$;

revoke all on function public.record_fav_testnet_role_addresses(text,text) from public;
revoke all on function public.record_fav_testnet_role_addresses(text,text) from anon;
revoke all on function public.record_fav_testnet_role_addresses(text,text) from authenticated;
grant execute on function public.record_fav_testnet_role_addresses(text,text) to service_role;

create or replace function public.mark_fav_token_deployment_verified(
  p_token_address text,
  p_admin_address text,
  p_minter_address text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := lower(trim(coalesce(p_token_address, '')));
  v_admin text := lower(trim(coalesce(p_admin_address, '')));
  v_minter text := lower(trim(coalesce(p_minter_address, '')));
  v_config public.crypto_chain_config%rowtype;
begin
  if v_token !~ '^0x[0-9a-f]{40}$' then raise exception 'invalid token address'; end if;
  if v_admin !~ '^0x[0-9a-f]{40}$' then raise exception 'invalid admin address'; end if;
  if v_minter !~ '^0x[0-9a-f]{40}$' then raise exception 'invalid minter address'; end if;

  select * into v_config
  from public.crypto_chain_config
  where id = true
  for update;

  if not found then raise exception 'crypto chain config is missing'; end if;
  if v_config.chain_id <> 84532 then raise exception 'deployment verification is restricted to Base Sepolia'; end if;
  if v_config.initial_cap_micro_fav <> 10000000000000 then raise exception 'unexpected configured FAV cap'; end if;
  if v_config.token_address is null or v_config.token_address <> v_token then raise exception 'token address does not match recorded deployment'; end if;
  if v_config.admin_address is null or v_config.admin_address <> v_admin then raise exception 'admin address does not match locked deployment policy'; end if;
  if v_config.minter_address is null or v_config.minter_address <> v_minter then raise exception 'minter address does not match recorded deployment roles'; end if;

  update public.crypto_chain_config
  set deployment_verified_at = now(),
      updated_at = now()
  where id = true
  returning * into v_config;

  return jsonb_build_object(
    'chain_id', v_config.chain_id,
    'token_address', v_config.token_address,
    'admin_address', v_config.admin_address,
    'minter_address', v_config.minter_address,
    'deployment_verified_at', v_config.deployment_verified_at,
    'unlock_enabled', v_config.unlock_enabled
  );
end;
$$;

revoke all on function public.mark_fav_token_deployment_verified(text,text,text) from public;
revoke all on function public.mark_fav_token_deployment_verified(text,text,text) from anon;
revoke all on function public.mark_fav_token_deployment_verified(text,text,text) from authenticated;
grant execute on function public.mark_fav_token_deployment_verified(text,text,text) to service_role;

create or replace function public.set_fav_crypto_unlock_enabled(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_enabled and not exists(
    select 1
    from public.crypto_chain_config
    where id = true
      and token_address is not null
      and deployed_at is not null
      and deployment_verified_at is not null
      and admin_address is not null
      and minter_address is not null
  ) then
    raise exception 'cannot enable crypto unlock before the FAV deployment and roles are verified';
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
