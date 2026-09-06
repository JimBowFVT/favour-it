-- Make verified testnet deployment metadata immutable and require an explicit seller-earnings
-- maturity policy before crypto unlock can ever be enabled.

alter table public.economy_config
  add column if not exists crypto_unlock_maturity_hours integer
    check (crypto_unlock_maturity_hours is null or crypto_unlock_maturity_hours between 1 and 8760);

create or replace function public.current_crypto_unlock_maturity_hours()
returns integer
language sql
stable
set search_path = public
as $$
  select crypto_unlock_maturity_hours from public.economy_config where id = true;
$$;

revoke all on function public.current_crypto_unlock_maturity_hours() from public;

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
  if coalesce(p_enable_unlock,false) then raise exception 'deployment recording cannot enable crypto unlock'; end if;

  select * into v_config
  from public.crypto_chain_config
  where id = true
  for update;
  if not found then raise exception 'crypto chain config is missing'; end if;

  if v_config.deployment_verified_at is not null then
    if v_config.token_address <> v_address then raise exception 'verified FAV token address is immutable'; end if;
    if coalesce(v_config.deployment_tx_hash,'') <> coalesce(v_tx_hash,'') then raise exception 'verified FAV deployment transaction is immutable'; end if;
    return jsonb_build_object(
      'chain_id', v_config.chain_id,
      'token_address', v_config.token_address,
      'initial_cap_micro_fav', v_config.initial_cap_micro_fav,
      'unlock_enabled', v_config.unlock_enabled,
      'deployment_tx_hash', v_config.deployment_tx_hash,
      'deployed_at', v_config.deployed_at,
      'deployment_verified_at', v_config.deployment_verified_at
    );
  end if;

  update public.crypto_chain_config
  set token_address = v_address,
      deployment_tx_hash = v_tx_hash,
      deployed_at = now(),
      unlock_enabled = false,
      updated_at = now()
  where id = true
  returning * into v_config;

  return jsonb_build_object(
    'chain_id', v_config.chain_id,
    'token_address', v_config.token_address,
    'initial_cap_micro_fav', v_config.initial_cap_micro_fav,
    'unlock_enabled', v_config.unlock_enabled,
    'deployment_tx_hash', v_config.deployment_tx_hash,
    'deployed_at', v_config.deployed_at,
    'deployment_verified_at', v_config.deployment_verified_at
  );
end;
$$;

revoke all on function public.record_fav_token_deployment(text,text,boolean) from public;
revoke all on function public.record_fav_token_deployment(text,text,boolean) from anon;
revoke all on function public.record_fav_token_deployment(text,text,boolean) from authenticated;
grant execute on function public.record_fav_token_deployment(text,text,boolean) to service_role;

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
  v_config public.crypto_chain_config%rowtype;
begin
  if v_admin !~ '^0x[0-9a-f]{40}$' then raise exception 'invalid admin address'; end if;
  if v_minter !~ '^0x[0-9a-f]{40}$' then raise exception 'invalid minter address'; end if;

  select * into v_config
  from public.crypto_chain_config
  where id = true
  for update;
  if not found then raise exception 'crypto chain config is missing'; end if;

  if v_config.admin_address is null then raise exception 'FAV testnet admin policy is not configured'; end if;
  if v_admin <> v_config.admin_address then raise exception 'admin address does not match locked FAV testnet policy'; end if;

  if v_config.deployment_verified_at is not null then
    if v_config.minter_address <> v_minter then raise exception 'verified FAV minter address is immutable'; end if;
    return jsonb_build_object(
      'chain_id', v_config.chain_id,
      'admin_address', v_config.admin_address,
      'minter_address', v_config.minter_address,
      'initial_cap_micro_fav', v_config.initial_cap_micro_fav,
      'unlock_enabled', v_config.unlock_enabled,
      'deployment_verified_at', v_config.deployment_verified_at
    );
  end if;

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

create or replace function public.set_fav_crypto_unlock_enabled(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_enabled and public.current_crypto_unlock_maturity_hours() is null then
    raise exception 'cannot enable crypto unlock before seller earning maturity policy is configured';
  end if;

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
