-- Immutable-style audit trail for FAV crypto/economy configuration changes.
-- No client policies are granted; this is operational evidence for service/admin review only.

create table if not exists public.fav_crypto_config_audit_log (
  id bigint generated always as identity primary key,
  changed_at timestamptz not null default now(),
  actor_user_id uuid,
  database_role text not null default current_user,
  config_area text not null check (config_area in ('chain','economy')),
  operation text not null check (operation in ('INSERT','UPDATE','DELETE')),
  old_value jsonb,
  new_value jsonb
);

create index if not exists fav_crypto_config_audit_log_changed_at_idx
  on public.fav_crypto_config_audit_log(changed_at desc, id desc);

alter table public.fav_crypto_config_audit_log enable row level security;
revoke all on table public.fav_crypto_config_audit_log from public;
revoke all on table public.fav_crypto_config_audit_log from anon;
revoke all on table public.fav_crypto_config_audit_log from authenticated;
grant select on table public.fav_crypto_config_audit_log to service_role;

create or replace function public.audit_fav_crypto_chain_config_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.fav_crypto_config_audit_log(
    actor_user_id, database_role, config_area, operation, old_value, new_value
  ) values (
    auth.uid(), current_user, 'chain', tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

revoke all on function public.audit_fav_crypto_chain_config_change() from public;

drop trigger if exists fav_crypto_chain_config_audit on public.crypto_chain_config;
create trigger fav_crypto_chain_config_audit
after insert or update or delete on public.crypto_chain_config
for each row execute function public.audit_fav_crypto_chain_config_change();

create or replace function public.audit_fav_crypto_economy_config_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  v_old := jsonb_build_object(
    'buyer_fee_bps', old.buyer_fee_bps,
    'seller_fee_bps', old.seller_fee_bps,
    'crypto_unlock_fee_bps', old.crypto_unlock_fee_bps,
    'crypto_unlock_maturity_hours', old.crypto_unlock_maturity_hours
  );
  v_new := jsonb_build_object(
    'buyer_fee_bps', new.buyer_fee_bps,
    'seller_fee_bps', new.seller_fee_bps,
    'crypto_unlock_fee_bps', new.crypto_unlock_fee_bps,
    'crypto_unlock_maturity_hours', new.crypto_unlock_maturity_hours
  );

  if v_old is distinct from v_new then
    insert into public.fav_crypto_config_audit_log(
      actor_user_id, database_role, config_area, operation, old_value, new_value
    ) values (
      auth.uid(), current_user, 'economy', 'UPDATE', v_old, v_new
    );
  end if;
  return new;
end;
$$;

revoke all on function public.audit_fav_crypto_economy_config_change() from public;

drop trigger if exists fav_crypto_economy_config_audit on public.economy_config;
create trigger fav_crypto_economy_config_audit
after update of buyer_fee_bps, seller_fee_bps, crypto_unlock_fee_bps, crypto_unlock_maturity_hours
on public.economy_config
for each row execute function public.audit_fav_crypto_economy_config_change();
