begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('cc270000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer default 1) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'returns-'||n||'@test.local' from generate_series(10,16) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'returns-a','Returns A'),(pg_temp.id(2),'returns-b','Returns B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),(pg_temp.id(1),pg_temp.id(12),'branch_user'),
 (pg_temp.id(2),pg_temp.id(13),'owner'),(pg_temp.id(1),pg_temp.id(14),'planner'),(pg_temp.id(1),pg_temp.id(15),'approver'),(pg_temp.id(1),pg_temp.id(16),'admin');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values
 (pg_temp.id(101),pg_temp.id(1),'B','Branch','branch','SA','Asia/Riyadh'),
 (pg_temp.id(102),pg_temp.id(1),'H','Hub','hub','SA','Asia/Riyadh'),
 (pg_temp.id(103),pg_temp.id(1),'C','Central','central','SA','Asia/Riyadh'),
 (pg_temp.id(104),pg_temp.id(2),'OTHER','Other','branch','SA','Asia/Riyadh');
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
 values(pg_temp.id(30),pg_temp.id(1),'P1','Part','Test','EA',1,'SAR');
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(101));
create temporary table fixture(input jsonb,saved uuid,report jsonb);
insert into fixture(input) values('{"item_code":"P1","source_code":"B","location_code":"H","quantity":"2.125","unit":"EA","requested_date":"2026-10-24","condition":"unknown","reason":"Declared excess","sale_reference":"INV-4","confirmed":true}');
grant all on fixture to authenticated;
create function pg_temp.save(n integer default 50,overrides jsonb default '{}') returns uuid language sql as $$select public.dealer_return_save(pg_temp.id(1),input||overrides,pg_temp.id(n)) from fixture$$;
create function pg_temp.review(n integer default 50,d text default 'approved',r text default 'Eligibility checked',c boolean default true) returns uuid language sql as $$
 select public.dealer_return_review(pg_temp.id(1),(select id from public.dealer_return_requests where request_id=pg_temp.id(n)),d,r,c)$$;
alter table fixture add column handoff uuid,add column payload jsonb;
create function pg_temp.export(n integer default 50) returns uuid language sql as $$
 select public.dealer_return_handoff_create(pg_temp.id(1),(select id from public.dealer_return_requests where request_id=pg_temp.id(n)))$$;
select pg_temp.login(10); set local role authenticated;
update fixture set saved=pg_temp.save();
select pg_temp.login(15);select pg_temp.review();
select pg_temp.login(10);update fixture set handoff=pg_temp.export();
create temporary table exports as select handoff id from fixture;
grant select on exports to service_role;
create temporary table batches as select public.dealer_return_batch_create(pg_temp.id(1),array[(select id from exports)]) id;
grant select on batches to service_role;
reset role;
create function pg_temp.operational_state() returns jsonb language sql as $$
  select jsonb_build_object(
    'stock',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.stock_snapshots t where organization_id=pg_temp.id(1)),
    'orders',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.open_orders t where organization_id=pg_temp.id(1)),
    'receipts',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.receipts t where organization_id=pg_temp.id(1)),
    'policies',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.inventory_policies t where organization_id=pg_temp.id(1)),
    'runs',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.planning_runs t where organization_id=pg_temp.id(1)));
$$;
create temporary table original_operational_state as select pg_temp.operational_state() as evidence;
create function pg_temp.hash(n integer) returns bytea language sql immutable as $$select decode(lpad(n::text,64,'0'),'hex')$$;
create function pg_temp.key(n integer,scopes text[],org integer default 1) returns uuid language sql as $$select public.create_api_key(pg_temp.id(org),'Regional reporter',scopes,30,pg_temp.hash(n),'zeespare_sk_test','test')$$;
select pg_temp.login(10,1); set local role authenticated;
select pg_temp.key(100,array['dealer_return_handoffs:acknowledge']);
reset role;
create function pg_temp.report(n integer,system_name text,reference text,status text default 'received',reason text default null,batched boolean default false) returns jsonb language sql as $$
 select public.api_dealer_return_handoff_acknowledge(pg_temp.hash(100),case when batched then 'dealer-return-handoff-batches' else 'dealer-return-handoffs' end,
 case when batched then (select id from batches) else (select id from exports) end,
 jsonb_build_object('client_event_id',pg_temp.id(n),'external_system',system_name,'external_reference',reference,'status',status,'reason',reason))$$;
select pg_temp.report(200,'ERP','old-ref','rejected','Old rejection');
select pg_temp.report(201,'ERP','latest-ref');
select pg_temp.report(202,'erp','lower-ref','rejected','Lowercase system');
select pg_temp.report(203,' ERP ','space-ref','rejected','Preserve spaces');
create function pg_temp.work(filters jsonb default '{}',page_no integer default 1,size_no integer default 25) returns jsonb language sql as $$
 select public.dealer_return_integration_workbench(pg_temp.id(1),filters,page_no,size_no)$$;
select pg_temp.login(10,1);set local role authenticated;
select is((pg_temp.work()->>'total')::integer,4,'separate exact systems and unreported batch');
select is((pg_temp.work('{"kind":"handoff"}')->>'total')::integer,3,'single reports do not propagate');
select is((pg_temp.work('{"kind":"batch","status":"no_report"}')->>'total')::integer,1,'batch absence stays absence');
select is((pg_temp.work('{"system":"ERP","status":"rejected"}')->>'total')::integer,0,'latest picked before status');
select is((pg_temp.work('{"q":"old-ref"}')->>'total')::integer,0,'superseded reference cannot match');
select is((pg_temp.work('{"q":"latest-ref"}')->>'total')::integer,1,'latest reference searchable');
select is((pg_temp.work('{"system":" ERP ","status":"rejected"}')->>'total')::integer,1,'whitespace identity preserved');
select is(pg_temp.work('{"system":"erp","kind":"handoff"}')#>>'{rows,0,external_reference}','lower-ref','case identity preserved');
select is((pg_temp.work('{"system":"Absent","status":"no_report"}')->>'total')::integer,2,'missing selected system creates absent rows for all packages');
select is(pg_temp.work('{"system":"Absent"}')#>>'{rows,0,external_system}','Absent','missing selected system stays inspectable');
select is((pg_temp.work('{"source":"B","location":"H"}')->>'total')::integer,4,'both saved endpoint codes filter');
select is((pg_temp.work('{"source":"H"}')->>'total')::integer,0,'source direction is explicit');
select is((pg_temp.work('{"sources":"available"}')->>'total')::integer,4,'available sources are independent of rejection');
select is((pg_temp.work('{"sources":"unavailable"}')->>'total')::integer,0,'original sources still available');
select is((pg_temp.work('{"q":"P1 H"}')->>'total')::integer,4,'copied item and location tokens searchable');
select is(pg_temp.work('{"kind":"handoff"}')#>>'{rows,0,requested_date}','2026-10-24','requested date retained without scheduling');
select ok(not (pg_temp.work()->'rows'->0 ? 'selected'),'no invented approval selection state');
select throws_ok(format('select public.dealer_return_integration_workbench(%L)',pg_temp.id(2)),'MQ404',null,'other tenant hidden');
select throws_ok($$select pg_temp.work('[]')$$,'MQ422',null,'object filters only');
select throws_ok($$select pg_temp.work('{"selection":"current"}')$$,'MQ422',null,'no purchase-selection semantics');
select throws_ok($$select pg_temp.work('{"sources":"current"}')$$,'MQ422',null,'bounded source state');
select throws_ok($$select pg_temp.work('{"status":"failed"}')$$,'MQ422',null,'no invented delivery state');
select throws_ok($$select pg_temp.work('{"system":" "}')$$,'MQ422',null,'blank system refused');
select throws_ok($$select pg_temp.work('{"q":3}')$$,'MQ422',null,'filter types checked');
select throws_ok($$select pg_temp.work(jsonb_build_object('q',repeat('x',101)))$$,'MQ422',null,'search bounded');
select throws_ok($$select pg_temp.work(jsonb_build_object('source',E'B\n'))$$,'MQ422',null,'controls refused');
select throws_ok($$select pg_temp.work('{}',0)$$,'MQ422',null,'page positive');
select throws_ok($$select pg_temp.work('{}',1,101)$$,'MQ422',null,'page size bounded');
select pg_temp.login(11,1);
select is((pg_temp.work()->>'total')::integer,4,'viewer reads reports');
select pg_temp.login(12,1);
select is((pg_temp.work()->>'total')::integer,0,'one endpoint reveals neither rows nor counts');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(102));
set local role authenticated;
select is((pg_temp.work()->>'total')::integer,4,'both endpoints permit history');
reset role;
delete from public.membership_locations where user_id=pg_temp.id(12) and location_id=pg_temp.id(101);
set local role authenticated;
select is((pg_temp.work('{"location":"H"}')->>'total')::integer,0,'filter cannot relax both-location access');
select pg_temp.login(13,2);
select throws_ok($$select pg_temp.work()$$,'MQ404',null,'foreign member denied');
reset role;
select ok(not p.prosecdef and 'search_path=""'=any(p.proconfig),'invoker rights and empty path') from pg_proc p where oid='public.dealer_return_integration_workbench(uuid,jsonb,integer,integer)'::regprocedure;
select ok(has_function_privilege(role,'public.dealer_return_integration_workbench(uuid,jsonb,integer,integer)','execute')=(role='authenticated'),'bounded execution for '||role) from unnest(array['anon','authenticated','service_role','zeespare_worker','zeespare_simulation_worker']) role;
-- Ties use ascending event UUID as a deterministic display tie-break.
update public.dealer_return_handoff_acknowledgements set recorded_at='2026-10-24T00:00:00Z' where external_system='ERP';
select pg_temp.login(10,1);set local role authenticated;
select is(pg_temp.work('{"kind":"handoff","system":"ERP"}')#>>'{rows,0,external_reference}',
 (select external_reference from public.dealer_return_handoff_acknowledgements where external_system='ERP' order by id limit 1),'stable tie break');
reset role;
select pg_temp.report(300+n,'System '||n,'ref-'||n) from generate_series(1,30) n;
select pg_temp.login(10,1);set local role authenticated;
select is(jsonb_array_length(pg_temp.work()->'rows'),25,'bounded first page');
select is((pg_temp.work('{}',999)->>'page')::integer,2,'out-of-range page clamped');
select is(jsonb_array_length(pg_temp.work('{}',2)->'rows'),9,'last page excludes first page rows');
select is(jsonb_array_length(pg_temp.work('{}',1,50)->'rows'),34,'supported size fifty');
reset role;
-- Copy before deleting the original request; the batch and its own report survive.
select pg_temp.report(400,'ERP','batch-ref','rejected','Batch mapping',true);
create temporary table original_batch as select payload from public.dealer_return_batches;
create temporary table original_audit as select count(*) n from public.audit_log;
select pg_temp.login(10,1);set local role authenticated;
select is((pg_temp.work('{"kind":"handoff","q":"batch-ref"}')->>'total')::integer,0,'batch reports never propagate to members');
reset role;
delete from public.dealer_return_requests where id=(select saved from fixture);
create temporary table audit_after_delete as select count(*) n from public.audit_log;
select pg_temp.login(10,1);set local role authenticated;
select is((pg_temp.work()->>'total')::integer,1,'deleted singles disappear, copied batch stays');
select is((pg_temp.work('{"sources":"unavailable","status":"rejected"}')->>'total')::integer,1,'missing sources independent of rejected report');
select is((pg_temp.work('{"sources":"unavailable","system":"Absent","status":"no_report"}')->>'total')::integer,1,'retained batch with missing system remains absent');
select is((pg_temp.work('{"q":"P1"}')->>'total')::integer,1,'copied search survives source deletion');
reset role;
select is((select payload from public.dealer_return_batches),(select payload from original_batch),'original copied evidence unchanged');
select is(pg_temp.operational_state(),(select evidence from original_operational_state),'reads create no operational effects');
select is((select count(*) from public.audit_log),(select n from audit_after_delete),'reads do not write audit');
select * from finish();rollback;
