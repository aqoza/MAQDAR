begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('98000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
create function pg_temp.compare(day date default '2026-10-10',basis text default 'calculated',override_id uuid default null) returns jsonb language sql as $$select public.policy_stock_comparison(pg_temp.id(1),pg_temp.id(50),day,basis,override_id)$$;
insert into auth.users(id,email) select pg_temp.id(n),'draft-'||n||'@test.local' from generate_series(10,14) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'draft-a','Draft A'),(pg_temp.id(2),'draft-b','Draft B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),
 (pg_temp.id(1),pg_temp.id(12),'branch_user'),(pg_temp.id(2),pg_temp.id(13),'owner');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone)
 select pg_temp.id(20+n),pg_temp.id(case when n=2 then 2 else 1 end),'L'||n,'Location','branch','SA','Asia/Riyadh' from generate_series(0,2) n;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
 values(pg_temp.id(100),pg_temp.id(1),'ITEM','Item','Test','SET',99,'SAR');
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(20),'2026-10-10',12,2,1.125,'KWD','EA'),
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(20),'2026-10-11',999,0,1,'SAR','EA');
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 select pg_temp.id(30+n),pg_temp.id(case when n=2 then 2 else 1 end),pg_temp.id(20+n),pg_temp.id(40+n),
 '2026-01-01','2026-10-10','policy','succeeded','{}',now(),'{}' from generate_series(0,2) n;
insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
 select pg_temp.id(50+n),pg_temp.id(case when n=2 then 2 else 1 end),pg_temp.id(30+n),pg_temp.id(20+n),pg_temp.id(200+n),pg_temp.id(100),'SAVED','EA','available',
 '{"protection":{"target":"20.000"}}',
 '{"options":{"lead_time":3,"review_interval":4},"forecast":{"to_date":"2026-10-10","method":"baseline-v1","source":{"unit_provenance":{"method":"source-units-v1","status":"consistent","unit":"EA","rows":1,"unknown_rows":0,"units":["EA"]}}}}' from generate_series(0,2) n;
insert into public.policy_overrides(id,organization_id,policy_id,location_id,revision,request_id,submitted_by,reorder_point,order_up_to,reason,status,decided_by,decided_at,decision_reason,decision_request_id)
 select pg_temp.id(60+n),pg_temp.id(1),pg_temp.id(50),pg_temp.id(20),n,pg_temp.id(70+n),pg_temp.id(10),1,20+n,'Scenario',
 'approved',pg_temp.id(11),now(),'Approved scenario',pg_temp.id(80+n) from generate_series(1,2) n;
insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90)
values(pg_temp.id(110),pg_temp.id(1),'SUP','Supplier','SA','SAR',3,3);
insert into public.open_orders(id,organization_id,order_code,line_code,item_id,location_id,supplier_id,expected_date,quantity,unit_cost,currency,status,unit_of_measure) values
 (pg_temp.id(120),pg_temp.id(1),'O1','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-09',3.250,1,'SAR','open','EA'),
 (pg_temp.id(121),pg_temp.id(1),'O2','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-18',2.750,1,'SAR','open','EA'),
 (pg_temp.id(122),pg_temp.id(1),'CLOSED','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-12',999,1,'SAR','closed',null),
 (pg_temp.id(123),pg_temp.id(1),'ZERO','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-12',0,1,'SAR','open',null),
 (pg_temp.id(124),pg_temp.id(1),'CANCELED','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-12',999,1,'SAR','canceled','KG');
insert into public.receipts(organization_id,receipt_code,line_code,item_id,location_id,supplier_id,receipt_date,quantity,unit_cost,currency)
values(pg_temp.id(1),'REC','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-10',100,1,'SAR');
create temporary table fixture(draft_id uuid,report jsonb,scenario_id uuid);
grant all on fixture to authenticated;
select pg_temp.login(10,1);
set local role authenticated;

insert into fixture(draft_id) select public.replenishment_save(pg_temp.id(1),pg_temp.id(50),pg_temp.id(300),'calculated',null,'4',true,
  public.replenishment_preview(pg_temp.id(1),pg_temp.id(50),'calculated',null,'4',true)->>'fingerprint');
insert into public.supplier_items(id,organization_id,supplier_id,item_id,lead_time_days,min_order_quantity,pack_size,unit_price,currency,unit_of_measure)
values(pg_temp.id(130),pg_temp.id(1),pg_temp.id(110),pg_temp.id(100),3,10,6,1,'SAR','EA');
reset role;

set local role authenticated;
update fixture set scenario_id=public.supplier_scenario_save(pg_temp.id(1),draft_id,'SUP',true,pg_temp.id(400),
 public.supplier_scenario_preview(pg_temp.id(1),draft_id,'SUP',true)->>'fingerprint');
reset role;
insert into public.work_calendars(id,organization_id,code,name_en,country_code,weekend_days,observe_public_holidays)
values(pg_temp.id(500),pg_temp.id(1),'SEND','Sending','SA','{}'::smallint[],false),
 (pg_temp.id(501),pg_temp.id(1),'RECEIVE','Receiving','SA','{}'::smallint[],false);
update public.suppliers set work_calendar_id=pg_temp.id(500) where id=pg_temp.id(110);
update public.locations set work_calendar_id=pg_temp.id(501) where id=pg_temp.id(20);
alter table fixture add delivery_id uuid;

set local role authenticated;
update fixture set delivery_id=public.delivery_scenario_save(pg_temp.id(1),scenario_id,'2026-10-10',true,pg_temp.id(600),
 public.delivery_scenario_preview(pg_temp.id(1),scenario_id,'2026-10-10',true)->>'fingerprint');
reset role;
alter table fixture add estimate_id uuid;
create function pg_temp.preview(confirmed boolean default true) returns jsonb language sql as $$select public.purchase_cost_preview(pg_temp.id(1),(select delivery_id from fixture),confirmed)$$;
create function pg_temp.save(request integer default 800,fingerprint text default null,confirmed boolean default true) returns uuid language sql as $$select public.purchase_cost_save(pg_temp.id(1),(select delivery_id from fixture),confirmed,pg_temp.id(request),coalesce(fingerprint,pg_temp.preview(confirmed)->>'fingerprint'))$$;
set local role authenticated;

update public.supplier_items set valid_from='2026-10-10',unit_price=1.005 where id=pg_temp.id(130);
update fixture set estimate_id=pg_temp.save(),report=pg_temp.preview();
reset role;
insert into public.memberships(organization_id,user_id,role) values(pg_temp.id(1),pg_temp.id(14),'approver');
alter table fixture add proposal_id uuid;
create function pg_temp.propose(request integer default 900,why text default 'Plan purchase') returns uuid language sql as $$select public.purchase_proposal_submit(pg_temp.id(1),(select estimate_id from fixture),pg_temp.id(request),why)$$;
create function pg_temp.decide(decision text,request integer default 950,why text default 'Reviewed') returns uuid language sql as $$select public.purchase_proposal_decide(pg_temp.id(1),(select proposal_id from fixture),pg_temp.id(request),decision,why)$$;
set local role authenticated;
update fixture set proposal_id=pg_temp.propose();
create function pg_temp.handoff() returns uuid language sql as $$select public.purchase_handoff_create(pg_temp.id(1),(select proposal_id from fixture))$$;

select pg_temp.login(14,1);
select pg_temp.decide('approved');
select pg_temp.login(10,1);
reset role;
alter table fixture add handoff_id uuid;
set local role authenticated;
update fixture set handoff_id=pg_temp.handoff();
reset role;

-- Build real, independently approved evidence chains with distinct items and optional differing units/lead times.
create function pg_temp.line(n integer,u text default 'EA',lead integer default 3,duplicate boolean default false) returns uuid language plpgsql as $$
declare item uuid:=case when duplicate then pg_temp.id(100) else pg_temp.id(10000+n) end;
  run uuid:=pg_temp.id(20000+n); policy uuid:=pg_temp.id(30000+n);
  draft uuid; scenario uuid; delivery uuid; estimate uuid; proposal uuid; report jsonb; evidence jsonb;
begin
  if not duplicate then
    insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
      values(item,pg_temp.id(1),'ITEM-'||n,'Item','Test',u,1,'SAR');
    insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
      values(pg_temp.id(1),item,pg_temp.id(20),'2026-10-10',12,2,1,'SAR',u);
    insert into public.supplier_items(organization_id,supplier_id,item_id,lead_time_days,min_order_quantity,pack_size,unit_price,currency,unit_of_measure,valid_from)
      values(pg_temp.id(1),pg_temp.id(110),item,lead,10,6,1.005,'SAR',u,'2026-10-10');
  end if;
  insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
    values(run,pg_temp.id(1),pg_temp.id(20),gen_random_uuid(),'2026-01-01','2026-10-10','policy','succeeded','{}',now(),'{}');
  select p.evidence into evidence from public.inventory_policies p where id=pg_temp.id(50);
  evidence:=jsonb_set(evidence,'{options,lead_time}',to_jsonb(lead));
  evidence:=jsonb_set(evidence,'{forecast,source,unit_provenance}',jsonb_build_object('method','source-units-v1','status','consistent','unit',u,'rows',1,'unknown_rows',0,'units',jsonb_build_array(u)));
  insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
    values(policy,pg_temp.id(1),run,pg_temp.id(20),gen_random_uuid(),item,case when duplicate then 'ITEM' else 'ITEM-'||n end,u,'available','{"protection":{"target":"20.000"}}',evidence);
  perform pg_temp.login(10,1);
  report:=public.replenishment_preview(pg_temp.id(1),policy,'calculated',null,'4',true);
  draft:=public.replenishment_save(pg_temp.id(1),policy,gen_random_uuid(),'calculated',null,'4',true,report->>'fingerprint');
  report:=public.supplier_scenario_preview(pg_temp.id(1),draft,'SUP',true);
  scenario:=public.supplier_scenario_save(pg_temp.id(1),draft,'SUP',true,gen_random_uuid(),report->>'fingerprint');
  report:=public.delivery_scenario_preview(pg_temp.id(1),scenario,'2026-10-10',true);
  delivery:=public.delivery_scenario_save(pg_temp.id(1),scenario,'2026-10-10',true,gen_random_uuid(),report->>'fingerprint');
  report:=public.purchase_cost_preview(pg_temp.id(1),delivery,true);
  estimate:=public.purchase_cost_save(pg_temp.id(1),delivery,true,gen_random_uuid(),report->>'fingerprint');
  proposal:=public.purchase_proposal_submit(pg_temp.id(1),estimate,gen_random_uuid(),'Reason');
  perform pg_temp.login(14,1);
  perform public.purchase_proposal_decide(pg_temp.id(1),proposal,gen_random_uuid(),'approved','Independent review');
  perform pg_temp.login(10,1);
  return public.purchase_handoff_create(pg_temp.id(1),proposal);
end; $$;

-- Reuse the real evidence-chain setup above; API tests start here.
create temporary table lines(n integer,id uuid,original jsonb);
insert into lines values(0,(select handoff_id from fixture),null),(1,pg_temp.line(1),null),(2,pg_temp.line(2),null);
update lines set original=h.payload from public.purchase_handoffs h where h.id=lines.id;
create temporary table batches(id uuid,payload jsonb);
insert into batches(id) select public.purchase_handoff_batch_create(pg_temp.id(1),array_agg(id order by id)) from lines where n in(0,1);
update batches set payload=b.payload from public.purchase_handoff_batches b where b.id=batches.id;
-- Force timestamp ties to exercise the UUID tiebreak and inclusive lower bound.
update public.purchase_handoffs set created_at='2026-10-01T00:00:00Z' where organization_id=pg_temp.id(1);
create function pg_temp.hash(n integer) returns bytea language sql immutable as $$select decode(lpad(n::text,64,'0'),'hex')$$;
create function pg_temp.key(n integer,scopes text[] default array['purchase_handoffs:read'],org integer default 1) returns uuid language sql as $$select public.create_api_key(pg_temp.id(org),'Test key '||n,scopes,30,pg_temp.hash(n),'maqdar_sk_test','test')$$;
select pg_temp.login(10,1);
set local role authenticated;

select lives_ok($$select pg_temp.key(40,array['purchase_handoffs:read','purchase_handoffs:acknowledge'])$$,'owner can issue explicit acknowledgement scope');
select pg_temp.key(41);
select pg_temp.key(42,array['purchase_handoffs:acknowledge']);
select pg_temp.key(43,array['purchase_handoffs:acknowledge']);
select pg_temp.key(45,array['purchase_handoffs:acknowledge']);
select pg_temp.login(11,1);
select throws_ok($$select pg_temp.key(46,array['purchase_handoffs:acknowledge'])$$,'MQ403',null,'viewer cannot issue acknowledgement keys');
select pg_temp.login(14,1);
select throws_ok($$select pg_temp.key(46,array['purchase_handoffs:acknowledge'])$$,'MQ403',null,'approver cannot issue acknowledgement keys');
select pg_temp.login(13,2);
select pg_temp.key(44,array['purchase_handoffs:read','purchase_handoffs:acknowledge'],2);
reset role;
update public.api_keys set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where key_hash=pg_temp.hash(43);
update public.api_keys set revoked_at=now() where key_hash=pg_temp.hash(45);
create function pg_temp.body(n integer,status text default 'received',reason text default null) returns jsonb language sql as $$
select jsonb_build_object('client_event_id',pg_temp.id(n),'external_system','ERP test','external_reference','000123','status',status,'reason',reason)$$;
create function pg_temp.ack(n integer,key_no integer default 40,body jsonb default null) returns jsonb language sql as $$
select public.api_handoff_acknowledge(pg_temp.hash(key_no),'purchase-handoffs',(select id from lines where n=0),coalesce(body,pg_temp.body(n)))$$;
create temporary table events(n integer,body jsonb);
grant all on events to service_role;
grant select on lines,batches,fixture to service_role;
set local role service_role;
select throws_ok($$select pg_temp.ack(2000,41)$$,'MQ403',null,'read permission does not grant writes');
select throws_ok($$select public.api_handoff_acknowledgements(pg_temp.hash(42),'purchase-handoffs',(select id from lines where n=0))$$,'MQ403',null,'acknowledge permission does not grant reads');
select throws_ok($$select pg_temp.ack(2000,43)$$,'MQ401',null,'expired key denied');
select throws_ok($$select pg_temp.ack(2000,45)$$,'MQ401',null,'revoked key denied');
select throws_ok($$select pg_temp.ack(2000,99)$$,'MQ401',null,'unknown key denied');
select throws_ok($$select pg_temp.ack(2000,44)$$,'MQ404',null,'cross-tenant writes hidden');
select throws_ok($$select public.api_handoff_acknowledge(pg_temp.hash(40),'purchase-handoffs',pg_temp.id(999),pg_temp.body(2000))$$,'MQ404',null,'missing package hidden');
select throws_ok($$select public.api_handoff_acknowledge(pg_temp.hash(40),'items',(select id from lines where n=0),pg_temp.body(2000))$$,'MQ404',null,'resource allowlist');
select throws_ok($$select pg_temp.ack(2000,40,'[]')$$,'MQ422',null,'object body required');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000)||'{"unknown":1}')$$,'MQ422',null,'unknown fields refused');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000)||'{"external_system":null}')$$,'MQ422',null,'null text refused');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000)||'{"external_reference":" "}')$$,'MQ422',null,'blank reference refused');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000)||jsonb_build_object('external_reference',repeat('x',201)))$$,'MQ422',null,'reference bounded');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000)||'{"status":"accepted"}')$$,'MQ422',null,'unapproved status refused');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000,'rejected'))$$,'MQ422',null,'rejection requires a reason');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000,'rejected',' '))$$,'MQ422',null,'rejection reason nonblank');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000,'rejected',E'bad\nreason'))$$,'MQ422',null,'control characters refused');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000)||'{"client_event_id":"bad"}')$$,'MQ422',null,'invalid UUID refused');
insert into events values(1,pg_temp.ack(2000));
select is((select body->>'replayed' from events where n=1),'false','first event created');
select is((select body#>>'{data,external_reference}' from events where n=1),'000123','reference preserves leading zeros');
insert into events values(2,pg_temp.ack(2000,42,pg_temp.body(2000)-'reason'));
select is((select body->>'replayed' from events where n=2),'true','retry works after key rotation and null omission');
select is((select body->'data' from events where n=2),(select body->'data' from events where n=1),'retry retains identity, original key and recording time');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000,'rejected','Unknown item'))$$,'MQ409',null,'changed report conflicts');
select throws_ok($$select public.api_handoff_acknowledge(pg_temp.hash(40),'purchase-handoff-batches',(select id from batches),pg_temp.body(2000))$$,'MQ409',null,'event identity is organization-wide across targets');
insert into events values(3,pg_temp.ack(2001,40,pg_temp.body(2001,'rejected','Unknown item')));
select is(public.api_handoff_acknowledgements(pg_temp.hash(40),'purchase-handoffs',(select id from lines where n=0),(select (body#>>'{data,id}')::uuid from events where n=1))->'data',(select body->'data' from events where n=1),'read original event');
select throws_ok($$select public.api_handoff_acknowledgements(pg_temp.hash(40),'purchase-handoffs',(select id from lines where n=1),(select (body#>>'{data,id}')::uuid from events where n=1))$$,'MQ404',null,'event must belong to parent');
select throws_ok($$select public.api_handoff_acknowledgements(pg_temp.hash(44),'purchase-handoffs',(select id from lines where n=0))$$,'MQ404',null,'cross-tenant history denied');
select throws_ok($$select public.api_handoff_acknowledgements(pg_temp.hash(40),'purchase-handoffs',(select id from lines where n=0),null,null,101)$$,'MQ422',null,'bounded list backstop');
reset role;
select is((select count(*) from public.purchase_handoff_acknowledgements),2::bigint,'retries and failures add no extra event');
select is((select count(*) from public.audit_log where table_name='purchase_handoff_acknowledgements'),2::bigint,'one audit entry per new event');
update public.purchase_handoff_acknowledgements set recorded_at=statement_timestamp()-interval '1 hour';
create temporary table pages(n integer,body jsonb);
grant all on pages to service_role;
set local role service_role;
insert into pages values(1,public.api_handoff_acknowledgements(pg_temp.hash(40),'purchase-handoffs',(select id from lines where n=0),null,null,1));
insert into pages values(2,public.api_handoff_acknowledgements(pg_temp.hash(40),'purchase-handoffs',(select id from lines where n=0),null,(select body->>'next_cursor' from pages where n=1),1));
select is((select count(distinct body#>>'{data,0,id}') from pages),2::bigint,'timestamp ties traverse distinct events');
select is((select body->>'next_cursor' from pages where n=2),null,'last page ends');
select is((select count(distinct body->>'as_of') from pages),1::bigint,'paging time bound retained');
select throws_ok($$select public.api_handoff_acknowledgements(pg_temp.hash(40),'purchase-handoffs',(select id from lines where n=1),null,(select body->>'next_cursor' from pages where n=1),1)$$,'MQ422',null,'cursor binds parent');
select throws_ok($$select public.api_handoff_acknowledgements(pg_temp.hash(40),'purchase-handoff-batches',(select id from batches),null,(select body->>'next_cursor' from pages where n=1),1)$$,'MQ422',null,'cursor binds resource');
select throws_ok($$select public.api_handoff_acknowledgements(pg_temp.hash(40),'purchase-handoffs',(select id from lines where n=0),null,'bad',1)$$,'MQ422',null,'malformed cursor refused');
select is(jsonb_array_length(public.api_handoff_acknowledgements(pg_temp.hash(40),'purchase-handoff-batches',(select id from batches))->'data'),0,'individual reports do not propagate to batch');
select lives_ok($$select public.api_handoff_acknowledge(pg_temp.hash(40),'purchase-handoff-batches',(select id from batches),pg_temp.body(2002))$$,'batch report accepted');
select is(jsonb_array_length(public.api_handoff_acknowledgements(pg_temp.hash(40),'purchase-handoffs',(select id from lines where n=1))->'data'),0,'batch report does not propagate to its other member');
select throws_ok($$update public.purchase_handoff_acknowledgements set reason='changed'$$,'42501',null,'service role cannot directly change events');
reset role;
select pg_temp.login(11,1);
set local role authenticated;
select is((select count(*) from public.purchase_handoff_acknowledgements),3::bigint,'viewer reads own organization history');
select throws_ok($$delete from public.purchase_handoff_acknowledgements$$,'42501',null,'members cannot delete history');
select throws_ok($$select pg_temp.ack(2003)$$,'42501',null,'members cannot call service RPC');
select pg_temp.login(12,1);
select is((select count(*) from public.purchase_handoff_acknowledgements),0::bigint,'branch cannot read another location');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
set local role authenticated;
select is((select count(*) from public.purchase_handoff_acknowledgements),3::bigint,'branch reads assigned location');
select pg_temp.login(13,2);
select is((select count(*) from public.purchase_handoff_acknowledgements),0::bigint,'other tenant cannot read member history');
reset role;
select pg_temp.login(10,1);
set local role authenticated;
update fixture set proposal_id=pg_temp.propose(901);
select pg_temp.login(14,1);
select pg_temp.decide('approved',951);
reset role;
update public.supplier_items set unit_price=2 where organization_id=pg_temp.id(1);
set local role service_role;
select lives_ok($$select pg_temp.ack(2003)$$,'historical package accepts later reports despite changed prices');
select is(public.api_handoff_get(pg_temp.hash(40),'purchase-handoffs',id)#>'{data,payload}',original,'individual saved evidence unchanged') from lines;
select is(public.api_handoff_get(pg_temp.hash(40),'purchase-handoff-batches',id)#>'{data,payload}',payload,'batch saved evidence unchanged') from batches;
reset role;
update public.memberships set role='planner' where organization_id=pg_temp.id(1) and user_id=pg_temp.id(10);
set local role service_role;
select throws_ok($$select pg_temp.ack(2000)$$,'MQ401',null,'creator authority checked even for identical retry');
reset role;
select is((select count(*) from public.open_orders where organization_id=pg_temp.id(1)),5::bigint,'reports add no inbound orders');
select is((select count(*) from public.receipts where organization_id=pg_temp.id(1)),1::bigint,'reports add no receipts');
select is((select count(*) from public.stock_snapshots where organization_id=pg_temp.id(1)),4::bigint,'reports add no stock snapshots');
select * from finish();
rollback;
