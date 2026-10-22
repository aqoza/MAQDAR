begin;
select no_plan();
select ok((select relrowsecurity from pg_class where oid='public.regional_handoff_batches'::regclass),'batch RLS enabled');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.regional_handoff_batch_list'::regclass),'batch history preserves RLS');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.regional_handoff_batch_candidates'::regclass),'picker preserves RLS');
select ok(not has_table_privilege('anon','public.regional_handoff_batches','INSERT'),'no anon direct INSERT');
select ok(not has_table_privilege('anon','public.regional_handoff_batches','UPDATE'),'no anon direct UPDATE');
select ok(not has_table_privilege('anon','public.regional_handoff_batches','DELETE'),'no anon direct DELETE');
select ok(not has_table_privilege('anon','public.regional_handoff_batches','TRUNCATE'),'no anon direct TRUNCATE');
select ok(not has_table_privilege('anon','public.regional_handoff_batches','SELECT'),'no anon direct SELECT');
select ok(not has_function_privilege('anon','public.regional_handoff_batch_create(uuid,uuid[])','EXECUTE'),'no anon regional_handoff_batch_create');
select ok(not has_function_privilege('anon','public.regional_handoff_batch_preview(uuid,uuid[])','EXECUTE'),'no anon regional_handoff_batch_preview');
select ok(not has_table_privilege('authenticated','public.regional_handoff_batches','INSERT'),'no authenticated direct INSERT');
select ok(not has_table_privilege('authenticated','public.regional_handoff_batches','UPDATE'),'no authenticated direct UPDATE');
select ok(not has_table_privilege('authenticated','public.regional_handoff_batches','DELETE'),'no authenticated direct DELETE');
select ok(not has_table_privilege('authenticated','public.regional_handoff_batches','TRUNCATE'),'no authenticated direct TRUNCATE');
select ok(not has_table_privilege('service_role','public.regional_handoff_batches','INSERT'),'no service_role direct INSERT');
select ok(not has_table_privilege('service_role','public.regional_handoff_batches','UPDATE'),'no service_role direct UPDATE');
select ok(not has_table_privilege('service_role','public.regional_handoff_batches','DELETE'),'no service_role direct DELETE');
select ok(not has_table_privilege('service_role','public.regional_handoff_batches','TRUNCATE'),'no service_role direct TRUNCATE');
select ok(not has_table_privilege('service_role','public.regional_handoff_batches','SELECT'),'no service_role direct SELECT');
select ok(not has_function_privilege('service_role','public.regional_handoff_batch_create(uuid,uuid[])','EXECUTE'),'no service_role regional_handoff_batch_create');
select ok(not has_function_privilege('service_role','public.regional_handoff_batch_preview(uuid,uuid[])','EXECUTE'),'no service_role regional_handoff_batch_preview');
select ok(not has_table_privilege('maqdar_worker','public.regional_handoff_batches','INSERT'),'no maqdar_worker direct INSERT');
select ok(not has_table_privilege('maqdar_worker','public.regional_handoff_batches','UPDATE'),'no maqdar_worker direct UPDATE');
select ok(not has_table_privilege('maqdar_worker','public.regional_handoff_batches','DELETE'),'no maqdar_worker direct DELETE');
select ok(not has_table_privilege('maqdar_worker','public.regional_handoff_batches','TRUNCATE'),'no maqdar_worker direct TRUNCATE');
select ok(not has_table_privilege('maqdar_worker','public.regional_handoff_batches','SELECT'),'no maqdar_worker direct SELECT');
select ok(not has_function_privilege('maqdar_worker','public.regional_handoff_batch_create(uuid,uuid[])','EXECUTE'),'no maqdar_worker regional_handoff_batch_create');
select ok(not has_function_privilege('maqdar_worker','public.regional_handoff_batch_preview(uuid,uuid[])','EXECUTE'),'no maqdar_worker regional_handoff_batch_preview');
select ok(not has_table_privilege('maqdar_simulation_worker','public.regional_handoff_batches','INSERT'),'no maqdar_simulation_worker direct INSERT');
select ok(not has_table_privilege('maqdar_simulation_worker','public.regional_handoff_batches','UPDATE'),'no maqdar_simulation_worker direct UPDATE');
select ok(not has_table_privilege('maqdar_simulation_worker','public.regional_handoff_batches','DELETE'),'no maqdar_simulation_worker direct DELETE');
select ok(not has_table_privilege('maqdar_simulation_worker','public.regional_handoff_batches','TRUNCATE'),'no maqdar_simulation_worker direct TRUNCATE');
select ok(not has_table_privilege('maqdar_simulation_worker','public.regional_handoff_batches','SELECT'),'no maqdar_simulation_worker direct SELECT');
select ok(not has_function_privilege('maqdar_simulation_worker','public.regional_handoff_batch_create(uuid,uuid[])','EXECUTE'),'no maqdar_simulation_worker regional_handoff_batch_create');
select ok(not has_function_privilege('maqdar_simulation_worker','public.regional_handoff_batch_preview(uuid,uuid[])','EXECUTE'),'no maqdar_simulation_worker regional_handoff_batch_preview');
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('e250f000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.login(n integer) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated')::text,true)::void
$$;
insert into auth.users(id,email) select pg_temp.id(n),'regional-batch-'||n||'@test.local' from generate_series(10,12) n;
insert into public.organizations(id,slug,name) values
  (pg_temp.id(1),'regional-batch-a','Regional A'),(pg_temp.id(2),'regional-batch-b','Regional B');
insert into public.memberships(organization_id,user_id,role) values
  (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(2),pg_temp.id(11),'owner'),(pg_temp.id(1),pg_temp.id(12),'branch_user');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values
  (pg_temp.id(20),pg_temp.id(1),'DEST','Destination','branch','SA','Asia/Riyadh'),
  (pg_temp.id(21),pg_temp.id(1),'ZERO','Zero source','branch','SA','Asia/Riyadh');
insert into public.regional_handoff_batches(id,organization_id,destination_location_id,required_location_ids,handoff_ids,created_by,payload)
values(pg_temp.id(70),pg_temp.id(1),pg_temp.id(20),array[pg_temp.id(20),pg_temp.id(21)],array[pg_temp.id(60)],pg_temp.id(10),
'{"schema_version":"regional-handoff-batch-v1","purpose":"planning_only","summary":{"destination_code":"DEST","requested_date":"2026-10-10","source_row_count":1,"totals":[]},"lines":[]}');
select pg_temp.login(10);
set local role authenticated;
select is((select count(*) from public.regional_handoff_batches),1::bigint,'owner reads own retained package');
select throws_ok($$update public.regional_handoff_batches set payload='{}'$$,'42501',null,'owner cannot rewrite evidence');
reset role;
select pg_temp.login(11);
set local role authenticated;
select is((select count(*) from public.regional_handoff_batches),0::bigint,'foreign tenant cannot read packages');
select is((select count(*) from public.regional_handoff_batch_list),0::bigint,'foreign tenant cannot discover packages or overlap');
select throws_ok($$select public.regional_handoff_batch_create(pg_temp.id(1),array[pg_temp.id(60)])$$,'MQ403',null,'foreign tenant cannot create');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
select pg_temp.login(12);
set local role authenticated;
select is((select count(*) from public.regional_handoff_batches),0::bigint,'missing zero-source access hides entire batch');
select is((select count(*) from public.regional_handoff_batch_list),0::bigint,'missing zero-source access hides history');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));
set local role authenticated;
select is((select count(*) from public.regional_handoff_batches),1::bigint,'all locations permit retained package reads');
select is((select selection from public.regional_handoff_batch_list),'unavailable','missing original context remains explicit');
select throws_ok($$select public.regional_handoff_batch_create(pg_temp.id(1),array[pg_temp.id(60)])$$,'MQ403',null,'readers cannot create or retry');
reset role;
delete from public.locations where id=pg_temp.id(21);
select is((select count(*) from public.regional_handoff_batches),0::bigint,'zero-source location deletion cascades retained batch');
select is((select count(*) from public.audit_log where record_id=pg_temp.id(70)),2::bigint,'insert and cascade audited');
select * from finish();
rollback;
