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
select pg_temp.login(10,1);
set local role authenticated;
select lives_ok($$select pg_temp.key(100,array['dealer_return_handoffs:read','dealer_return_handoffs:acknowledge'])$$,'owner explicitly issues report scope');
select pg_temp.key(101,array['master_data:read','master_data:write','transactions:read','transactions:write','purchase_handoffs:read','purchase_handoffs:acknowledge','transfer_handoffs:read','transfer_handoffs:acknowledge','event_purchase_handoffs:read','event_purchase_handoffs:acknowledge','excess_disposition_handoffs:read','excess_disposition_handoffs:acknowledge','network_handoffs:read','network_handoffs:acknowledge','regional_handoffs:read','regional_handoffs:acknowledge','dealer_return_handoffs:read']);
select pg_temp.key(103,array['dealer_return_handoffs:acknowledge']);
select pg_temp.login(13,2);
select pg_temp.key(102,array['dealer_return_handoffs:read','dealer_return_handoffs:acknowledge'],2);
select pg_temp.login(12,1);
select throws_ok($$select pg_temp.key(104,array['dealer_return_handoffs:acknowledge'])$$,'MQ403',null,'branch member cannot issue report keys');
reset role;
create function pg_temp.body(n integer,status text default 'received',reason text default null) returns jsonb language sql as $$select jsonb_build_object('client_event_id',pg_temp.id(n),'external_system','ERP','external_reference','000123','status',status,'reason',reason)$$;
create function pg_temp.ack(n integer,key_no integer default 100,body jsonb default null) returns jsonb language sql as $$select public.api_dealer_return_handoff_acknowledge(pg_temp.hash(key_no),'dealer-return-handoffs',(select id from exports),coalesce(body,pg_temp.body(n)))$$;
create temporary table events(n integer,body jsonb);
grant all on events to service_role;
set local role service_role;
select throws_ok($$select pg_temp.ack(200,101)$$,'MQ403',null,'all prior scopes grant no return writes');
select throws_ok($$select public.api_dealer_return_handoff_acknowledgements(pg_temp.hash(103),'dealer-return-handoffs',(select id from exports))$$,'MQ403',null,'report scope grants no history');
select throws_ok($$select pg_temp.ack(200,102)$$,'MQ404',null,'foreign package hidden');
select throws_ok($$select pg_temp.ack(200,999)$$,'MQ401',null,'unknown credential denied');
select throws_ok($$select public.api_dealer_return_handoff_acknowledge(pg_temp.hash(100),'items',(select id from exports),pg_temp.body(200))$$,'MQ404',null,'resource allowlist');
select throws_ok($$select public.api_transfer_handoff_acknowledge(pg_temp.hash(100),'transfer-handoffs',(select id from exports),pg_temp.body(200))$$,'MQ403',null,'return grants no other family access');
select throws_ok($$select pg_temp.ack(200,100,'[]')$$,'MQ422',null,'object required');
select throws_ok($$select pg_temp.ack(200,100,pg_temp.body(200)||'{"organization_id":"ignored"}')$$,'MQ422',null,'caller cannot supply tenant');
select throws_ok($$select pg_temp.ack(200,100,pg_temp.body(200,'rejected'))$$,'MQ422',null,'rejection requires reason');
select throws_ok($$select pg_temp.ack(200,100,pg_temp.body(200)||'{"status":"accepted"}')$$,'MQ422',null,'no inferred execution status');
select throws_ok($$select pg_temp.ack(200,100,pg_temp.body(200)||'{"external_system":null}')$$,'MQ422',null,'null system refused');
select throws_ok($$select pg_temp.ack(200,100,pg_temp.body(200)||'{"external_reference":" "}')$$,'MQ422',null,'blank reference refused');
select throws_ok($$select pg_temp.ack(200,100,pg_temp.body(200)||jsonb_build_object('reason',E'bad\nreason'))$$,'MQ422',null,'control characters refused');
select throws_ok($$select pg_temp.ack(200,100,pg_temp.body(200)||jsonb_build_object('reason',repeat('x',1001)))$$,'MQ422',null,'reason bounded');
insert into events values(1,pg_temp.ack(200)),(2,pg_temp.ack(201,100,pg_temp.body(201,'rejected','Unknown branch')));
select is((select body->>'replayed' from events where n=1),'false','first report created');
select is(pg_temp.ack(200,103)->'data',(select body->'data' from events where n=1),'rotated key retry preserves original attribution and timestamp');
select is(pg_temp.ack(200,103)->>'replayed','true','retry indicated');
select is(pg_temp.ack(200,103,pg_temp.body(200)-'reason')->>'replayed','true','omitted and null reasons are equivalent');
select throws_ok($$select pg_temp.ack(200,103,pg_temp.body(200,'rejected','Different'))$$,'MQ409',null,'conflicting content refused');
select throws_ok($$select public.api_dealer_return_handoff_acknowledge(pg_temp.hash(100),'dealer-return-handoff-batches',(select id from batches),pg_temp.body(200))$$,'MQ409',null,'UUID namespace spans singles and batches');
insert into events values(3,public.api_dealer_return_handoff_acknowledge(pg_temp.hash(100),'dealer-return-handoff-batches',(select id from batches),pg_temp.body(202)));
select is(jsonb_array_length(public.api_dealer_return_handoff_acknowledgements(pg_temp.hash(100),'dealer-return-handoffs',(select id from exports))->'data'),2,'batch report never propagates to handoff');
select is(jsonb_array_length(public.api_dealer_return_handoff_acknowledgements(pg_temp.hash(100),'dealer-return-handoff-batches',(select id from batches))->'data'),1,'handoff reports never propagate to batch');
select throws_ok(format('select public.api_dealer_return_handoff_acknowledgements(pg_temp.hash(100),%L,(select id from batches),%L)','dealer-return-handoff-batches',(select body#>>'{data,id}' from events where n=1)),'MQ404',null,'event detail bound to parent');
select throws_ok($$select public.api_dealer_return_handoff_acknowledgements(pg_temp.hash(102),'dealer-return-handoffs',(select id from exports))$$,'MQ404',null,'foreign history hidden');
insert into events values(4,public.api_dealer_return_handoff_acknowledgements(pg_temp.hash(100),'dealer-return-handoffs',(select id from exports),null,null,1));
select is(jsonb_array_length((select body->'data' from events where n=4)),1,'bounded first page');
select is(jsonb_array_length(public.api_dealer_return_handoff_acknowledgements(pg_temp.hash(100),'dealer-return-handoffs',(select id from exports),null,(select body->>'next_cursor' from events where n=4),1)->'data'),1,'second history page');
select throws_ok(format('select public.api_dealer_return_handoff_acknowledgements(pg_temp.hash(100),%L,(select id from batches),null,%L)','dealer-return-handoff-batches',(select body->>'next_cursor' from events where n=4)),'MQ422',null,'cursor bound to exact package');
select throws_ok($$select public.api_dealer_return_handoff_acknowledgements(pg_temp.hash(100),'dealer-return-handoffs',(select id from exports),null,'broken',25)$$,'MQ422',null,'bad cursor refused');
select throws_ok($$select public.api_dealer_return_handoff_acknowledgements(pg_temp.hash(100),'dealer-return-handoffs',(select id from exports),null,null,101)$$,'MQ422',null,'history bounded');
reset role;
select is((select count(*) from public.audit_log where organization_id=pg_temp.id(1) and table_name='dealer_return_handoff_acknowledgements' and operation='INSERT'),3::bigint,'only first creations audited');
select pg_temp.login(12,1);
set local role authenticated;
select is((select count(*) from public.dealer_return_handoff_acknowledgements),0::bigint,'no all-location access hides history and counts');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(101)) on conflict do nothing;
set local role authenticated;
select is((select count(*) from public.dealer_return_handoff_acknowledgements),0::bigint,'source alone insufficient');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(102));
set local role authenticated;
select is((select count(*) from public.dealer_return_handoff_acknowledgements),3::bigint,'all participating locations reveal history');
select throws_ok($$delete from public.dealer_return_handoff_acknowledgements$$,'42501',null,'browser cannot mutate history');
select pg_temp.login(13,2);
select is((select count(*) from public.dealer_return_handoff_acknowledgements),0::bigint,'other tenant cannot read history directly');
reset role;
select ok(not has_table_privilege(r,'public.dealer_return_handoff_acknowledgements','INSERT,UPDATE,DELETE'),'no direct writes for '||r)
from unnest(array['anon','authenticated','service_role','zeespare_worker','zeespare_simulation_worker']) r;
select ok(has_function_privilege(r,'public.api_dealer_return_handoff_acknowledge(bytea,text,uuid,jsonb)','execute')=(r='service_role'),'writer execute restricted for '||r)
from unnest(array['anon','authenticated','service_role','zeespare_worker','zeespare_simulation_worker']) r;
-- Deleting source ancestry removes single history, but retains the copied batch and its reports.
select is(pg_temp.operational_state(),(select evidence from original_operational_state),'reports and retries leave stock, inbound, policies and planning runs unchanged');
delete from public.dealer_return_requests where id=(select saved from fixture);
select is((select count(*) from public.dealer_return_handoff_acknowledgements where handoff_id is not null),0::bigint,'single follows source deletion');
select is((select count(*) from public.dealer_return_handoff_acknowledgements where batch_id=(select id from batches)),1::bigint,'copied batch report survives source deletion');
set local role service_role;
select lives_ok($$select public.api_dealer_return_handoff_acknowledge(pg_temp.hash(100),'dealer-return-handoff-batches',(select id from batches),pg_temp.body(203))$$,'retained batch accepts new reports');
select is(public.api_dealer_return_handoff_acknowledge(pg_temp.hash(103),'dealer-return-handoff-batches',(select id from batches),pg_temp.body(203))->>'replayed','true','retained batch retry stable');
select throws_ok($$select pg_temp.ack(204)$$,'MQ404',null,'deleted handoff cannot receive reports');
reset role;
-- Remove synthetic operational references before exercising actual location deletion.
delete from public.stock_snapshots where organization_id=pg_temp.id(1) and location_id=pg_temp.id(102);
delete from public.open_orders where organization_id=pg_temp.id(1) and location_id=pg_temp.id(102);
delete from public.network_links where organization_id=pg_temp.id(1) and (from_location_id=pg_temp.id(102) or to_location_id=pg_temp.id(102));
delete from public.planning_runs where organization_id=pg_temp.id(1) and location_id=pg_temp.id(102);
delete from public.locations where id=pg_temp.id(102);
select is((select count(*) from public.dealer_return_handoff_acknowledgements where organization_id=pg_temp.id(1)),0::bigint,'participating location deletion cascades parent and reports');
select is((select count(*) from public.audit_log where organization_id=pg_temp.id(1) and table_name='dealer_return_handoff_acknowledgements' and operation='DELETE'),4::bigint,'all actual-parent cascade deletes audited');
select * from finish();
rollback;
