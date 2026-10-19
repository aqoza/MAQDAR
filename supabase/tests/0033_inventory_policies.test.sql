begin;
select no_plan();
select set_eq(
 $$select p.proname::text collate "default" from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='app' and p.prorettype<>'trigger'::regtype and has_function_privilege('maqdar_worker',p.oid,'EXECUTE')$$,
 $$values ('planning_claim'),('planning_task'),('planning_execute'),('classification_finish'),('forecast_finish'),('preparation_finish'),('policy_finish'),('simulation_finish'),('planning_fail')$$,
 'worker has exactly nine reviewed capabilities');
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('92000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void;
$$;
insert into auth.users(id,email) values(pg_temp.id(10),'policy-planner@test.local'),(pg_temp.id(11),'policy-branch@test.local'),(pg_temp.id(12),'policy-other@test.local');
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'policy-a','Policy A'),(pg_temp.id(2),'policy-b','Policy B');
insert into public.memberships(organization_id,user_id,role) values(pg_temp.id(1),pg_temp.id(10),'planner'),(pg_temp.id(1),pg_temp.id(11),'branch_user'),(pg_temp.id(2),pg_temp.id(12),'planner');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values
 (pg_temp.id(20),pg_temp.id(1),'L1','Location 1','branch','SA','Asia/Riyadh'),
 (pg_temp.id(21),pg_temp.id(1),'L2','Location 2','branch','SA','Asia/Riyadh');
insert into public.membership_locations(organization_id,user_id,location_id) values(pg_temp.id(1),pg_temp.id(11),pg_temp.id(20));
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 values(pg_temp.id(30),pg_temp.id(1),pg_temp.id(20),pg_temp.id(31),'2026-07-01','2026-10-01','forecast','succeeded','{"method":"baseline-v1","horizon":7}',now(),'{}');
insert into public.forecast_results(id,organization_id,run_id,location_id,item_id,item_code,item_name,status,model,summary,evidence)
 values(pg_temp.id(40),pg_temp.id(1),pg_temp.id(30),pg_temp.id(20),pg_temp.id(50),'SAVED','Saved','selected','mean','{}','{"source":{},"output":{"status":"selected","model":"mean"}}');
set local role authenticated;
select pg_temp.login(10,1);
select throws_ok($$select public.policy_enqueue(pg_temp.id(1),pg_temp.id(40),pg_temp.id(60),-1,7,.95)$$,'MQ422',null,'negative lead time rejected');
select throws_ok($$select public.policy_enqueue(pg_temp.id(1),pg_temp.id(40),pg_temp.id(60),3,0,.95)$$,'MQ422',null,'zero review rejected');
select throws_ok($$select public.policy_enqueue(pg_temp.id(1),pg_temp.id(40),pg_temp.id(60),3,4,'NaN')$$,'MQ422',null,'NaN service rejected');
select throws_ok($$select public.policy_enqueue(pg_temp.id(1),pg_temp.id(40),pg_temp.id(60),3,4,1)$$,'MQ422',null,'unsupported certainty rejected');
select throws_ok($$select public.policy_enqueue(pg_temp.id(1),pg_temp.id(40),pg_temp.id(60),3,7,.95)$$,'MQ422',null,'forecast must cover protection period');
select throws_ok($$select public.policy_enqueue(pg_temp.id(1),gen_random_uuid(),pg_temp.id(60),3,4,.95)$$,'MQ422',null,'missing source rejected');
select throws_ok($$select public.policy_enqueue(pg_temp.id(2),pg_temp.id(40),pg_temp.id(60),3,4,.95)$$,'MQ403',null,'foreign organization rejected');
select lives_ok($$select public.policy_enqueue(pg_temp.id(1),pg_temp.id(40),pg_temp.id(60),3,4,.95)$$,'editor queues a policy');
select is(public.policy_enqueue(pg_temp.id(1),pg_temp.id(40),pg_temp.id(60),3,4,.950),(select id from public.planning_runs where kind='policy'),'normalized service replays idempotently');
select throws_ok($$select public.policy_enqueue(pg_temp.id(1),pg_temp.id(40),pg_temp.id(60),3,4,.99)$$,'MQ409',null,'changed policy conflicts with request replay');
select pg_temp.login(11,1);
select throws_ok($$select public.policy_enqueue(pg_temp.id(1),pg_temp.id(40),pg_temp.id(61),3,4,.95)$$,'MQ403',null,'branch reader cannot queue');
select pg_temp.login(12,2);
select throws_ok($$select public.policy_enqueue(pg_temp.id(2),pg_temp.id(40),pg_temp.id(61),3,4,.95)$$,'MQ422',null,'foreign source hidden');
reset role;
select is((select count(*) from planning.policy_inputs),1::bigint,'source captured at enqueue');
create temp table claimed as select * from app.planning_claim();
select ok((select expires_at>clock_timestamp()+interval '890 seconds' from planning.leases),'policy gets 900-second lease');
select is((select app.planning_task(run_id,lease_token)->'forecast'->>'id' from claimed),pg_temp.id(40)::text,'source identity frozen');
create temp table output as select jsonb_build_array(jsonb_build_object('status','calibration_failed','lead_time',null,'protection',null,'calibration','[]'::jsonb,
 'residual_count',0,'positive_days',1,'samples',0,'seed',repeat('a',64),'method','iid-error-paths-v1')) rows;
grant select on claimed,output to maqdar_worker;
grant usage on schema extensions to maqdar_worker;
set local role maqdar_worker;
select throws_ok($$select * from planning.policy_inputs$$,'42501',null,'worker cannot read staging directly');
select throws_ok($$select * from public.inventory_policies$$,'42501',null,'worker cannot read results directly');
select throws_ok($$select app.policy_task(gen_random_uuid(),gen_random_uuid())$$,'42501',null,'worker cannot bypass dispatcher');
select is(app.policy_finish((select run_id from claimed),gen_random_uuid(),(select rows from output)),false,'wrong token rejected');
select throws_ok($$select app.policy_finish((select run_id from claimed),(select lease_token from claimed),'[]')$$,'MQ422',null,'empty output rejected');
select throws_ok($$select app.policy_finish((select run_id from claimed),(select lease_token from claimed),jsonb_set((select rows from output),'{0,lead_time}','{}'))$$,'MQ422',null,'unavailable policy cannot carry a threshold');
select is(app.policy_finish((select run_id from claimed),(select lease_token from claimed),(select rows from output)),true,'worker publishes recommendation status');
select is(app.policy_finish((select run_id from claimed),(select lease_token from claimed),(select rows from output)),false,'duplicate publication fenced');
reset role;
select is((select count(*) from planning.policy_inputs),0::bigint,'terminal state clears staging');
select is((select count(*) from pgmq.q_planning),0::bigint,'publication archives queue');
select ok(app.policy_period_valid('{"days":3,"forecast":"6.000","quantile":"7.000","target":"7.000","safety_stock":"1.000"}',3),'consistent periods accepted');
select ok(not app.policy_period_valid('{"days":3,"forecast":"6.000","quantile":"7.000","target":"7.000","safety_stock":"2.000"}',3),'inconsistent buffer rejected');
select ok(not app.policy_period_valid('{"days":3,"forecast":"NaN"}',3),'nonfinite period rejected');
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 values(pg_temp.id(70),pg_temp.id(1),pg_temp.id(21),pg_temp.id(71),'2026-07-01','2026-10-01','policy','succeeded','{}',now(),'{}');
insert into public.inventory_policies(organization_id,run_id,location_id,forecast_id,item_id,item_code,status,summary,evidence)
 values(pg_temp.id(1),pg_temp.id(70),pg_temp.id(21),pg_temp.id(40),pg_temp.id(50),'SAVED','calibration_failed','{}','{}');
set local role authenticated;
select pg_temp.login(10,1);
select is((select count(*) from public.inventory_policies),2::bigint,'planner reads tenant policies');
select throws_ok($$insert into public.inventory_policies default values$$,'42501',null,'editor cannot forge policy');
select throws_ok($$update public.inventory_policies set evidence='{}'$$,'42501',null,'editor cannot mutate evidence');
select throws_ok($$delete from public.inventory_policies$$,'42501',null,'editor cannot erase policy');
select is(public.policy_enqueue(pg_temp.id(1),pg_temp.id(40),pg_temp.id(60),3,4,.95),(select id from public.planning_runs where request_id=pg_temp.id(60)),'terminal request replay stays idempotent');
select pg_temp.login(11,1);
select is((select count(*) from public.inventory_policies),1::bigint,'branch restricted to assigned location');
select pg_temp.login(12,2);
select is((select count(*) from public.inventory_policies),0::bigint,'foreign tenant sees no policy');
reset role;
select is((select count(*) from planning.policy_inputs),0::bigint,'terminal replay does not recreate staging');
set local role authenticated;
select pg_temp.login(10,1);
select lives_ok($$select public.policy_enqueue(pg_temp.id(1),pg_temp.id(40),pg_temp.id(62),3,4,.95)$$,'second request queues');
reset role;
update public.planning_runs set attempts=3,status='running' where request_id=pg_temp.id(62);
select is((select count(*) from app.planning_claim()),0::bigint,'exhausted policy is not claimed again');
select is((select status from public.planning_runs where request_id=pg_temp.id(62)),'failed','exhausted policy fails terminally');
select is((select count(*) from planning.policy_inputs),0::bigint,'exhausted policy clears its input');
select * from finish();
rollback;
