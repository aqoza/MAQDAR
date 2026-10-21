begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('df230c00-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'multi-driver-forecast-'||n||'@test.local' from generate_series(10,14) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'multi-driver-forecast-a','Driver A'),(pg_temp.id(2),'multi-driver-forecast-b','Driver B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),(pg_temp.id(1),pg_temp.id(12),'branch_user'),
 (pg_temp.id(2),pg_temp.id(13),'owner'),(pg_temp.id(1),pg_temp.id(14),'approver');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone)
 select pg_temp.id(20+n),pg_temp.id(case when n=2 then 2 else 1 end),'L'||n,'Location','branch','SA','Asia/Riyadh' from generate_series(0,2) n;
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
 values(pg_temp.id(30),pg_temp.id(1),'P1','Part','Test','EA',1,'SAR');
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,created_by,kind,options,status,finished_at,result)
 values(pg_temp.id(40),pg_temp.id(1),pg_temp.id(20),pg_temp.id(41),'2026-01-01','2026-05-20',pg_temp.id(10),'forecast',
 '{"method":"expanded-v1","horizon":14,"history_complete":true}','succeeded',now(),'{}');
insert into public.forecast_results(id,organization_id,run_id,location_id,item_id,item_code,item_name,status,model,summary,evidence)
 values(pg_temp.id(42),pg_temp.id(1),pg_temp.id(40),pg_temp.id(20),pg_temp.id(30),'P1','Part','selected','mean','{"total":"100","scores":[]}',
 jsonb_build_object('source',jsonb_build_object('item_id',pg_temp.id(30),'item_code','P1','item_name','Part',
 'start_day','2026-01-01','end_day','2026-05-20','introduced_on',null,'discontinued_on',null,
 'unit_provenance',jsonb_build_object('method','source-units-v1','status','consistent','unit','EA','rows',140,'unknown_rows',0,'units',jsonb_build_array('EA')),
 'demand',(select jsonb_agg(jsonb_build_array(('2026-01-01'::date+n)::text,((n*17)%31+1)::text,'0')) from generate_series(0,139) n))));
create temporary table fixture(input jsonb,report jsonb,dataset uuid,second_dataset uuid,run uuid);
insert into fixture(input) select jsonb_build_object('item_code','P1','location_code','L0','driver_name','Test signal','unit','C','source','Synthetic',
 'history_from','2026-01-01','cutoff','2026-05-20','forecast_to','2026-06-03','confirmed',true,
 'rows',jsonb_agg(jsonb_build_object('date',('2026-01-01'::date+n)::text,'value',((n*17)%31+1)::text,'kind','planned','available_on','2025-12-01'))) from generate_series(0,153) n;
grant all on fixture to authenticated;
create function pg_temp.enqueue(request integer default 50,confirmed boolean default true) returns uuid language sql as $$
 select public.forecast_multi_driver_enqueue(pg_temp.id(1),pg_temp.id(42),array[dataset,second_dataset],pg_temp.id(request),confirmed) from fixture
$$;
select pg_temp.login(10,1); set local role authenticated;
update fixture set report=public.external_driver_preview(pg_temp.id(1),input);
update fixture set dataset=public.external_driver_save(pg_temp.id(1),input,pg_temp.id(43),report->>'fingerprint');
update fixture set second_dataset=public.external_driver_save(pg_temp.id(1),input,pg_temp.id(44),report->>'fingerprint');
select throws_ok($$select pg_temp.enqueue(50,false)$$,'MQ422',null,'applicability confirmation required');
update fixture set run=pg_temp.enqueue();
select is((select public.forecast_multi_driver_enqueue(pg_temp.id(1),pg_temp.id(42),array[second_dataset,dataset],pg_temp.id(50),true) from fixture),(select run from fixture),'reordered retry returns original run');
select is(pg_temp.enqueue(),(select run from fixture),'identical retry returns original run');
select is((select count(*)::int from public.planning_runs where options->>'method'='multi-driver-v1'),1,'one run stored');
select throws_ok($$select public.forecast_multi_driver_enqueue(pg_temp.id(1),pg_temp.id(99),array[dataset,second_dataset],pg_temp.id(50),true) from fixture$$,'MQ409',null,'request conflicts do not overwrite evidence');
select throws_ok($$select pg_temp.enqueue(51)$$,'MQ409',null,'one active run per organization retained');
select throws_ok($$select app.driver_window_available('{}','2026-01-01','2026-01-02',1)$$,'42501',null,'private helper not callable by browser');
select throws_ok($$select app.forecast_finish_before_multi_driver(null,null,'[]')$$,'42501',null,'old publication wrapper remains private');
select throws_ok($$insert into public.forecast_results default values$$,'42501',null,'no direct result writes');
select pg_temp.login(11,1);
select throws_ok($$select pg_temp.enqueue()$$,'MQ403',null,'viewer cannot retry');
select is((select count(*)::int from public.planning_runs where options->>'method'='multi-driver-v1'),1,'viewer can inspect queued run');
select pg_temp.login(14,1);
select throws_ok($$select pg_temp.enqueue()$$,'MQ403',null,'approver cannot enqueue');
select pg_temp.login(12,1);
select is((select count(*)::int from public.planning_runs),0,'branch cannot see hidden source or run');
select is((select count(*)::int from public.forecast_results),0,'branch cannot see source evidence');
select pg_temp.login(13,2);
select is((select count(*)::int from public.planning_runs),0,'other tenant cannot see run');
select throws_ok($$select pg_temp.enqueue()$$,'MQ403',null,'other tenant enqueue rejected');
select throws_ok($$select public.forecast_multi_driver_enqueue(pg_temp.id(2),pg_temp.id(42),array[dataset,second_dataset],pg_temp.id(60),true) from fixture$$,'MQ404',null,'own tenant cannot borrow hidden source ids');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.enqueue()$$,'MQ403',null,'active organization mismatch rejected');
reset role;
select ok((select payload#>'{drivers,0,report}'=report and payload#>'{drivers,1,report}'=report from planning.forecast_inputs cross join fixture where run_id=fixture.run),'exact driver evidence copied at enqueue');
select is((select payload#>>'{items,0,unit_provenance,unit}' from planning.forecast_inputs cross join fixture where run_id=fixture.run),'EA','captured known demand unit');
select ok((select payload#>>'{drivers,1,imported_at}' is not null from planning.forecast_inputs cross join fixture where run_id=fixture.run),'server import time copied separately');
select ok(app.driver_window_available((select payload#>'{drivers,1}' from planning.forecast_inputs cross join fixture where run_id=fixture.run),'2026-01-01','2026-04-08',14),'availability includes prediction dates');
select ok(not app.driver_window_available('{"report":{"input":{"rows":[{"date":"2026-01-01","value":"0","available_on":"2026-01-02"}]}}}','2026-01-01','2026-01-01',1),'late and missing values do not become zero');
-- Queue transport isolation stays inside this rolled-back transaction.
update pgmq.q_planning set vt=clock_timestamp()+interval '1 hour' where message->>'run_id'<>(select run::text from fixture);
create temporary table claimed as select * from app.planning_claim();
select is((select run_id from claimed),(select run from fixture),'global worker claims driver run');
select ok((select expires_at>clock_timestamp()+interval '14 minutes' from planning.leases join fixture on run_id=fixture.run),'driver uses expanded 900 second lease');
select is((select app.planning_task(run_id,lease_token)->>'method' from claimed),'multi-driver-v1','worker receives captured driver method');
select is((select app.planning_task(run_id,pg_temp.id(90)) from claimed),null::jsonb,'wrong lease cannot read source');
select throws_ok($$select app.forecast_finish(run_id,lease_token,'[]') from claimed$$,'MQ422',null,'empty output rejected atomically');
select is((select count(*)::int from public.forecast_results join fixture on run_id=fixture.run),0,'invalid output publishes nothing');
update planning.leases set expires_at=clock_timestamp()-interval '1 second' where run_id=(select run from fixture);
select is((select app.planning_task(run_id,lease_token) from claimed),null::jsonb,'expired worker cannot read');
select is((select app.forecast_finish(run_id,lease_token,'[]') from claimed),false,'expired worker cannot publish');
select pg_temp.login(10,1); set local role authenticated;
select lives_ok($$select public.planning_cancel(pg_temp.id(1),(select run from fixture))$$,'owner can cancel driver run');
reset role;
select is((select count(*)::int from planning.forecast_inputs join fixture on run_id=fixture.run),0,'terminal cancellation cleans private inputs');
select * from finish();
rollback;
