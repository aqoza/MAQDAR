begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void;
$$;
insert into auth.users(id,email) values(pg_temp.id(10),'regional-planner@test.local'),(pg_temp.id(11),'regional-branch@test.local'),(pg_temp.id(12),'regional-other@test.local');
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'regional-a','Regional A'),(pg_temp.id(2),'regional-b','Regional B');
insert into public.memberships(organization_id,user_id,role) values(pg_temp.id(1),pg_temp.id(10),'planner'),(pg_temp.id(1),pg_temp.id(11),'branch_user'),(pg_temp.id(2),pg_temp.id(12),'planner');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values
 (pg_temp.id(20),pg_temp.id(1),'L1','Location 1','branch','SA','Asia/Riyadh'),
 (pg_temp.id(21),pg_temp.id(1),'L2','Location 2','branch','SA','Asia/Riyadh');
insert into public.membership_locations(organization_id,user_id,location_id) values(pg_temp.id(1),pg_temp.id(11),pg_temp.id(20));
-- Saved preparation transport fixture. Real preparation and numerical work run in pytest.
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 values(pg_temp.id(30),pg_temp.id(1),pg_temp.id(20),pg_temp.id(31),'2026-10-01','2026-10-01','preparation','succeeded','{"method":"preparation-v1","history_complete":true}',now(),'{}');
insert into public.demand_preparations(id,organization_id,run_id,location_id,group_id,status,summary,evidence)
 values(pg_temp.id(40),pg_temp.id(1),pg_temp.id(30),pg_temp.id(20),pg_temp.id(50),'ready',
 '{"target_code":"SAVED","unit":"EA"}',jsonb_build_object('output',jsonb_build_object('contributors','[]'::jsonb,
 'daily','[{"date":"2026-10-01","sold":"2.246000","lost":"4.468000","calendar_verified":false,"holiday":null,"ramadan":null}]'::jsonb),
 'source',jsonb_build_object('items',jsonb_build_array(jsonb_build_object('item_id',pg_temp.id(50),'introduced_on',null,'discontinued_on',null)),
 'calendar','{"country":"SA","calendar_id":null,"weekend_days":[5,6],"active":true,"observe_public_holidays":true}'::jsonb)));
insert into public.demand_preparations(id,organization_id,run_id,location_id,group_id,status,summary,evidence)
 values(pg_temp.id(41),pg_temp.id(1),pg_temp.id(30),pg_temp.id(20),pg_temp.id(51),'blocked','{}','{}');
set local role authenticated;
select pg_temp.login(10,1);
select throws_ok($$select public.forecast_prepared_enqueue(pg_temp.id(1),pg_temp.id(40),pg_temp.id(60),7,false)$$,'MQ422',null,'fixed-group interpretation must be confirmed');
select throws_ok($$select public.forecast_prepared_enqueue(pg_temp.id(1),pg_temp.id(40),pg_temp.id(60),91,true)$$,'MQ422',null,'horizon is bounded');
select throws_ok($$select public.forecast_prepared_enqueue(pg_temp.id(1),pg_temp.id(41),pg_temp.id(60),7,true)$$,'MQ422',null,'blocked groups cannot be forecast');
select throws_ok($$select public.forecast_prepared_enqueue(pg_temp.id(1),gen_random_uuid(),pg_temp.id(60),7,true)$$,'MQ422',null,'missing groups cannot be forecast');
select throws_ok($$select public.forecast_prepared_enqueue(pg_temp.id(2),pg_temp.id(40),pg_temp.id(60),7,true)$$,'MQ403',null,'foreign organization is rejected');
select lives_ok($$select public.forecast_prepared_enqueue(pg_temp.id(1),pg_temp.id(40),pg_temp.id(60),7,true)$$,'planner queues saved group without live catalog identity');
select is(public.forecast_prepared_enqueue(pg_temp.id(1),pg_temp.id(40),pg_temp.id(60),7,true),(select id from public.planning_runs where kind='forecast'),'same request replays idempotently');
select throws_ok($$select public.forecast_prepared_enqueue(pg_temp.id(1),pg_temp.id(40),pg_temp.id(60),8,true)$$,'MQ409',null,'changed horizon conflicts with request replay');
select pg_temp.login(11,1);
select throws_ok($$select public.forecast_prepared_enqueue(pg_temp.id(1),pg_temp.id(40),pg_temp.id(61),7,true)$$,'MQ403',null,'branch reader cannot enqueue');
select pg_temp.login(12,2);
select throws_ok($$select public.forecast_prepared_enqueue(pg_temp.id(2),pg_temp.id(40),pg_temp.id(61),7,true)$$,'MQ422',null,'foreign saved identity is not exposed');
reset role;
create temp table claimed as select * from app.planning_claim();
select ok((select expires_at>clock_timestamp()+interval '890 seconds' from planning.leases),'regional fit receives bounded 900-second lease');
create temp table snapshot as select app.planning_task(run_id,lease_token) payload from claimed;
select is((select payload->>'method' from snapshot),'regional-v1','dispatcher selects prepared forecast');
select is((select payload->'items'->0->'demand' from snapshot),'[["2026-10-01","2.246000","4.468000"]]'::jsonb,'saved converted sold/lost demand remains exact');
select is((select payload->'items'->0->'preparation'->>'comparison' from snapshot),'fixed-group-v1','comparison interpretation persisted');
select is((select app.planning_task(run_id,lease_token) from claimed),(select payload from snapshot),'capture is immutable on replay');
create temp table output as select jsonb_build_array(jsonb_build_object('item_id',pg_temp.id(50),'status','insufficient','model',null,'total',null,
 'forecast','[]'::jsonb,'scores','[]'::jsonb,'folds','[]'::jsonb,'uncertainty','{"status":"unavailable","bands":[]}'::jsonb,
 'evaluation','{"status":"unavailable"}'::jsonb,'unavailable_models','[]'::jsonb,'comparison','fixed-group-v1','calendar_model',null,'future_calendar','[]'::jsonb)) rows;
grant select on claimed,output to zeespare_worker;
grant usage on schema extensions to zeespare_worker;
set local role zeespare_worker;
select throws_ok($$select app.forecast_task_individual(gen_random_uuid(),gen_random_uuid())$$,'42501',null,'worker cannot bypass task wrapper');
select throws_ok($$select app.forecast_finish_individual(gen_random_uuid(),gen_random_uuid(),'[]')$$,'42501',null,'worker cannot bypass publication wrapper');
select throws_ok($$select * from planning.forecast_inputs$$,'42501',null,'worker cannot read raw inputs');
select throws_ok($$select * from public.forecast_results$$,'42501',null,'worker cannot read tenant results');
select is(app.forecast_finish((select run_id from claimed),gen_random_uuid(),(select rows from output)),false,'wrong token rejected');
select throws_ok($$select app.forecast_finish((select run_id from claimed),(select lease_token from claimed),jsonb_set((select rows from output),'{0,comparison}','"other"'))$$,'MQ422',null,'comparison evidence required');
select is(app.forecast_finish((select run_id from claimed),(select lease_token from claimed),(select rows from output)),true,'worker publishes captured group');
select is(app.forecast_finish((select run_id from claimed),(select lease_token from claimed),(select rows from output)),false,'duplicate publication fenced');
reset role;
select is((select count(*) from planning.forecast_inputs),0::bigint,'success clears staging');
select is((select count(*) from pgmq.q_planning),0::bigint,'success archives message');
-- Second location demonstrates that reuse of the existing forecast table keeps branch isolation.
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 values(pg_temp.id(70),pg_temp.id(1),pg_temp.id(21),pg_temp.id(71),'2026-10-01','2026-10-01','forecast','succeeded','{"method":"regional-v1"}',now(),'{}');
insert into public.forecast_results(organization_id,run_id,location_id,item_id,item_code,item_name,status,summary,evidence)
 values(pg_temp.id(1),pg_temp.id(70),pg_temp.id(21),pg_temp.id(50),'SAVED','Saved','insufficient','{}','{}');
set local role authenticated;
select pg_temp.login(10,1);
select is((select count(*) from public.forecast_results),2::bigint,'planner reads both tenant locations');
select throws_ok($$insert into public.forecast_results default values$$,'42501',null,'planner cannot forge result');
select throws_ok($$update public.forecast_results set evidence='{}'$$,'42501',null,'planner cannot mutate saved evidence');
select throws_ok($$delete from public.forecast_results$$,'42501',null,'planner cannot erase results');
select pg_temp.login(11,1);
select is((select count(*) from public.forecast_results),1::bigint,'branch sees only assigned location');
select pg_temp.login(12,2);
select is((select count(*) from public.forecast_results),0::bigint,'foreign tenant sees no prepared forecasts');
reset role;
select * from finish();
rollback;
