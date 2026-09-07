-- Run after the migration inside BEGIN ... ROLLBACK. Test data never persists.
set local role anon;
do $$ begin
  if (public.get_founding_programme()->>'applications_open')::boolean then raise exception 'Intake must default closed'; end if;
  begin perform * from marketing_private.applications; raise exception 'Anonymous table read was allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_list_founding_applications(''); raise exception 'Anonymous admin access was allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000099","email":"ordinary@example.com","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  begin perform public.admin_set_founding_applications_open(true); raise exception 'Ordinary user opened intake';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_list_founding_applications(''); raise exception 'Ordinary user read applications';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000098","email":"adamzoharlevi@gmail.com","role":"authenticated"}',true);
set local role authenticated;
select public.admin_set_founding_applications_open(true);
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ declare v_data jsonb := '{"name":"Fixture Creator","email":"fixture@example.com","area":"Visual design","offer":"A review of five portfolio pages with written notes.","need":"An edit of my introduction video this month.","portfolio":"https://example.com/work","availability":"Two hours next week","pilot_consent":true,"contact_consent":true,"adult_consent":true,"consent_version":"founding-creators-2026-09-07","attribution":{"source":"linkedin","extra":"must not be stored"}}'; begin
  if public.submit_founding_application(v_data)->>'received' <> 'true' then raise exception 'Receipt missing'; end if;
  perform public.submit_founding_application(v_data || '{"offer":"Do not overwrite my original submission"}'::jsonb);
  begin perform public.submit_founding_application(v_data || '{"pilot_consent":false}'::jsonb); raise exception 'Missing consent accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.submit_founding_application(v_data || '{"portfolio":"javascript:alert(1)"}'::jsonb); raise exception 'Unsafe URL accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.submit_founding_application(v_data || '{"website":"bot"}'::jsonb); raise exception 'Honeypot accepted';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;
do $$ begin
  if (select count(*) from marketing_private.applications)<>1 then raise exception 'Duplicate application stored'; end if;
  if (select offer from marketing_private.applications limit 1) <> 'A review of five portfolio pages with written notes.' then raise exception 'Existing application overwritten'; end if;
  if (select digest_consent from marketing_private.applications limit 1) then raise exception 'Digest opt-in assumed'; end if;
  if (select attribution ? 'extra' from marketing_private.applications limit 1) then raise exception 'Arbitrary attribution stored'; end if;
end $$;
insert into marketing_private.applications(email,name,area,offer,need,portfolio,availability,pilot_consent,contact_consent,adult_consent,digest_consent,consent_version)
select 'quota-'||n||'@example.com','Quota fixture','Writing','A long enough offer for the fixture.','A long enough need for the fixture.','https://example.com','Next week',true,true,true,false,'founding-creators-2026-09-07' from generate_series(1,99)n;
set local role anon;
do $$ begin
  begin perform public.submit_founding_application('{"name":"Quota","email":"overquota@example.com","area":"Writing","offer":"A long enough offer for a test.","need":"A long enough need for a test.","portfolio":"https://example.com","availability":"Next week","pilot_consent":true,"contact_consent":true,"adult_consent":true,"consent_version":"founding-creators-2026-09-07"}'::jsonb); raise exception 'Quota bypassed';
  exception when program_limit_exceeded then null; end;
end $$;
reset role;
select 'Intake regression checks passed; rollback required' as result;
