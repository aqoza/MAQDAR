begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('bc25a000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer default 1) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'regional-review-'||n||'@test.local' from generate_series(10,16) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'regional-review-a','Redistribution A'),(pg_temp.id(2),'regional-review-b','Redistribution B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),
 (pg_temp.id(1),pg_temp.id(12),'branch_user'),(pg_temp.id(2),pg_temp.id(13),'owner'),
 (pg_temp.id(1),pg_temp.id(14),'planner'),(pg_temp.id(1),pg_temp.id(15),'admin'),(pg_temp.id(1),pg_temp.id(16),'approver');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone)
 select pg_temp.id(20+n),pg_temp.id(case when n=3 then 2 else 1 end),'L'||n,'Location','branch','SA','Asia/Riyadh' from generate_series(0,3) n;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
 values(pg_temp.id(100),pg_temp.id(1),'ITEM','Item','Test','SET',99,'SAR'),(pg_temp.id(101),pg_temp.id(1),'OTHER','Other','Test','EA',1,'SAR');
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(20),'2026-10-10',12,2,1,'SAR','EA'),
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(21),'2026-10-10',35.125,2.250,1,'SAR','EA'),
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(21),'2026-10-11',999,0,1,'SAR','EA');
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 select pg_temp.id(30+n),pg_temp.id(case when n=3 then 2 else 1 end),pg_temp.id(20+n),pg_temp.id(40+n),
 '2026-01-01','2026-10-10','policy','succeeded','{}',now(),'{}' from generate_series(0,3) n;
insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
 select pg_temp.id(50+n),pg_temp.id(case when n=3 then 2 else 1 end),pg_temp.id(30+n),pg_temp.id(20+n),pg_temp.id(200+n),pg_temp.id(100),'SAVED','EA','available',
 '{"protection":{"target":"20.000"}}',
 '{"options":{"lead_time":10,"review_interval":4},"forecast":{"to_date":"2026-10-10","method":"baseline-v1","source":{"unit_provenance":{"method":"source-units-v1","status":"consistent","unit":"EA","rows":1,"unknown_rows":0,"units":["EA"]}}}}' from generate_series(0,3) n;
insert into public.policy_overrides(id,organization_id,policy_id,location_id,revision,request_id,submitted_by,reorder_point,order_up_to,reason,status,decided_by,decided_at,decision_reason,decision_request_id)
 select pg_temp.id(60+n),pg_temp.id(1),pg_temp.id(51),pg_temp.id(21),n,pg_temp.id(70+n),pg_temp.id(10),1,20+n,'Scenario',
 'approved',pg_temp.id(11),now(),'Approved scenario',pg_temp.id(80+n) from generate_series(1,2) n;
insert into public.network_links(id,organization_id,from_location_id,to_location_id,lead_time_days_p50,lead_time_days_p90,freight_basis)
 values(pg_temp.id(90),pg_temp.id(1),pg_temp.id(21),pg_temp.id(20),2,4,'none');
insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90)
values(pg_temp.id(110),pg_temp.id(1),'SUP','Supplier','SA','SAR',3,3);
insert into public.open_orders(organization_id,order_code,line_code,item_id,location_id,supplier_id,expected_date,quantity,unit_cost,currency,status,unit_of_measure) values
 (pg_temp.id(1),'OVERDUE','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-09',1.250,1,'SAR','open','EA'),
 (pg_temp.id(1),'LATE','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-18',0.750,1,'SAR','open','EA'),
 (pg_temp.id(1),'SOURCE','1',pg_temp.id(100),pg_temp.id(21),pg_temp.id(110),'2026-10-10',999,1,'SAR','open','EA');
create temporary table captured(draft_id uuid,report jsonb,id uuid);
grant all on captured to authenticated;
set local role authenticated;
select pg_temp.login(10);
insert into captured(draft_id) select public.replenishment_save(pg_temp.id(1),pg_temp.id(50),pg_temp.id(300),'calculated',null,'4',true,
  public.replenishment_preview(pg_temp.id(1),pg_temp.id(50),'calculated',null,'4',true)->>'fingerprint');
reset role;

insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
values(pg_temp.id(1),pg_temp.id(100),pg_temp.id(22),'2026-10-10',37,0,1,'SAR','EA');
insert into public.network_links(organization_id,from_location_id,to_location_id,lead_time_days_p50,lead_time_days_p90,freight_basis)
values(pg_temp.id(1),pg_temp.id(22),pg_temp.id(20),2,4,'none');
create temporary table sourcing(input jsonb,report jsonb,id uuid);
grant all on sourcing to authenticated;
select pg_temp.login(10);set local role authenticated;
insert into sourcing(input) select jsonb_build_object(
 'region_id',public.stock_region_save(pg_temp.id(1),'{"name_en":"Sourcing region","location_codes":["L0","L1","L2"],"confirmed":true}',pg_temp.id(500),
 public.stock_region_preview(pg_temp.id(1),'{"name_en":"Sourcing region","location_codes":["L0","L1","L2"],"confirmed":true}')->>'fingerprint'),
 'draft_id',draft_id,'commitments_confirmed',true,'lanes_confirmed',true,
 'sources',jsonb_build_array(jsonb_build_object('location_id',pg_temp.id(22),'policy_id',pg_temp.id(52),'maximum','calculated','backorders','0'),
 jsonb_build_object('location_id',pg_temp.id(21),'policy_id',pg_temp.id(51),'maximum','calculated','backorders','4.125'))) from captured;
create function pg_temp.preview(overrides jsonb default '{}') returns jsonb language sql as $$select public.regional_sourcing_preview(pg_temp.id(1),input||overrides) from sourcing$$;
create function pg_temp.save(n integer default 600,overrides jsonb default '{}',fingerprint text default null) returns uuid language sql as $$select public.regional_sourcing_save(pg_temp.id(1),input||overrides,pg_temp.id(n),coalesce(fingerprint,report->>'fingerprint')) from sourcing$$;
update sourcing set report=pg_temp.preview();
update sourcing set id=pg_temp.save();
reset role;
insert into public.work_calendars(id,organization_id,code,name_en,country_code,weekend_days,observe_public_holidays)
values(pg_temp.id(700),pg_temp.id(1),'DATES','Dates','SA',array[6,7],false);
update public.locations set work_calendar_id=pg_temp.id(700) where organization_id=pg_temp.id(1);
create temporary table dates(report jsonb,id uuid);
grant all on dates to authenticated;
create function pg_temp.date_preview(requested date default '2026-10-10',confirmed boolean default true) returns jsonb language sql as $$select public.regional_date_preview(pg_temp.id(1),id,requested,confirmed) from sourcing$$;
create function pg_temp.date_save(n integer default 800,fingerprint text default null) returns uuid language sql as $$select public.regional_date_save(pg_temp.id(1),s.id,'2026-10-10',true,pg_temp.id(n),coalesce(fingerprint,d.report->>'fingerprint')) from sourcing s cross join dates d$$;
set local role authenticated;
insert into dates(report) select pg_temp.date_preview();
update dates set id=pg_temp.date_save();
reset role;
update public.network_links set freight_basis='per_shipment',freight_cost=1.005,currency='SAR',freight_valid_from='2026-10-12' where organization_id=pg_temp.id(1);
create temporary table freight(report jsonb,id uuid);
grant all on freight to authenticated;
create function pg_temp.freight_preview(confirmed boolean default true) returns jsonb language sql as $$select public.regional_freight_preview(pg_temp.id(1),id,confirmed) from dates$$;
create function pg_temp.freight_save(n integer default 900,fingerprint text default null) returns uuid language sql as $$select public.regional_freight_save(pg_temp.id(1),d.id,true,pg_temp.id(n),coalesce(fingerprint,f.report->>'fingerprint')) from dates d cross join freight f$$;
set local role authenticated;
insert into freight(report) select pg_temp.freight_preview();
update freight set id=pg_temp.freight_save();
create temporary table proposals(id uuid);
grant all on proposals to authenticated;
create function pg_temp.submit(n integer default 950) returns uuid language sql as $$select public.regional_transfer_submit(pg_temp.id(1),id,pg_temp.id(n),'Whole regional proposal') from freight$$;
insert into proposals select pg_temp.submit();

select pg_temp.login(16);
select public.regional_transfer_decide(pg_temp.id(1),(select id from proposals),pg_temp.id(963),'approved','Independent review');
select pg_temp.login(10);
create temporary table exports(id uuid);grant all on exports to authenticated;
insert into exports select public.regional_handoff_create(pg_temp.id(1),(select id from proposals));
create temporary table batches(id uuid); grant all on batches to authenticated,service_role;
grant select on exports to service_role;
insert into batches select public.regional_handoff_batch_create(pg_temp.id(1),array[(select id from exports)]);
reset role;
-- Reports must not change stock, inbound, policies or planning execution.
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
select lives_ok($$select pg_temp.key(100,array['regional_handoffs:read','regional_handoffs:acknowledge'])$$,'owner explicitly issues report scope');
select pg_temp.key(101,array['master_data:read','master_data:write','transactions:read','transactions:write','purchase_handoffs:read','purchase_handoffs:acknowledge','transfer_handoffs:read','transfer_handoffs:acknowledge','event_purchase_handoffs:read','event_purchase_handoffs:acknowledge','excess_disposition_handoffs:read','excess_disposition_handoffs:acknowledge','network_handoffs:read','network_handoffs:acknowledge','regional_handoffs:read']);
select pg_temp.key(103,array['regional_handoffs:acknowledge']);
select pg_temp.login(13,2);
select pg_temp.key(102,array['regional_handoffs:read','regional_handoffs:acknowledge'],2);
select pg_temp.login(12,1);
select throws_ok($$select pg_temp.key(104,array['regional_handoffs:acknowledge'])$$,'MQ403',null,'branch member cannot issue report keys');
reset role;
create function pg_temp.body(n integer,status text default 'received',reason text default null) returns jsonb language sql as $$select jsonb_build_object('client_event_id',pg_temp.id(n),'external_system','ERP','external_reference','000123','status',status,'reason',reason)$$;
create function pg_temp.ack(n integer,key_no integer default 100,body jsonb default null) returns jsonb language sql as $$select public.api_regional_handoff_acknowledge(pg_temp.hash(key_no),'regional-handoffs',(select id from exports),coalesce(body,pg_temp.body(n)))$$;
create temporary table events(n integer,body jsonb);
grant all on events to service_role;
set local role service_role;
select throws_ok($$select pg_temp.ack(200,101)$$,'MQ403',null,'all fifteen prior scopes grant no regional writes');
select throws_ok($$select public.api_regional_handoff_acknowledgements(pg_temp.hash(103),'regional-handoffs',(select id from exports))$$,'MQ403',null,'report scope grants no history');
select throws_ok($$select pg_temp.ack(200,102)$$,'MQ404',null,'foreign package hidden');
select throws_ok($$select pg_temp.ack(200,999)$$,'MQ401',null,'unknown credential denied');
select throws_ok($$select public.api_regional_handoff_acknowledge(pg_temp.hash(100),'items',(select id from exports),pg_temp.body(200))$$,'MQ404',null,'resource allowlist');
select throws_ok($$select public.api_transfer_handoff_acknowledge(pg_temp.hash(100),'transfer-handoffs',(select id from exports),pg_temp.body(200))$$,'MQ403',null,'regional grants no other family access');
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
select throws_ok($$select public.api_regional_handoff_acknowledge(pg_temp.hash(100),'regional-handoff-batches',(select id from batches),pg_temp.body(200))$$,'MQ409',null,'UUID namespace spans singles and batches');
insert into events values(3,public.api_regional_handoff_acknowledge(pg_temp.hash(100),'regional-handoff-batches',(select id from batches),pg_temp.body(202)));
select is(jsonb_array_length(public.api_regional_handoff_acknowledgements(pg_temp.hash(100),'regional-handoffs',(select id from exports))->'data'),2,'batch report never propagates to handoff');
select is(jsonb_array_length(public.api_regional_handoff_acknowledgements(pg_temp.hash(100),'regional-handoff-batches',(select id from batches))->'data'),1,'handoff reports never propagate to batch');
select throws_ok(format('select public.api_regional_handoff_acknowledgements(pg_temp.hash(100),%L,(select id from batches),%L)','regional-handoff-batches',(select body#>>'{data,id}' from events where n=1)),'MQ404',null,'event detail bound to parent');
select throws_ok($$select public.api_regional_handoff_acknowledgements(pg_temp.hash(102),'regional-handoffs',(select id from exports))$$,'MQ404',null,'foreign history hidden');
insert into events values(4,public.api_regional_handoff_acknowledgements(pg_temp.hash(100),'regional-handoffs',(select id from exports),null,null,1));
select is(jsonb_array_length((select body->'data' from events where n=4)),1,'bounded first page');
select is(jsonb_array_length(public.api_regional_handoff_acknowledgements(pg_temp.hash(100),'regional-handoffs',(select id from exports),null,(select body->>'next_cursor' from events where n=4),1)->'data'),1,'second history page');
select throws_ok(format('select public.api_regional_handoff_acknowledgements(pg_temp.hash(100),%L,(select id from batches),null,%L)','regional-handoff-batches',(select body->>'next_cursor' from events where n=4)),'MQ422',null,'cursor bound to exact package');
select throws_ok($$select public.api_regional_handoff_acknowledgements(pg_temp.hash(100),'regional-handoffs',(select id from exports),null,'broken',25)$$,'MQ422',null,'bad cursor refused');
select throws_ok($$select public.api_regional_handoff_acknowledgements(pg_temp.hash(100),'regional-handoffs',(select id from exports),null,null,101)$$,'MQ422',null,'history bounded');
reset role;
select is((select count(*) from public.audit_log where organization_id=pg_temp.id(1) and table_name='regional_handoff_acknowledgements' and operation='INSERT'),3::bigint,'only first creations audited');
select pg_temp.login(12,1);
set local role authenticated;
select is((select count(*) from public.regional_handoff_acknowledgements),0::bigint,'no all-location access hides history and counts');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20)) on conflict do nothing;
set local role authenticated;
select is((select count(*) from public.regional_handoff_acknowledgements),0::bigint,'destination alone insufficient');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21)),(pg_temp.id(1),pg_temp.id(12),pg_temp.id(22));
set local role authenticated;
select is((select count(*) from public.regional_handoff_acknowledgements),3::bigint,'all participating locations reveal history');
select throws_ok($$delete from public.regional_handoff_acknowledgements$$,'42501',null,'browser cannot mutate history');
select pg_temp.login(13,2);
select is((select count(*) from public.regional_handoff_acknowledgements),0::bigint,'other tenant cannot read history directly');
reset role;
select ok(not has_table_privilege(r,'public.regional_handoff_acknowledgements','INSERT,UPDATE,DELETE'),'no direct writes for '||r)
from unnest(array['anon','authenticated','service_role','zeespare_worker','zeespare_simulation_worker']) r;
select ok(has_function_privilege(r,'public.api_regional_handoff_acknowledge(bytea,text,uuid,jsonb)','execute')=(r='service_role'),'writer execute restricted for '||r)
from unnest(array['anon','authenticated','service_role','zeespare_worker','zeespare_simulation_worker']) r;
-- Deleting source ancestry removes single history, but retains the copied batch and its reports.
select is(pg_temp.operational_state(),(select evidence from original_operational_state),'reports and retries leave stock, inbound, policies and planning runs unchanged');
delete from public.regional_sourcing_scenarios where id=(select id from sourcing);
select is((select count(*) from public.regional_handoff_acknowledgements where handoff_id is not null),0::bigint,'single follows source deletion');
select is((select count(*) from public.regional_handoff_acknowledgements where batch_id=(select id from batches)),1::bigint,'copied batch report survives source deletion');
set local role service_role;
select lives_ok($$select public.api_regional_handoff_acknowledge(pg_temp.hash(100),'regional-handoff-batches',(select id from batches),pg_temp.body(203))$$,'retained batch accepts new reports');
select is(public.api_regional_handoff_acknowledge(pg_temp.hash(103),'regional-handoff-batches',(select id from batches),pg_temp.body(203))->>'replayed','true','retained batch retry stable');
select throws_ok($$select pg_temp.ack(204)$$,'MQ404',null,'deleted handoff cannot receive reports');
reset role;
-- Remove synthetic operational references before exercising actual location deletion.
delete from public.stock_snapshots where organization_id=pg_temp.id(1) and location_id=pg_temp.id(21);
delete from public.open_orders where organization_id=pg_temp.id(1) and location_id=pg_temp.id(21);
delete from public.network_links where organization_id=pg_temp.id(1) and (from_location_id=pg_temp.id(21) or to_location_id=pg_temp.id(21));
delete from public.planning_runs where organization_id=pg_temp.id(1) and location_id=pg_temp.id(21);
delete from public.locations where id=pg_temp.id(21);
select is((select count(*) from public.regional_handoff_acknowledgements where organization_id=pg_temp.id(1)),0::bigint,'participating location deletion cascades parent and reports');
select is((select count(*) from public.audit_log where organization_id=pg_temp.id(1) and table_name='regional_handoff_acknowledgements' and operation='DELETE'),4::bigint,'all actual-parent cascade deletes audited');
select * from finish();
rollback;
