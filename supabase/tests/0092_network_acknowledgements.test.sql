begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('e220f200-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object(
    'sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void
$$;
insert into auth.users(id,email) select pg_temp.id(n),'network-dates-'||n||'@test.local' from generate_series(10,12) n;
insert into public.organizations(id,slug,name) values
  (pg_temp.id(1),'network-ack-a','Network dates A'),(pg_temp.id(2),'network-ack-b','Network dates B');
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
insert into public.network_transfer_handoffs(id,organization_id,proposal_id,source_location_id,required_location_ids,created_by,payload)
values(pg_temp.id(60),pg_temp.id(1),pg_temp.id(50),pg_temp.id(20),array[pg_temp.id(20),pg_temp.id(21)],pg_temp.id(10),
'{"schema_version":"network-transfer-handoff-v1","purpose":"planning_only","estimate":{"lines":[]}}');

insert into public.network_handoff_batches(id,organization_id,source_location_id,required_location_ids,handoff_ids,created_by,payload)
values(pg_temp.id(70),pg_temp.id(1),pg_temp.id(20),array[pg_temp.id(20),pg_temp.id(21)],array[pg_temp.id(60)],pg_temp.id(10),
'{"schema_version":"network-handoff-batch-v1","purpose":"planning_only","summary":{"source_code":"SOURCE","dispatch_date":"2026-10-12","branch_row_count":1,"totals":[]},"lines":[]}');

create function pg_temp.hash(n integer) returns bytea language sql immutable as $$select decode(lpad(n::text,64,'0'),'hex')$$;
create function pg_temp.key(n integer,scopes text[],org integer default 1) returns uuid language sql as $$select public.create_api_key(pg_temp.id(org),'Network reporter',scopes,30,pg_temp.hash(n),'zeespare_sk_test','test')$$;
select pg_temp.login(10,1);
set local role authenticated;
select lives_ok($$select pg_temp.key(100,array['network_handoffs:read','network_handoffs:acknowledge'])$$,'owner explicitly issues report scope');
select pg_temp.key(101,array['master_data:read','master_data:write','transactions:read','transactions:write','purchase_handoffs:read','purchase_handoffs:acknowledge','transfer_handoffs:read','transfer_handoffs:acknowledge','event_purchase_handoffs:read','event_purchase_handoffs:acknowledge','excess_disposition_handoffs:read','excess_disposition_handoffs:acknowledge','network_handoffs:read']);
select pg_temp.key(103,array['network_handoffs:acknowledge']);
select pg_temp.login(11,2);
select pg_temp.key(102,array['network_handoffs:read','network_handoffs:acknowledge'],2);
select pg_temp.login(12,1);
select throws_ok($$select pg_temp.key(104,array['network_handoffs:acknowledge'])$$,'MQ403',null,'branch member cannot issue report keys');
reset role;
create function pg_temp.body(n integer,status text default 'received',reason text default null) returns jsonb language sql as $$select jsonb_build_object('client_event_id',pg_temp.id(n),'external_system','ERP','external_reference','000123','status',status,'reason',reason)$$;
create function pg_temp.ack(n integer,key_no integer default 100,body jsonb default null) returns jsonb language sql as $$select public.api_network_handoff_acknowledge(pg_temp.hash(key_no),'network-handoffs',pg_temp.id(60),coalesce(body,pg_temp.body(n)))$$;
create temporary table events(n integer,body jsonb);
grant all on events to service_role;
set local role service_role;
select throws_ok($$select pg_temp.ack(200,101)$$,'MQ403',null,'all thirteen prior scopes grant no network writes');
select throws_ok($$select public.api_network_handoff_acknowledgements(pg_temp.hash(103),'network-handoffs',pg_temp.id(60))$$,'MQ403',null,'report scope grants no history');
select throws_ok($$select pg_temp.ack(200,102)$$,'MQ404',null,'foreign package hidden');
select throws_ok($$select pg_temp.ack(200,999)$$,'MQ401',null,'unknown credential denied');
select throws_ok($$select public.api_network_handoff_acknowledge(pg_temp.hash(100),'items',pg_temp.id(60),pg_temp.body(200))$$,'MQ404',null,'resource allowlist');
select throws_ok($$select public.api_transfer_handoff_acknowledge(pg_temp.hash(100),'transfer-handoffs',pg_temp.id(60),pg_temp.body(200))$$,'MQ403',null,'network grants no other family access');
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
select throws_ok($$select public.api_network_handoff_acknowledge(pg_temp.hash(100),'network-handoff-batches',pg_temp.id(70),pg_temp.body(200))$$,'MQ409',null,'UUID namespace spans singles and batches');
insert into events values(3,public.api_network_handoff_acknowledge(pg_temp.hash(100),'network-handoff-batches',pg_temp.id(70),pg_temp.body(202)));
select is(jsonb_array_length(public.api_network_handoff_acknowledgements(pg_temp.hash(100),'network-handoffs',pg_temp.id(60))->'data'),2,'batch report never propagates to handoff');
select is(jsonb_array_length(public.api_network_handoff_acknowledgements(pg_temp.hash(100),'network-handoff-batches',pg_temp.id(70))->'data'),1,'handoff reports never propagate to batch');
select throws_ok(format('select public.api_network_handoff_acknowledgements(pg_temp.hash(100),%L,pg_temp.id(70),%L)','network-handoff-batches',(select body#>>'{data,id}' from events where n=1)),'MQ404',null,'event detail bound to parent');
select throws_ok($$select public.api_network_handoff_acknowledgements(pg_temp.hash(102),'network-handoffs',pg_temp.id(60))$$,'MQ404',null,'foreign history hidden');
insert into events values(4,public.api_network_handoff_acknowledgements(pg_temp.hash(100),'network-handoffs',pg_temp.id(60),null,null,1));
select is(jsonb_array_length((select body->'data' from events where n=4)),1,'bounded first page');
select is(jsonb_array_length(public.api_network_handoff_acknowledgements(pg_temp.hash(100),'network-handoffs',pg_temp.id(60),null,(select body->>'next_cursor' from events where n=4),1)->'data'),1,'second history page');
select throws_ok(format('select public.api_network_handoff_acknowledgements(pg_temp.hash(100),%L,pg_temp.id(70),null,%L)','network-handoff-batches',(select body->>'next_cursor' from events where n=4)),'MQ422',null,'cursor bound to exact package');
select throws_ok($$select public.api_network_handoff_acknowledgements(pg_temp.hash(100),'network-handoffs',pg_temp.id(60),null,'broken',25)$$,'MQ422',null,'bad cursor refused');
select throws_ok($$select public.api_network_handoff_acknowledgements(pg_temp.hash(100),'network-handoffs',pg_temp.id(60),null,null,101)$$,'MQ422',null,'history bounded');
reset role;
select is((select count(*) from public.audit_log where organization_id=pg_temp.id(1) and table_name='network_handoff_acknowledgements' and operation='INSERT'),3::bigint,'only first creations audited');
select pg_temp.login(12,1);
set local role authenticated;
select is((select count(*) from public.network_handoff_acknowledgements),0::bigint,'no all-location access hides history and counts');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
set local role authenticated;
select is((select count(*) from public.network_handoff_acknowledgements),0::bigint,'warehouse alone insufficient');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));
set local role authenticated;
select is((select count(*) from public.network_handoff_acknowledgements),3::bigint,'all participating locations reveal history');
select throws_ok($$delete from public.network_handoff_acknowledgements$$,'42501',null,'browser cannot mutate history');
select pg_temp.login(11,2);
select is((select count(*) from public.network_handoff_acknowledgements),0::bigint,'other tenant cannot read history directly');
reset role;
select ok(not has_table_privilege(r,'public.network_handoff_acknowledgements','INSERT,UPDATE,DELETE'),'no direct writes for '||r)
from unnest(array['anon','authenticated','service_role','zeespare_worker','zeespare_simulation_worker']) r;
select ok(has_function_privilege(r,'public.api_network_handoff_acknowledge(bytea,text,uuid,jsonb)','execute')=(r='service_role'),'writer execute restricted for '||r)
from unnest(array['anon','authenticated','service_role','zeespare_worker','zeespare_simulation_worker']) r;
-- Deleting source ancestry removes single history, but retains the copied batch and its reports.
delete from public.network_allocation_scenarios where id=pg_temp.id(30);
select is((select count(*) from public.network_handoff_acknowledgements where handoff_id is not null),0::bigint,'single follows source deletion');
select is((select count(*) from public.network_handoff_acknowledgements where batch_id=pg_temp.id(70)),1::bigint,'copied batch report survives source deletion');
set local role service_role;
select lives_ok($$select public.api_network_handoff_acknowledge(pg_temp.hash(100),'network-handoff-batches',pg_temp.id(70),pg_temp.body(203))$$,'retained batch accepts new reports');
select is(public.api_network_handoff_acknowledge(pg_temp.hash(103),'network-handoff-batches',pg_temp.id(70),pg_temp.body(203))->>'replayed','true','retained batch retry stable');
select throws_ok($$select pg_temp.ack(204)$$,'MQ404',null,'deleted handoff cannot receive reports');
reset role;
delete from public.locations where id=pg_temp.id(21);
select is((select count(*) from public.network_handoff_acknowledgements where organization_id=pg_temp.id(1)),0::bigint,'participating location deletion cascades parent and reports');
select is((select count(*) from public.audit_log where organization_id=pg_temp.id(1) and table_name='network_handoff_acknowledgements' and operation='DELETE'),4::bigint,'all actual-parent cascade deletes audited');
select * from finish();
rollback;
