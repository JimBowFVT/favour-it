-- Execute as a database administrator on the intended existing project.
-- This transaction is READ ONLY. No fixtures/users/claims are inserted.
begin read only;
set local statement_timeout='10s';
do $$ begin
 if exists(select 1 from auth.users where id='f6f61c99-8d98-47e0-9c99-e99c35c0dd31') then
   raise exception 'QA identifier unexpectedly exists';
 end if;
end $$;
select set_config('qa.foreign_transaction',coalesce((select id::text from favourit_private.wallet_activity_events limit 1),'00000000-0000-4000-8000-000000000001'),true);
set local role anon;
do $$ begin
 begin perform public.get_my_wallet_overview(); raise exception 'Anonymous overview access allowed'; exception when insufficient_privilege then null; end;
 begin perform public.list_my_wallet_activity('{}',null,30,null); raise exception 'Anonymous activity access allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"f6f61c99-8d98-47e0-9c99-e99c35c0dd31","role":"authenticated"}',true);
set local role authenticated;
do $$ declare result jsonb; denied boolean:=false; begin
 result:=public.get_my_wallet_overview();
 if result->'wallet' is distinct from 'null'::jsonb then raise exception 'Missing wallet must not return another member balance'; end if;
 result:=public.list_my_wallet_activity('{}',null,30,null);
 if jsonb_array_length(result->'items')<>0 then raise exception 'Foreign transactions exposed'; end if;
 if public.get_my_wallet_transaction(current_setting('qa.foreign_transaction')::uuid) is not null then raise exception 'Transaction ownership bypass'; end if;
 if (public.get_my_account_eligibility()->>'crypto_eligible')::boolean then raise exception 'Unknown account gained crypto eligibility'; end if;
 begin perform public.claim_daily_reward(); raise exception 'Legacy reward execute allowed'; exception when insufficient_privilege then null; end;
 begin perform public.begin_my_wallet_statement('{}','00000000-0000-4000-8000-000000000002'); exception when raise_exception then if SQLERRM not like '%account changed%' then raise; end if; denied:=true; end;
 if not denied then raise exception 'Statement expected-account check bypassed'; end if;
 denied:=false;
 begin perform public.submit_my_wallet_support_request('00000000-0000-4000-8000-000000000001','QA ownership check','00000000-0000-4000-8000-000000000002'); exception when raise_exception then if SQLERRM not like '%account changed%' then raise; end if; denied:=true; end;
 if not denied then raise exception 'Support expected-account check bypassed'; end if;
 denied:=false;
 begin perform public.create_crypto_unlock_request(1000000,'00000000-0000-4000-8000-000000000003'); exception when raise_exception then if SQLERRM not like '%not enabled%' then raise; end if; denied:=true; end;
 if not denied then raise exception 'Disabled token path accepted unlock'; end if;
end $$;
reset role;
select 'Wallet permission, account isolation, legacy reward and disabled-unlock checks passed; read-only transaction' as result;
rollback;
