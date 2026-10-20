begin;
select no_plan();
select ok(not has_table_privilege('anon','public.network_transfer_proposals','INSERT'),'no anon direct INSERT');
select ok(not has_table_privilege('anon','public.network_transfer_proposals','UPDATE'),'no anon direct UPDATE');
select ok(not has_table_privilege('anon','public.network_transfer_proposals','DELETE'),'no anon direct DELETE');
select ok(not has_table_privilege('anon','public.network_transfer_proposals','SELECT'),'no anon data access');
select ok(not has_function_privilege('anon','public.network_transfer_submit(uuid,uuid,uuid,text)','EXECUTE'),'no anon submit');
select ok(not has_function_privilege('anon','public.network_transfer_decide(uuid,uuid,uuid,text,text)','EXECUTE'),'no anon decision');
select ok(not has_table_privilege('authenticated','public.network_transfer_proposals','INSERT'),'no authenticated direct INSERT');
select ok(not has_table_privilege('authenticated','public.network_transfer_proposals','UPDATE'),'no authenticated direct UPDATE');
select ok(not has_table_privilege('authenticated','public.network_transfer_proposals','DELETE'),'no authenticated direct DELETE');
select ok(not has_table_privilege('service_role','public.network_transfer_proposals','INSERT'),'no service_role direct INSERT');
select ok(not has_table_privilege('service_role','public.network_transfer_proposals','UPDATE'),'no service_role direct UPDATE');
select ok(not has_table_privilege('service_role','public.network_transfer_proposals','DELETE'),'no service_role direct DELETE');
select ok(not has_table_privilege('service_role','public.network_transfer_proposals','SELECT'),'no service_role data access');
select ok(not has_function_privilege('service_role','public.network_transfer_submit(uuid,uuid,uuid,text)','EXECUTE'),'no service_role submit');
select ok(not has_function_privilege('service_role','public.network_transfer_decide(uuid,uuid,uuid,text,text)','EXECUTE'),'no service_role decision');
select ok(not has_table_privilege('maqdar_worker','public.network_transfer_proposals','INSERT'),'no maqdar_worker direct INSERT');
select ok(not has_table_privilege('maqdar_worker','public.network_transfer_proposals','UPDATE'),'no maqdar_worker direct UPDATE');
select ok(not has_table_privilege('maqdar_worker','public.network_transfer_proposals','DELETE'),'no maqdar_worker direct DELETE');
select ok(not has_table_privilege('maqdar_worker','public.network_transfer_proposals','SELECT'),'no maqdar_worker data access');
select ok(not has_function_privilege('maqdar_worker','public.network_transfer_submit(uuid,uuid,uuid,text)','EXECUTE'),'no maqdar_worker submit');
select ok(not has_function_privilege('maqdar_worker','public.network_transfer_decide(uuid,uuid,uuid,text,text)','EXECUTE'),'no maqdar_worker decision');
select ok(not has_table_privilege('maqdar_simulation_worker','public.network_transfer_proposals','INSERT'),'no maqdar_simulation_worker direct INSERT');
select ok(not has_table_privilege('maqdar_simulation_worker','public.network_transfer_proposals','UPDATE'),'no maqdar_simulation_worker direct UPDATE');
select ok(not has_table_privilege('maqdar_simulation_worker','public.network_transfer_proposals','DELETE'),'no maqdar_simulation_worker direct DELETE');
select ok(not has_table_privilege('maqdar_simulation_worker','public.network_transfer_proposals','SELECT'),'no maqdar_simulation_worker data access');
select ok(not has_function_privilege('maqdar_simulation_worker','public.network_transfer_submit(uuid,uuid,uuid,text)','EXECUTE'),'no maqdar_simulation_worker submit');
select ok(not has_function_privilege('maqdar_simulation_worker','public.network_transfer_decide(uuid,uuid,uuid,text,text)','EXECUTE'),'no maqdar_simulation_worker decision');
select ok((select relrowsecurity from pg_class where oid='public.network_transfer_proposals'::regclass),'RLS enabled');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.network_review_list'::regclass),'history preserves RLS');
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('e220d000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object(
    'sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void
$$;
insert into auth.users(id,email) select pg_temp.id(n),'network-dates-'||n||'@test.local' from generate_series(10,12) n;
insert into public.organizations(id,slug,name) values
  (pg_temp.id(1),'network-review-a','Network dates A'),(pg_temp.id(2),'network-review-b','Network dates B');
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
select pg_temp.login(10,1);
set local role authenticated;
select is((select count(*) from public.network_transfer_proposals),1::bigint,'owner reads own proposal');
reset role;
select pg_temp.login(11,2);
set local role authenticated;
select is((select count(*) from public.network_transfer_proposals),0::bigint,'foreign owner cannot read');
select is((select count(*) from public.network_review_list),0::bigint,'foreign owner cannot discover history/counts');
select throws_ok($$select public.network_transfer_submit(pg_temp.id(1),pg_temp.id(40),pg_temp.id(52),'Reason')$$,'MQ403',null,'foreign submit denied');
select throws_ok($$select public.network_transfer_submit(pg_temp.id(2),pg_temp.id(40),pg_temp.id(52),'Reason')$$,'MQ404',null,'foreign estimate hidden');
select throws_ok($$select public.network_transfer_decide(pg_temp.id(2),pg_temp.id(50),pg_temp.id(52),'approved','Reason')$$,'MQ404',null,'foreign proposal hidden');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
select pg_temp.login(12,1);
set local role authenticated;
select is((select count(*) from public.network_review_list),0::bigint,'missing branch hides complete proposal');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));
set local role authenticated;
select is((select count(*) from public.network_review_list),1::bigint,'every location reveals history');
select throws_ok($$select public.network_transfer_submit(pg_temp.id(1),pg_temp.id(40),pg_temp.id(52),'Reason')$$,'MQ403',null,'branch reader cannot submit');
select throws_ok($$select public.network_transfer_decide(pg_temp.id(1),pg_temp.id(50),pg_temp.id(52),'approved','Reason')$$,'MQ403',null,'branch reader cannot approve');
select throws_ok($$select public.network_transfer_decide(pg_temp.id(1),pg_temp.id(50),pg_temp.id(52),'withdrawn','Reason')$$,'MQ403',null,'non-author cannot withdraw');
reset role;
select * from finish();
rollback;
