begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('80000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void;
$$;
create function pg_temp.opts() returns jsonb language sql immutable as $$select '{"adi":"1.32","cv2":"0.49","abc_a":"0.8","abc_b":"0.95","xyz_x":"0.5","xyz_y":"1"}'::jsonb$$;
insert into auth.users(id,email) values(pg_temp.id(10),'class-planner@test.local'),(pg_temp.id(11),'class-branch@test.local'),(pg_temp.id(12),'class-other@test.local');
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'class-a','Class A'),(pg_temp.id(2),'class-b','Class B');
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
select throws_ok($$select public.classification_enqueue(pg_temp.id(1),'L1','2026-10-01','2026-10-04',pg_temp.id(40),false,pg_temp.opts())$$,'MQ422',null,'confirmation is mandatory in SQL');
select throws_ok($$select public.classification_enqueue(pg_temp.id(1),'L1','2026-10-01','2026-10-04',pg_temp.id(40),true,pg_temp.opts()||'{"abc_b":"0.7"}')$$,'MQ422',null,'invalid threshold order rejected');
select lives_ok($$select public.classification_enqueue(pg_temp.id(1),'L1','2026-10-01','2026-10-04',pg_temp.id(40),true,pg_temp.opts())$$,'planner enqueues classification');
select is(public.classification_enqueue(pg_temp.id(1),'L1','2026-10-01','2026-10-04',pg_temp.id(40),true,pg_temp.opts()||'{"adi":"1.320000"}'),(select id from public.planning_runs),'numerically identical thresholds replay idempotently');
select throws_ok($$select public.classification_enqueue(pg_temp.id(1),'L1','2026-10-01','2026-10-04',pg_temp.id(40),true,pg_temp.opts()||'{"adi":"2"}')$$,'MQ409',null,'changed thresholds conflict');
select throws_ok($$select public.planning_enqueue(pg_temp.id(1),'L1','2026-10-01','2026-10-04',pg_temp.id(40))$$,'MQ409',null,'run kind participates in idempotency');
select throws_ok($$select public.classification_enqueue(pg_temp.id(2),'OTHER','2026-10-01','2026-10-04',pg_temp.id(41),true,pg_temp.opts())$$,'MQ403',null,'cross tenant enqueue denied');
select throws_ok($$select app.planning_task(gen_random_uuid(),gen_random_uuid())$$,'42501',null,'members cannot capture raw snapshots');
select pg_temp.login(11,1);
select throws_ok($$select public.classification_enqueue(pg_temp.id(1),'L1','2026-10-01','2026-10-04',pg_temp.id(41),true,pg_temp.opts())$$,'MQ403',null,'branch user cannot enqueue');
reset role;
create temp table claimed as select * from app.planning_claim();
create temp table snapshot as select app.planning_task(run_id,lease_token) as payload from claimed;
select is((select jsonb_array_length(payload->'items') from snapshot),2,'snapshot excludes other tenants');
select is((select payload->'items'->0->>'days' from snapshot),'2','lifecycle clips exposure days');
select is((select payload->'items'->0->>'quantity' from snapshot),'2.123','snapshot clips lifecycle and location without decimal loss');
select is((select payload->'items'->0->>'lost_sales_quantity' from snapshot),'3.456','lost sales remain separate');
select is((select payload->'items'->1->>'days' from snapshot),'4','unknown lifecycle uses full selected window');
select is((select payload->'items'->1->>'positive_days' from snapshot),'0','missing days add no positive sales');
-- A small valid transport fixture; arithmetic itself is tested through Python.
create temp table output as select jsonb_agg(jsonb_build_object('item_id',i->>'item_id','pattern','insufficient','abc','A','xyz','U','adi','2','cv2',null,'daily_cv',null,'value','2.384129')) as rows from snapshot,jsonb_array_elements(payload->'items') i;
grant select on claimed,output to zeespare_worker;
grant usage on schema extensions to zeespare_worker;
set local role zeespare_worker;
select throws_ok($$select * from planning.classification_inputs$$,'42501',null,'worker cannot read private snapshots directly');
select throws_ok($$select * from public.demand_classifications$$,'42501',null,'worker cannot read raw results');
select is(app.classification_finish((select run_id from claimed),gen_random_uuid(),(select rows from output)),false,'wrong token cannot publish');
select is(app.classification_finish((select run_id from claimed),(select lease_token from claimed),(select rows from output)),true,'worker publishes atomically');
select is(app.classification_finish((select run_id from claimed),(select lease_token from claimed),(select rows from output)),false,'publication replay fenced');
reset role;
select is((select count(*) from planning.classification_inputs),0::bigint,'success removes private staging');
select is((select count(*) from pgmq.q_planning),0::bigint,'success archives message');
-- A second result at an unassigned location makes branch isolation observable.
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 values(pg_temp.id(50),pg_temp.id(1),pg_temp.id(21),pg_temp.id(51),'2026-10-01','2026-10-04','classification','succeeded','{}',now(),'{}');
insert into public.demand_classifications(organization_id,run_id,location_id,item_id,item_code,item_name,currency,pattern,abc,xyz,evidence)
 values(pg_temp.id(1),pg_temp.id(50),pg_temp.id(21),pg_temp.id(30),'I1','Item 1','SAR','no_sales','N','U','{}');
set local role authenticated;
select pg_temp.login(10,1);
select is((select count(*) from public.demand_classifications),3::bigint,'planner sees organization results');
select throws_ok($$update public.demand_classifications set abc='C'$$,'42501',null,'planner cannot alter result evidence');
select throws_ok($$delete from public.demand_classifications$$,'42501',null,'planner cannot delete result evidence');
select throws_ok($$insert into public.demand_classifications default values$$,'42501',null,'planner cannot forge rows');
select pg_temp.login(11,1);
select is((select count(*) from public.demand_classifications),2::bigint,'branch reads only assigned location results');
select pg_temp.login(12,2);
select is((select count(*) from public.demand_classifications),0::bigint,'other tenant cannot read results');
reset role;
select ok(not has_function_privilege('service_role','app.classification_finish(uuid,uuid,jsonb)','EXECUTE'),'service role cannot publish');
select ok(not has_function_privilege('zeespare_worker','app.planning_execute_readiness(uuid,uuid)','EXECUTE'),'worker cannot bypass kind dispatch');
-- Capture then cancel: publication and input access are fenced, staging removed.
set local role authenticated;
select pg_temp.login(10,1);
select public.classification_enqueue(pg_temp.id(1),'L1','2026-10-01','2026-10-04',pg_temp.id(60),true,pg_temp.opts());
reset role;
truncate claimed;
insert into claimed select * from app.planning_claim();
select app.planning_task(run_id,lease_token) is not null from claimed;
set local role authenticated;
select public.planning_cancel(pg_temp.id(1),(select id from public.planning_runs where request_id=pg_temp.id(60)));
reset role;
select is((select count(*) from planning.classification_inputs),0::bigint,'cancellation removes captured inputs');
select is(app.planning_task((select run_id from claimed),(select lease_token from claimed)),null,'canceled token cannot read input');
select is(app.classification_finish((select run_id from claimed),(select lease_token from claimed),(select rows from output)),false,'canceled token cannot publish');
select * from finish();
rollback;
