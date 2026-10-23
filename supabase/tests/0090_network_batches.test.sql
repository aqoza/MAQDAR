begin;
select no_plan();
select ok((select relrowsecurity from pg_class where oid='public.network_handoff_batches'::regclass),'batch RLS enabled');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.network_handoff_batch_list'::regclass),'batch history preserves RLS');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.network_handoff_batch_candidates'::regclass),'picker preserves RLS');
select ok(not has_table_privilege('anon','public.network_handoff_batches','INSERT'),'no anon direct INSERT');
select ok(not has_table_privilege('anon','public.network_handoff_batches','UPDATE'),'no anon direct UPDATE');
select ok(not has_table_privilege('anon','public.network_handoff_batches','DELETE'),'no anon direct DELETE');
select ok(not has_table_privilege('anon','public.network_handoff_batches','TRUNCATE'),'no anon direct TRUNCATE');
select ok(not has_table_privilege('anon','public.network_handoff_batches','SELECT'),'no anon direct SELECT');
select ok(not has_function_privilege('anon','public.network_handoff_batch_create(uuid,uuid[])','EXECUTE'),'no anon network_handoff_batch_create');
select ok(not has_function_privilege('anon','public.network_handoff_batch_preview(uuid,uuid[])','EXECUTE'),'no anon network_handoff_batch_preview');
select ok(not has_table_privilege('authenticated','public.network_handoff_batches','INSERT'),'no authenticated direct INSERT');
select ok(not has_table_privilege('authenticated','public.network_handoff_batches','UPDATE'),'no authenticated direct UPDATE');
select ok(not has_table_privilege('authenticated','public.network_handoff_batches','DELETE'),'no authenticated direct DELETE');
select ok(not has_table_privilege('authenticated','public.network_handoff_batches','TRUNCATE'),'no authenticated direct TRUNCATE');
select ok(not has_table_privilege('service_role','public.network_handoff_batches','INSERT'),'no service_role direct INSERT');
select ok(not has_table_privilege('service_role','public.network_handoff_batches','UPDATE'),'no service_role direct UPDATE');
select ok(not has_table_privilege('service_role','public.network_handoff_batches','DELETE'),'no service_role direct DELETE');
select ok(not has_table_privilege('service_role','public.network_handoff_batches','TRUNCATE'),'no service_role direct TRUNCATE');
select ok(not has_table_privilege('service_role','public.network_handoff_batches','SELECT'),'no service_role direct SELECT');
select ok(not has_function_privilege('service_role','public.network_handoff_batch_create(uuid,uuid[])','EXECUTE'),'no service_role network_handoff_batch_create');
select ok(not has_function_privilege('service_role','public.network_handoff_batch_preview(uuid,uuid[])','EXECUTE'),'no service_role network_handoff_batch_preview');
select ok(not has_table_privilege('zeespare_worker','public.network_handoff_batches','INSERT'),'no zeespare_worker direct INSERT');
select ok(not has_table_privilege('zeespare_worker','public.network_handoff_batches','UPDATE'),'no zeespare_worker direct UPDATE');
select ok(not has_table_privilege('zeespare_worker','public.network_handoff_batches','DELETE'),'no zeespare_worker direct DELETE');
select ok(not has_table_privilege('zeespare_worker','public.network_handoff_batches','TRUNCATE'),'no zeespare_worker direct TRUNCATE');
select ok(not has_table_privilege('zeespare_worker','public.network_handoff_batches','SELECT'),'no zeespare_worker direct SELECT');
select ok(not has_function_privilege('zeespare_worker','public.network_handoff_batch_create(uuid,uuid[])','EXECUTE'),'no zeespare_worker network_handoff_batch_create');
select ok(not has_function_privilege('zeespare_worker','public.network_handoff_batch_preview(uuid,uuid[])','EXECUTE'),'no zeespare_worker network_handoff_batch_preview');
select ok(not has_table_privilege('zeespare_simulation_worker','public.network_handoff_batches','INSERT'),'no zeespare_simulation_worker direct INSERT');
select ok(not has_table_privilege('zeespare_simulation_worker','public.network_handoff_batches','UPDATE'),'no zeespare_simulation_worker direct UPDATE');
select ok(not has_table_privilege('zeespare_simulation_worker','public.network_handoff_batches','DELETE'),'no zeespare_simulation_worker direct DELETE');
select ok(not has_table_privilege('zeespare_simulation_worker','public.network_handoff_batches','TRUNCATE'),'no zeespare_simulation_worker direct TRUNCATE');
select ok(not has_table_privilege('zeespare_simulation_worker','public.network_handoff_batches','SELECT'),'no zeespare_simulation_worker direct SELECT');
select ok(not has_function_privilege('zeespare_simulation_worker','public.network_handoff_batch_create(uuid,uuid[])','EXECUTE'),'no zeespare_simulation_worker network_handoff_batch_create');
select ok(not has_function_privilege('zeespare_simulation_worker','public.network_handoff_batch_preview(uuid,uuid[])','EXECUTE'),'no zeespare_simulation_worker network_handoff_batch_preview');
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('e220f000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object(
    'sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void
$$;
insert into auth.users(id,email) select pg_temp.id(n),'network-dates-'||n||'@test.local' from generate_series(10,12) n;
insert into public.organizations(id,slug,name) values
  (pg_temp.id(1),'network-batch-a','Network dates A'),(pg_temp.id(2),'network-batch-b','Network dates B');
insert into public.memberships(organization_id,user_id,role) values
  (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(2),pg_temp.id(11),'owner'),
  (pg_temp.id(1),pg_temp.id(12),'branch_user');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values
  (pg_temp.id(20),pg_temp.id(1),'SOURCE','Source','central','SA','Asia/Riyadh'),
  (pg_temp.id(21),pg_temp.id(1),'BRANCH','Branch','branch','SA','Asia/Riyadh');
insert into public.network_allocation_scenarios(id,organization_id,source_location_id,required_location_ids,request_id,submitted_by,report)
values(pg_temp.id(30),pg_temp.id(1),pg_temp.id(20),array[pg_temp.id(20),pg_temp.id(21)],pg_temp.id(31),pg_temp.id(10),
  '{"method":"network-allocation-v1","status":"available"}');
insert into public.network_date_scenarios(id,organization_id,allocation_id,source_location_id,required_location_ids,request_id,submitted_by,report)
values(pg_temp.id(35),pg_temp.id(1),pg_temp.id(30),pg_temp.id(20),array[pg_temp.id(20),pg_temp.id(21)],pg_temp.id(36),pg_temp.id(10),
  '{"method":"network-dates-v1","status":"available","lines":[]}');
insert into public.network_freight_estimates(id,organization_id,scenario_id,source_location_id,required_location_ids,request_id,submitted_by,report)
values(pg_temp.id(40),pg_temp.id(1),pg_temp.id(35),pg_temp.id(20),array[pg_temp.id(20),pg_temp.id(21)],pg_temp.id(41),pg_temp.id(10),
  '{"method":"network-freight-v1","status":"available","lines":[]}');

insert into public.network_transfer_proposals(id,organization_id,estimate_id,allocation_id,source_location_id,
required_location_ids,revision,request_id,submitted_by,reason)
values(pg_temp.id(50),pg_temp.id(1),pg_temp.id(40),pg_temp.id(30),pg_temp.id(20),
array[pg_temp.id(20),pg_temp.id(21)],1,pg_temp.id(51),pg_temp.id(10),'Synthetic proposal');
insert into public.network_transfer_handoffs(id,organization_id,proposal_id,source_location_id,required_location_ids,created_by,payload)
values(pg_temp.id(60),pg_temp.id(1),pg_temp.id(50),pg_temp.id(20),array[pg_temp.id(20),pg_temp.id(21)],pg_temp.id(10),
'{"schema_version":"network-transfer-handoff-v1","purpose":"planning_only","estimate":{"lines":[]}}');

insert into public.network_handoff_batches(id,organization_id,source_location_id,required_location_ids,handoff_ids,created_by,payload)
values(pg_temp.id(70),pg_temp.id(1),pg_temp.id(20),array[pg_temp.id(20),pg_temp.id(21)],array[pg_temp.id(60)],pg_temp.id(10),
'{"schema_version":"network-handoff-batch-v1","purpose":"planning_only","summary":{"source_code":"SOURCE","dispatch_date":"2026-10-12","branch_row_count":1,"totals":[]},"lines":[]}');
select pg_temp.login(10,1);
set local role authenticated;
select is((select count(*) from public.network_handoff_batches),1::bigint,'owner reads own package');
select is(public.network_handoff_batch_create(pg_temp.id(1),array[pg_temp.id(60)]),pg_temp.id(70),'authorized retry keeps copied batch');
select throws_ok($$update public.network_handoff_batches set payload='{}'$$,'42501',null,'member cannot change copy');
reset role;
select pg_temp.login(11,2);
set local role authenticated;
select is((select count(*) from public.network_handoff_batches),0::bigint,'foreign tenant cannot read');
select is((select count(*) from public.network_handoff_batch_list),0::bigint,'foreign tenant cannot discover');
select is((select count(*) from public.network_handoff_batch_candidates),0::bigint,'foreign tenant cannot see candidates');
select throws_ok($$select public.network_handoff_batch_create(pg_temp.id(1),array[pg_temp.id(60)])$$,'MQ403',null,'foreign org save denied');
select throws_ok($$select public.network_handoff_batch_create(pg_temp.id(2),array[pg_temp.id(60)])$$,'MQ404',null,'foreign handoff hidden');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
select pg_temp.login(12,1);
set local role authenticated;
select is((select count(*) from public.network_handoff_batches),0::bigint,'missing branch hides complete package');
select is((select count(*) from public.network_handoff_batch_list),0::bigint,'missing branch hides list and overlap');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));
set local role authenticated;
select is((select count(*) from public.network_handoff_batches),1::bigint,'all locations allow copied evidence');
select is((select count(*) from public.network_handoff_batch_list),1::bigint,'all locations allow history');
select throws_ok($$select public.network_handoff_batch_create(pg_temp.id(1),array[pg_temp.id(60)])$$,'MQ403',null,'reader cannot create or retry');
reset role;
delete from public.network_freight_estimates where id=pg_temp.id(40);
set local role authenticated;
select is((select count(*) from public.network_handoff_batches),1::bigint,'parent deletion retains copied batch');
select is((select selection from public.network_handoff_batch_list where id=pg_temp.id(70)),'unavailable','missing live context is explicit');
reset role;
select pg_temp.login(10,1);
set local role authenticated;
select throws_ok($$select public.network_handoff_batch_create(pg_temp.id(1),array[pg_temp.id(60)])$$,'MQ404',null,'retry requires original visible handoff');
reset role;
delete from public.locations where id=pg_temp.id(21);
select is((select count(*) from public.network_handoff_batches where id=pg_temp.id(70)),0::bigint,'any participating location deletion removes batch');
select is((select count(*) from public.audit_log where record_id=pg_temp.id(70)),2::bigint,'insert and cascade are audited');
select * from finish();
rollback;
