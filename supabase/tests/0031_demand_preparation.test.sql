begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('90000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void;
$$;
insert into auth.users(id,email) values(pg_temp.id(10),'preparation-planner@test.local'),(pg_temp.id(11),'preparation-branch@test.local'),(pg_temp.id(12),'preparation-other@test.local');
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'preparation-a','Preparation A'),(pg_temp.id(2),'preparation-b','Preparation B');
insert into public.memberships(organization_id,user_id,role) values(pg_temp.id(1),pg_temp.id(10),'planner'),(pg_temp.id(1),pg_temp.id(11),'branch_user'),(pg_temp.id(2),pg_temp.id(12),'planner');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values
 (pg_temp.id(20),pg_temp.id(1),'L1','Location 1','branch','SA','Asia/Riyadh'),
 (pg_temp.id(21),pg_temp.id(1),'L2','Location 2','branch','SA','Asia/Riyadh'),
 (pg_temp.id(22),pg_temp.id(2),'OTHER','Other','branch','SA','Asia/Riyadh');
insert into public.membership_locations(organization_id,user_id,location_id) values(pg_temp.id(1),pg_temp.id(11),pg_temp.id(20));
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency,introduced_on,discontinued_on) values
 (pg_temp.id(30),pg_temp.id(1),'I1','Item 1','test','EA',1.123,'SAR','2026-10-02','2026-10-03'),
 (pg_temp.id(31),pg_temp.id(1),'I2','Item 2','test','EA',2,'SAR',null,null),
 (pg_temp.id(32),pg_temp.id(2),'OTHER','Other','test','EA',3,'SAR',null,null);
insert into public.demand_history(organization_id,item_id,location_id,demand_date,quantity,lost_sales_quantity) values
 (pg_temp.id(1),pg_temp.id(30),pg_temp.id(20),'2026-10-01',999,0),
 (pg_temp.id(1),pg_temp.id(30),pg_temp.id(20),'2026-10-02',2.123,3.456),
 (pg_temp.id(1),pg_temp.id(30),pg_temp.id(20),'2026-10-04',999,0),
 (pg_temp.id(1),pg_temp.id(30),pg_temp.id(21),'2026-10-02',999,0),
 (pg_temp.id(2),pg_temp.id(32),pg_temp.id(22),'2026-10-02',999,0);

set local role authenticated;
select pg_temp.login(10,1);
select throws_ok($$select public.preparation_enqueue(pg_temp.id(1),'L1','9999-01-01','9999-01-02',pg_temp.id(40),true,array['I1'])$$,'MQ422',null,'future days cannot be confirmed as history');
select throws_ok($$select public.preparation_enqueue(pg_temp.id(1),'L1','2026-07-01','2026-10-04',pg_temp.id(40),false,array['I1'])$$,'MQ422',null,'history confirmation is mandatory');
select throws_ok($$select public.preparation_enqueue(pg_temp.id(1),'L1','2026-07-01','2026-10-04',pg_temp.id(40),true,array['I1','I1'])$$,'MQ422',null,'duplicates are rejected');
select throws_ok($$select public.preparation_enqueue(pg_temp.id(1),'L1','2026-07-01','2026-10-04',pg_temp.id(40),true,array['OTHER'])$$,'MQ422',null,'item selection stays within tenant');
select throws_ok($$select public.preparation_enqueue(pg_temp.id(2),'OTHER','2026-07-01','2026-10-04',pg_temp.id(40),true,array['OTHER'])$$,'MQ403',null,'cross tenant enqueue denied');
select throws_ok($$select public.preparation_enqueue(pg_temp.id(1),'L1','2026-07-01','2026-10-04',pg_temp.id(40),true,array_fill('I1'::text,array[26]))$$,'MQ422',null,'selection capped at 25');
select lives_ok($$select public.preparation_enqueue(pg_temp.id(1),'L1','2026-07-01','2026-10-04',pg_temp.id(40),true,array['I2','I1'])$$,'planner queues preparation');
select is(public.preparation_enqueue(pg_temp.id(1),'L1','2026-07-01','2026-10-04',pg_temp.id(40),true,array['I1','I2']),(select id from public.planning_runs),'reordered codes replay idempotently');
select throws_ok($$select public.planning_enqueue(pg_temp.id(1),'L1','2026-07-01','2026-10-04',pg_temp.id(40))$$,'MQ409',null,'kind participates in idempotency');
select throws_ok($$select app.preparation_task(gen_random_uuid(),gen_random_uuid())$$,'42501',null,'members cannot access input snapshots');
select pg_temp.login(11,1);
select throws_ok($$select public.preparation_enqueue(pg_temp.id(1),'L1','2026-07-01','2026-10-04',pg_temp.id(41),true,array['I1'])$$,'MQ403',null,'branch user cannot queue preparation');
reset role;
create temp table claimed as select * from app.planning_claim();
create temp table snapshot as select app.planning_task(run_id,lease_token) as payload from claimed;
select is((select payload->>'kind' from snapshot),'preparation','worker dispatch returns preparation task');
select is((select jsonb_array_length(payload->'items') from snapshot),2,'capture includes only selected tenant items');
select is((select payload->'items'->0->>'introduced_on' from snapshot),'2026-10-02','capture respects introduction');
select is((select payload->'items'->0->>'discontinued_on' from snapshot),'2026-10-03','capture respects discontinuation');
select is((select payload->'items'->0->'demand' from snapshot),'[["2026-10-01","999.000","0.000"],["2026-10-02","2.123","3.456"],["2026-10-04","999.000","0.000"]]'::jsonb,'capture retains raw lifecycle evidence and keeps location/tenant separate');
select throws_ok($$select app.planning_execute(run_id,lease_token) from claimed$$,'MQ422',null,'old readiness worker cannot publish preparation');
-- Transport fixture; numerical results and contribution integrity are verified in Python.
create temp table output as select jsonb_agg(jsonb_build_object('group_id',i->>'item_id','source_ids',jsonb_build_array(i->>'item_id'),'status','blocked','daily','[]'::jsonb,'contributors','[]'::jsonb,'target_code',null,'unit',null,'sold',null,'lost',null,'issue','conflicting_conversion')) as rows from snapshot,jsonb_array_elements(payload->'items') i;
grant select on claimed,output to zeespare_worker;
grant usage on schema extensions to zeespare_worker;
set local role zeespare_worker;
select throws_ok($$select * from planning.preparation_inputs$$,'42501',null,'worker cannot read raw snapshots');
select throws_ok($$select * from public.demand_preparations$$,'42501',null,'worker cannot read raw results');
select throws_ok($$select app.preparation_task(gen_random_uuid(),gen_random_uuid())$$,'42501',null,'worker uses guarded task dispatcher');
select throws_ok($$select app.planning_task_classification(gen_random_uuid(),gen_random_uuid())$$,'42501',null,'worker cannot bypass dispatcher');
select is(app.preparation_finish((select run_id from claimed),gen_random_uuid(),(select rows from output)),false,'wrong token cannot publish');
select is(app.preparation_finish((select run_id from claimed),(select lease_token from claimed),(select rows from output)),true,'worker publishes atomically');
select is(app.preparation_finish((select run_id from claimed),(select lease_token from claimed),(select rows from output)),false,'publication replay fenced');
reset role;
select is((select count(*) from planning.preparation_inputs),0::bigint,'success cleans private staging');
select is((select count(*) from pgmq.q_planning),0::bigint,'success archives queue message');
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 values(pg_temp.id(50),pg_temp.id(1),pg_temp.id(21),pg_temp.id(51),'2026-07-01','2026-10-04','preparation','succeeded','{}',now(),'{}');
insert into public.demand_preparations(organization_id,run_id,location_id,group_id,status,summary,evidence)
 values(pg_temp.id(1),pg_temp.id(50),pg_temp.id(21),pg_temp.id(30),'blocked','{}','{}');
set local role authenticated;
select pg_temp.login(10,1);
select is((select count(*) from public.demand_preparations),3::bigint,'planner sees tenant results');
select throws_ok($$insert into public.demand_preparations default values$$,'42501',null,'planner cannot forge results');
select throws_ok($$update public.demand_preparations set status='ready'$$,'42501',null,'planner cannot change evidence');
select throws_ok($$delete from public.demand_preparations$$,'42501',null,'planner cannot erase history');
select pg_temp.login(11,1);
select is((select count(*) from public.demand_preparations),2::bigint,'branch sees assigned location only');
select pg_temp.login(12,2);
select is((select count(*) from public.demand_preparations),0::bigint,'other tenant sees no results');
reset role;
select ok(not has_function_privilege('service_role','app.preparation_finish(uuid,uuid,jsonb)','EXECUTE'),'service role cannot publish');
select ok(not has_table_privilege('authenticated','planning.preparation_inputs','SELECT'),'members cannot read private inputs');
select * from finish();
rollback;
