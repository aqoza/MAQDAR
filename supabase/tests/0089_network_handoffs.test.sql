begin;
select no_plan();
select ok(not has_table_privilege('anon','public.network_transfer_handoffs','INSERT'),'no anon direct INSERT');
select ok(not has_table_privilege('anon','public.network_transfer_handoffs','UPDATE'),'no anon direct UPDATE');
select ok(not has_table_privilege('anon','public.network_transfer_handoffs','DELETE'),'no anon direct DELETE');
select ok(not has_table_privilege('anon','public.network_transfer_handoffs','SELECT'),'no anon direct SELECT');
select ok(not has_function_privilege('anon','public.network_handoff_create(uuid,uuid)','EXECUTE'),'no anon create');
select ok(not has_table_privilege('authenticated','public.network_transfer_handoffs','INSERT'),'no authenticated direct INSERT');
select ok(not has_table_privilege('authenticated','public.network_transfer_handoffs','UPDATE'),'no authenticated direct UPDATE');
select ok(not has_table_privilege('authenticated','public.network_transfer_handoffs','DELETE'),'no authenticated direct DELETE');
select ok(not has_table_privilege('service_role','public.network_transfer_handoffs','INSERT'),'no service_role direct INSERT');
select ok(not has_table_privilege('service_role','public.network_transfer_handoffs','UPDATE'),'no service_role direct UPDATE');
select ok(not has_table_privilege('service_role','public.network_transfer_handoffs','DELETE'),'no service_role direct DELETE');
select ok(not has_table_privilege('service_role','public.network_transfer_handoffs','SELECT'),'no service_role direct SELECT');
select ok(not has_function_privilege('service_role','public.network_handoff_create(uuid,uuid)','EXECUTE'),'no service_role create');
select ok(not has_table_privilege('zeespare_worker','public.network_transfer_handoffs','INSERT'),'no zeespare_worker direct INSERT');
select ok(not has_table_privilege('zeespare_worker','public.network_transfer_handoffs','UPDATE'),'no zeespare_worker direct UPDATE');
select ok(not has_table_privilege('zeespare_worker','public.network_transfer_handoffs','DELETE'),'no zeespare_worker direct DELETE');
select ok(not has_table_privilege('zeespare_worker','public.network_transfer_handoffs','SELECT'),'no zeespare_worker direct SELECT');
select ok(not has_function_privilege('zeespare_worker','public.network_handoff_create(uuid,uuid)','EXECUTE'),'no zeespare_worker create');
select ok(not has_table_privilege('zeespare_simulation_worker','public.network_transfer_handoffs','INSERT'),'no zeespare_simulation_worker direct INSERT');
select ok(not has_table_privilege('zeespare_simulation_worker','public.network_transfer_handoffs','UPDATE'),'no zeespare_simulation_worker direct UPDATE');
select ok(not has_table_privilege('zeespare_simulation_worker','public.network_transfer_handoffs','DELETE'),'no zeespare_simulation_worker direct DELETE');
select ok(not has_table_privilege('zeespare_simulation_worker','public.network_transfer_handoffs','SELECT'),'no zeespare_simulation_worker direct SELECT');
select ok(not has_function_privilege('zeespare_simulation_worker','public.network_handoff_create(uuid,uuid)','EXECUTE'),'no zeespare_simulation_worker create');
select ok((select relrowsecurity from pg_class where oid='public.network_transfer_handoffs'::regclass),'RLS enabled');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.network_handoff_list'::regclass),'history preserves RLS');
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('e220e000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object(
    'sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void
$$;
insert into auth.users(id,email) select pg_temp.id(n),'network-dates-'||n||'@test.local' from generate_series(10,12) n;
insert into public.organizations(id,slug,name) values
  (pg_temp.id(1),'network-handoff-a','Network dates A'),(pg_temp.id(2),'network-handoff-b','Network dates B');
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
select pg_temp.login(10,1);
set local role authenticated;
select is((select count(*) from public.network_transfer_handoffs),1::bigint,'owner reads own handoff');
select is(public.network_handoff_create(pg_temp.id(1),pg_temp.id(50)),pg_temp.id(60),'authorized retry returns original');
select throws_ok($$update public.network_transfer_handoffs set payload='{}'$$,'42501',null,'immutable by member');
reset role;
select pg_temp.login(11,2);
set local role authenticated;
select is((select count(*) from public.network_transfer_handoffs),0::bigint,'foreign tenant cannot read');
select is((select count(*) from public.network_handoff_list),0::bigint,'foreign tenant cannot discover');
select throws_ok($$select public.network_handoff_create(pg_temp.id(1),pg_temp.id(50))$$,'MQ403',null,'foreign org write denied');
select throws_ok($$select public.network_handoff_create(pg_temp.id(2),pg_temp.id(50))$$,'MQ404',null,'foreign proposal hidden');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
select pg_temp.login(12,1);
set local role authenticated;
select is((select count(*) from public.network_transfer_handoffs),0::bigint,'missing branch hides payload');
select is((select count(*) from public.network_handoff_list),0::bigint,'missing branch hides history');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));
set local role authenticated;
select is((select count(*) from public.network_transfer_handoffs),1::bigint,'all locations allow payload');
select is((select count(*) from public.network_handoff_list),1::bigint,'all locations allow history');
select throws_ok($$select public.network_handoff_create(pg_temp.id(1),pg_temp.id(50))$$,'MQ403',null,'reader cannot create or retry');
reset role;
delete from public.network_freight_estimates where id=pg_temp.id(40);
select is((select count(*) from public.network_transfer_handoffs where id=pg_temp.id(60)),0::bigint,'parent cascades handoff');
select is((select count(*) from public.audit_log where record_id=pg_temp.id(60)),2::bigint,'insert and deletion audited');
select * from finish();
rollback;
