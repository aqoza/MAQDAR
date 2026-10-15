begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('70000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void;
$$;
insert into auth.users(id,email) values(pg_temp.id(10),'planning-owner@test.local'),(pg_temp.id(11),'planning-branch@test.local'),(pg_temp.id(12),'planning-viewer@test.local');
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'planning-a','Planning A'),(pg_temp.id(2),'planning-b','Planning B');
insert into public.memberships(organization_id,user_id,role) values(pg_temp.id(1),pg_temp.id(10),'planner'),(pg_temp.id(1),pg_temp.id(11),'branch_user'),(pg_temp.id(2),pg_temp.id(12),'viewer');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values
 (pg_temp.id(20),pg_temp.id(1),'L1','Location 1','branch','SA','Asia/Riyadh'),
 (pg_temp.id(21),pg_temp.id(1),'L2','Location 2','branch','SA','Asia/Riyadh'),
 (pg_temp.id(22),pg_temp.id(2),'OTHER','Other location','branch','SA','Asia/Riyadh');
insert into public.membership_locations(organization_id,user_id,location_id) values(pg_temp.id(1),pg_temp.id(11),pg_temp.id(20));
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values
 (pg_temp.id(30),pg_temp.id(1),'I1','Item 1','test','EA',1,'SAR'),(pg_temp.id(31),pg_temp.id(1),'I2','Item 2','test','EA',1,'SAR'),
 (pg_temp.id(32),pg_temp.id(2),'OTHER','Other item','test','EA',1,'SAR');
insert into public.demand_history(organization_id,item_id,location_id,demand_date,quantity,lost_sales_quantity) values
 (pg_temp.id(1),pg_temp.id(30),pg_temp.id(20),'2026-10-01',1.123,2.456),
 (pg_temp.id(1),pg_temp.id(30),pg_temp.id(21),'2026-10-01',999,0),
 (pg_temp.id(1),pg_temp.id(30),pg_temp.id(20),'2026-10-02',900,0),
 (pg_temp.id(2),pg_temp.id(32),pg_temp.id(22),'2026-10-01',999,0);

set local role authenticated;
select pg_temp.login(10,1);
select lives_ok($$select public.planning_enqueue(pg_temp.id(1),'L1','2026-10-01','2026-10-01',pg_temp.id(40))$$,'planner can enqueue');
select is(public.planning_enqueue(pg_temp.id(1),'L1','2026-10-01','2026-10-01',pg_temp.id(40)),(select id from public.planning_runs),'same request is idempotent');
select throws_ok($$select public.planning_enqueue(pg_temp.id(1),'L2','2026-10-01','2026-10-01',pg_temp.id(40))$$,'MQ409',null,'changed replay rejected');
select throws_ok($$select public.planning_enqueue(pg_temp.id(1),'L1','2026-10-01','2026-10-01',pg_temp.id(41))$$,'MQ409',null,'second active run rejected');
select throws_ok($$select public.planning_enqueue(pg_temp.id(2),'OTHER','2026-10-01','2026-10-01',pg_temp.id(41))$$,'MQ403',null,'cross-tenant enqueue rejected');
select throws_ok($$select public.planning_enqueue(pg_temp.id(1),'OTHER','2026-10-01','2026-10-01',pg_temp.id(41))$$,'MQ422',null,'foreign location rejected');
select throws_ok($$select public.planning_enqueue(pg_temp.id(1),'L1','2020-01-01','2026-10-01',pg_temp.id(41))$$,'MQ422',null,'oversized window rejected');
select throws_ok($$select public.planning_enqueue(pg_temp.id(1),'L1','infinity','infinity',pg_temp.id(41))$$,'MQ422',null,'infinite dates rejected');
select throws_ok($$update public.planning_runs set status='succeeded'$$,'42501',null,'member cannot forge results');
select throws_ok($$select app.planning_claim()$$,'42501',null,'member cannot claim jobs');
select throws_ok($$select * from pgmq.q_planning$$,'42501',null,'queue is private');
select pg_temp.login(11,1);
select is((select count(*) from public.planning_runs),1::bigint,'assigned branch reads own run');
select throws_ok($$select public.planning_cancel(pg_temp.id(1),(select id from public.planning_runs))$$,'MQ403',null,'branch user cannot cancel');
select throws_ok($$select public.planning_enqueue(pg_temp.id(1),'L1','2026-10-01','2026-10-01',pg_temp.id(41))$$,'MQ403',null,'branch user cannot enqueue');
select pg_temp.login(12,2);
select is((select count(*) from public.planning_runs),0::bigint,'other tenant cannot read run');
reset role;
create temp table claimed as select * from app.planning_claim();
grant select on claimed to maqdar_worker;
-- Test harness only: worker can resolve pgTAP while the transaction is open.
grant usage on schema extensions to maqdar_worker;
select is((select attempts from public.planning_runs where organization_id=pg_temp.id(1)),1,'claim records first attempt');
set local role maqdar_worker;
select throws_ok($$select * from public.items$$,'42501',null,'worker cannot read raw business data');
select throws_ok($$select * from public.planning_runs$$,'42501',null,'worker has no raw run privileges');
select throws_ok($$select * from planning.leases$$,'42501',null,'worker has no raw lease privileges');
select is((select count(*) from app.planning_claim()),0::bigint,'claimed message is invisible');
select is(app.planning_execute((select run_id from claimed),gen_random_uuid()),false,'wrong lease cannot complete');
select is(app.planning_execute((select run_id from claimed),(select lease_token from claimed)),true,'worker computes readiness');
select is(app.planning_execute((select run_id from claimed),(select lease_token from claimed)),false,'completion replay has no side effects');
reset role;
select is((select result->>'quantity' from public.planning_runs where organization_id=pg_temp.id(1)),'1.123','report filters tenant, location and date without decimal loss');
select is((select result->>'lost_sales_quantity' from public.planning_runs where organization_id=pg_temp.id(1)),'2.456','lost sales remain separate');
select is((select result->>'active_items' from public.planning_runs where organization_id=pg_temp.id(1)),'2','coverage includes items with no history');
select is((select result->>'items_with_history' from public.planning_runs where organization_id=pg_temp.id(1)),'1','counts stored history only');
select is((select count(*) from pgmq.q_planning),0::bigint,'success acknowledges atomically');

set local role authenticated;
select pg_temp.login(10,1);
select lives_ok($$select public.planning_enqueue(pg_temp.id(1),'L2','2026-10-01','2026-10-01',pg_temp.id(42))$$,'new request after terminal run');
select pg_temp.login(11,1);
select is((select count(*) from public.planning_runs),1::bigint,'branch cannot see another location run');
reset role;
truncate claimed;
insert into claimed select * from app.planning_claim();
select is(app.planning_fail((select run_id from claimed),(select lease_token from claimed)),true,'failure queues a retry');
select is((select status from public.planning_runs where id=(select run_id from claimed)),'queued','failure is recoverable');
select is(app.planning_execute((select run_id from claimed),(select lease_token from claimed)),false,'old token invalid after failure');
select is((select count(*) from app.planning_claim()),0::bigint,'retry is delayed');
-- Simulate visibility expiry without sleeping.
update pgmq.q_planning set vt=clock_timestamp()-interval '1 second';
truncate claimed;
insert into claimed select * from app.planning_claim();
select is((select attempts from public.planning_runs where id=(select run_id from claimed)),2,'retry increments attempt');
update planning.leases set expires_at=clock_timestamp()-interval '1 second';
select is(app.planning_execute((select run_id from claimed),(select lease_token from claimed)),false,'expired worker cannot publish');
update pgmq.q_planning set vt=clock_timestamp()-interval '1 second';
create temp table reclaimed as select * from app.planning_claim();
select isnt((select lease_token from claimed),(select lease_token from reclaimed),'crash recovery replaces lease token');
select is(app.planning_fail((select run_id from claimed),(select lease_token from claimed)),false,'stale worker cannot fail replacement');
select is(app.planning_fail((select run_id from reclaimed),(select lease_token from reclaimed)),true,'third failure is terminal');
select is((select status from public.planning_runs where id=(select run_id from reclaimed)),'failed','bounded retry stops');

set local role authenticated;
select pg_temp.login(10,1);
select public.planning_enqueue(pg_temp.id(1),'L1','2026-10-01','2026-10-01',pg_temp.id(43));
reset role;
truncate claimed;
insert into claimed select * from app.planning_claim();
set local role authenticated;
select lives_ok($$select public.planning_cancel(pg_temp.id(1),(select id from public.planning_runs where request_id=pg_temp.id(43)))$$,'cancel running run');
reset role;
select is(app.planning_execute((select run_id from claimed),(select lease_token from claimed)),false,'cancellation prevents late result');
select is((select count(*) from pgmq.q_planning),0::bigint,'cancel archives transport');
select ok(not has_schema_privilege('service_role','pgmq','USAGE'),'service role cannot bypass queue');
select ok(not has_function_privilege('service_role','app.planning_claim()','EXECUTE'),'service role cannot claim');
select ok((select not rolcanlogin and not rolsuper and not rolbypassrls and not rolcreaterole from pg_roles where rolname='maqdar_worker'),'worker capability role has no login or administrative privileges');
-- An empty report is valid and never fabricates zero observations.
set local role authenticated;
select public.planning_enqueue(pg_temp.id(1),'L1','2026-09-01','2026-09-01',pg_temp.id(44));
reset role;
truncate claimed;
insert into claimed select * from app.planning_claim();
select is(app.planning_execute((select run_id from claimed),(select lease_token from claimed)),true,'empty history completes');
select is((select result->>'stored_rows' from public.planning_runs where id=(select run_id from claimed)),'0','empty window has zero stored rows');
select is((select result->>'first_record' from public.planning_runs where id=(select run_id from claimed)),null,'empty window has no first record');
-- Crash on the last attempt is terminal when the message becomes visible again.
set local role authenticated;
select public.planning_enqueue(pg_temp.id(1),'L1','2026-09-01','2026-09-01',pg_temp.id(45));
reset role;
update public.planning_runs set attempts=3,status='running' where request_id=pg_temp.id(45);
select is((select count(*) from app.planning_claim()),0::bigint,'crashed exhausted run is drained without fourth attempt');
select is((select status from public.planning_runs where request_id=pg_temp.id(45)),'failed','crashed final attempt becomes failed');
select is((select count(*) from pgmq.q_planning),0::bigint,'exhausted run is acknowledged');
select * from finish();
rollback;
