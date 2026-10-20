begin;
select no_plan();
select ok(not has_table_privilege('authenticated','public.network_freight_estimates','INSERT'),'no direct insert');
select ok(not has_table_privilege('authenticated','public.network_freight_estimates','UPDATE'),'no direct update');
select ok(not has_table_privilege('authenticated','public.network_freight_estimates','DELETE'),'no direct delete');
select ok(not has_table_privilege('service_role','public.network_freight_estimates','SELECT'),'no API data access');
select ok(not has_table_privilege('maqdar_worker','public.network_freight_estimates','SELECT'),'no worker data access');
select ok(not has_function_privilege('anon','public.network_freight_preview(uuid,uuid,boolean)','EXECUTE'),'no anonymous preview');
select ok(not has_function_privilege('service_role','public.network_freight_save(uuid,uuid,boolean,uuid,text)','EXECUTE'),'no API save');
select ok(not has_function_privilege('maqdar_worker','public.network_freight_save(uuid,uuid,boolean,uuid,text)','EXECUTE'),'no worker save');
select ok((select relrowsecurity from pg_class where oid='public.network_freight_estimates'::regclass),'RLS enabled');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.network_freight_list'::regclass),'list preserves RLS');

-- Minimal copied records isolate authorization from the scheduling integration fixtures.
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('e220c000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object(
    'sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void
$$;
insert into auth.users(id,email) select pg_temp.id(n),'network-dates-'||n||'@test.local' from generate_series(10,12) n;
insert into public.organizations(id,slug,name) values
  (pg_temp.id(1),'network-freight-a','Network dates A'),(pg_temp.id(2),'network-freight-b','Network dates B');
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

select pg_temp.login(10,1);
set local role authenticated;
select is((select count(*) from public.network_freight_estimates where id=pg_temp.id(40)),1::bigint,'own organization can read saved dates');
reset role;
select pg_temp.login(11,2);
set local role authenticated;
select is((select count(*) from public.network_freight_estimates where id=pg_temp.id(40)),0::bigint,'foreign owner cannot read saved dates');
select is((select count(*) from public.network_freight_list where id=pg_temp.id(40)),0::bigint,'foreign owner cannot discover saved dates in history');
select throws_ok($$select public.network_freight_preview(pg_temp.id(1),pg_temp.id(35),true)$$,
  'MQ404',null,'foreign owner cannot preview another organization');
select throws_ok($$select public.network_freight_preview(pg_temp.id(2),pg_temp.id(35),true)$$,
  'MQ404',null,'foreign allocation ID does not bypass organization scope');
select throws_ok($$select public.network_freight_save(pg_temp.id(1),pg_temp.id(35),true,pg_temp.id(42),repeat('a',64))$$,
  'MQ403',null,'foreign owner cannot save another organization');
select throws_ok($$insert into public.network_freight_estimates select * from public.network_freight_estimates where id=pg_temp.id(40)$$,
  '42501',null,'foreign direct insertion denied');
select throws_ok($$update public.network_freight_estimates set report='{}' where id=pg_temp.id(40)$$,
  '42501',null,'foreign direct update denied');
select throws_ok($$delete from public.network_freight_estimates where id=pg_temp.id(40)$$,
  '42501',null,'foreign direct deletion denied');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
select pg_temp.login(12,1);
set local role authenticated;
select is((select count(*) from public.network_freight_list where id=pg_temp.id(40)),0::bigint,'missing one branch hides the complete schedule');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));
set local role authenticated;
select is((select count(*) from public.network_freight_list where id=pg_temp.id(40)),1::bigint,'all participating locations reveal the saved schedule');
reset role;
select * from finish();
rollback;
