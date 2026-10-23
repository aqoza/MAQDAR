begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('a8400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer default 1) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'transfer-dates-'||n||'@test.local' from generate_series(10,16) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'transfer-dates-a','Transfer Dates A'),(pg_temp.id(2),'transfer-dates-b','Transfer Dates B');
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
update captured set id=public.redistribution_save(pg_temp.id(1),draft_id,pg_temp.id(51),'calculated',null,'4.125',true,true,pg_temp.id(301),
  public.redistribution_preview(pg_temp.id(1),draft_id,pg_temp.id(51),'calculated',null,'4.125',true,true)->>'fingerprint');
reset role;
insert into public.work_calendars(id,organization_id,code,name_en,country_code,weekend_days,observe_public_holidays) values
 (pg_temp.id(500),pg_temp.id(1),'SOURCE','Synthetic source','SA',array[5,6]::smallint[],false),
 (pg_temp.id(501),pg_temp.id(1),'RECEIVER','Synthetic receiver','SA',array[5,6]::smallint[],false);
update public.locations set work_calendar_id=pg_temp.id(case when id=pg_temp.id(21) then 500 else 501 end) where organization_id=pg_temp.id(1);
insert into public.holiday_overrides(id,organization_id,work_calendar_id,starts_on,ends_on,kind,name_en) values
 (pg_temp.id(510),pg_temp.id(1),pg_temp.id(501),'2026-10-13','2026-10-13','closure','Receiving closure'),
 (pg_temp.id(511),pg_temp.id(1),pg_temp.id(501),'2026-10-15','2026-10-15','closure','Receiving closure');
create function pg_temp.preview(requested date default '2026-10-10',confirmed boolean default true)
returns jsonb language sql as $$select public.transfer_date_preview(pg_temp.id(1),(select id from captured),requested,confirmed)$$;
create function pg_temp.save(request integer default 600,fingerprint text default null,requested date default '2026-10-10',confirmed boolean default true)
returns uuid language sql as $$select public.transfer_date_save(pg_temp.id(1),(select id from captured),requested,confirmed,pg_temp.id(request),coalesce(fingerprint,pg_temp.preview(requested,confirmed)->>'fingerprint'))$$;
create temporary table saved_dates(id uuid,report jsonb);
grant all on saved_dates to authenticated;
set local role authenticated;
insert into saved_dates(id,report) select pg_temp.save(),pg_temp.preview();
reset role;
update public.network_links set freight_basis='per_unit',freight_cost=1.234,currency='SAR',freight_unit='EA',freight_valid_from='2026-10-11' where id=pg_temp.id(90);
create function pg_temp.fp(confirmed boolean default true) returns jsonb language sql as $$select public.transfer_freight_preview(pg_temp.id(1),(select id from saved_dates),confirmed)$$;
create function pg_temp.fs(request integer default 900,fingerprint text default null,confirmed boolean default true) returns uuid language sql as $$select public.transfer_freight_save(pg_temp.id(1),(select id from saved_dates),confirmed,pg_temp.id(request),coalesce(fingerprint,pg_temp.fp(confirmed)->>'fingerprint'))$$;
create temporary table saved_freight(id uuid,report jsonb);
grant all on saved_freight to authenticated;
set local role authenticated;
insert into saved_freight select pg_temp.fs(),pg_temp.fp();
create function pg_temp.submit(request integer default 1000,reason text default ' Transfer rationale ',estimate uuid default null)
returns uuid language sql as $$select public.transfer_proposal_submit(pg_temp.id(1),coalesce(estimate,(select id from saved_freight)),pg_temp.id(request),reason)$$;
create temporary table proposals(id uuid);
grant all on proposals to authenticated;
create function pg_temp.decide(decision text default 'approved',request integer default 1100,reason text default ' Independent review ',proposal uuid default null)
returns uuid language sql as $$select public.transfer_proposal_decide(pg_temp.id(1),coalesce(proposal,(select id from proposals limit 1)),pg_temp.id(request),decision,reason)$$;
-- The fixture above exercises the real quantity, date, freight and review pipeline.
create function pg_temp.handoff(proposal uuid default null) returns uuid language sql as $$
  select public.transfer_handoff_create(pg_temp.id(1),coalesce(proposal,(select id from proposals order by id limit 1)))$$;
create temporary table exports(id uuid,proposal_id uuid,payload jsonb);
grant all on exports to authenticated;
insert into proposals select pg_temp.submit();
select pg_temp.login(16);
select pg_temp.decide();
select pg_temp.login(10);
insert into exports(id,proposal_id) select pg_temp.handoff(),(select id from proposals);
update exports set payload=(select payload from public.transfer_handoffs h where h.id=exports.id);
reset role;
-- The first line used real application RPCs. Trusted clones isolate API pagination; the browser fixture uses three independent full evidence chains.
create function pg_temp.clone_line(n integer) returns uuid language plpgsql as $$
declare d uuid:=pg_temp.id(2000+n); p uuid:=pg_temp.id(3000+n); h uuid:=pg_temp.id(4000+n); payload jsonb;
begin
 insert into public.redistribution_drafts select (jsonb_populate_record(null::public.redistribution_drafts,
   (select to_jsonb(r) from public.redistribution_drafts r where id=(select id from captured))||jsonb_build_object('id',d,'request_id',d))).*;
 insert into public.transfer_proposals select (jsonb_populate_record(null::public.transfer_proposals,
   (select to_jsonb(r) from public.transfer_proposals r where id=(select id from proposals limit 1))||
   jsonb_build_object('id',p,'draft_id',d,'request_id',p,'decision_request_id',p))).*;
 payload:=(select e.payload from exports e);
 payload:=jsonb_set(payload,'{handoff_id}',to_jsonb(h));
 payload:=jsonb_set(payload,'{proposal,id}',to_jsonb(p));
 payload:=jsonb_set(payload,'{estimate,source,source,source_item_id}',to_jsonb(pg_temp.id(5000+n)));
 payload:=jsonb_set(payload,'{estimate,source,source,destination,policy,item_code}',to_jsonb('ITEM-'||n));
 insert into public.transfer_handoffs(id,organization_id,proposal_id,location_id,source_location_id,created_by,payload)
 values(h,pg_temp.id(1),p,pg_temp.id(20),pg_temp.id(21),pg_temp.id(10),payload);
 return h;
end; $$;
create temporary table lines(n integer,id uuid,original jsonb);
insert into lines values(0,(select id from exports),null),(1,pg_temp.clone_line(1),null),(2,pg_temp.clone_line(2),null);
update lines set original=h.payload from public.transfer_handoffs h where h.id=lines.id;
create temporary table batches(id uuid,payload jsonb);
insert into batches(id) select public.transfer_handoff_batch_create(pg_temp.id(1),array_agg(id order by id)) from lines where n in(0,1);
update batches set payload=b.payload from public.transfer_handoff_batches b where b.id=batches.id;
create function pg_temp.hash(n integer) returns bytea language sql immutable as $$select decode(lpad(n::text,64,'0'),'hex')$$;
create function pg_temp.key(n integer,scopes text[] default array['transfer_handoffs:read'],org integer default 1) returns uuid language sql as $$select public.create_api_key(pg_temp.id(org),'Test key '||n,scopes,30,pg_temp.hash(n),'zeespare_sk_test','test')$$;
select pg_temp.login(10,1);
set local role authenticated;

select lives_ok($$select pg_temp.key(40,array['transfer_handoffs:read','transfer_handoffs:acknowledge'])$$,'owner can issue explicit acknowledgement scope');
select pg_temp.key(41);
select pg_temp.key(42,array['transfer_handoffs:acknowledge']);
select pg_temp.key(43,array['transfer_handoffs:acknowledge']);
select pg_temp.key(45,array['transfer_handoffs:acknowledge']);
select pg_temp.key(48,array['purchase_handoffs:read','purchase_handoffs:acknowledge']);
select lives_ok($$select pg_temp.key(49,array['master_data:read','master_data:write','transactions:read','transactions:write','purchase_handoffs:read','purchase_handoffs:acknowledge','transfer_handoffs:read','transfer_handoffs:acknowledge'])$$,'all eight scopes accepted explicitly');
select pg_temp.login(15,1);
select lives_ok($$select pg_temp.key(50,array['transfer_handoffs:acknowledge'])$$,'admin can issue acknowledgement keys');
select pg_temp.login(14,1);
select throws_ok($$select pg_temp.key(51,array['transfer_handoffs:acknowledge'])$$,'MQ403',null,'planner cannot issue acknowledgement keys');
select pg_temp.login(12,1);
select throws_ok($$select pg_temp.key(51,array['transfer_handoffs:acknowledge'])$$,'MQ403',null,'branch member cannot issue acknowledgement keys');
select pg_temp.login(11,1);
select throws_ok($$select pg_temp.key(46,array['transfer_handoffs:acknowledge'])$$,'MQ403',null,'viewer cannot issue acknowledgement keys');
select pg_temp.login(16,1);
select throws_ok($$select pg_temp.key(46,array['transfer_handoffs:acknowledge'])$$,'MQ403',null,'approver cannot issue acknowledgement keys');
select pg_temp.login(13,2);
select pg_temp.key(44,array['transfer_handoffs:read','transfer_handoffs:acknowledge'],2);
reset role;
update public.api_keys set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where key_hash=pg_temp.hash(43);
update public.api_keys set revoked_at=now() where key_hash=pg_temp.hash(45);
create function pg_temp.body(n integer,status text default 'received',reason text default null) returns jsonb language sql as $$
select jsonb_build_object('client_event_id',pg_temp.id(n),'external_system','ERP test','external_reference','000123','status',status,'reason',reason)$$;
create function pg_temp.ack(n integer,key_no integer default 40,body jsonb default null) returns jsonb language sql as $$
select public.api_transfer_handoff_acknowledge(pg_temp.hash(key_no),'transfer-handoffs',(select id from lines where n=0),coalesce(body,pg_temp.body(n)))$$;
create temporary table events(n integer,body jsonb);
grant all on events to service_role;
grant select on lines,batches,captured to service_role;
set local role service_role;
select throws_ok($$select pg_temp.ack(2000,48)$$,'MQ403',null,'purchase acknowledgement permission does not grant transfer writes');
select throws_ok($$select public.api_transfer_handoff_acknowledgements(pg_temp.hash(48),'transfer-handoffs',(select id from lines where n=0))$$,'MQ403',null,'purchase permission does not grant transfer history');
select throws_ok($$select pg_temp.ack(2000,41)$$,'MQ403',null,'read permission does not grant writes');
select throws_ok($$select public.api_transfer_handoff_acknowledgements(pg_temp.hash(42),'transfer-handoffs',(select id from lines where n=0))$$,'MQ403',null,'acknowledge permission does not grant reads');
select throws_ok($$select pg_temp.ack(2000,43)$$,'MQ401',null,'expired key denied');
select throws_ok($$select pg_temp.ack(2000,45)$$,'MQ401',null,'revoked key denied');
select throws_ok($$select pg_temp.ack(2000,99)$$,'MQ401',null,'unknown key denied');
select throws_ok($$select pg_temp.ack(2000,44)$$,'MQ404',null,'cross-tenant writes hidden');
select throws_ok($$select public.api_transfer_handoff_acknowledge(pg_temp.hash(40),'transfer-handoffs',pg_temp.id(999),pg_temp.body(2000))$$,'MQ404',null,'missing package hidden');
select throws_ok($$select public.api_transfer_handoff_acknowledge(pg_temp.hash(40),'items',(select id from lines where n=0),pg_temp.body(2000))$$,'MQ404',null,'resource allowlist');
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
select ok(not ((select body->'data' from events where n=1) ?| array['organization_id','location_id','source_location_id','handoff_id','batch_id']),'API event excludes internal tenant/endpoint columns');
select is((select body->>'replayed' from events where n=1),'false','first event created');
select is((select body#>>'{data,external_reference}' from events where n=1),'000123','reference preserves leading zeros');
insert into events values(2,pg_temp.ack(2000,42,pg_temp.body(2000)-'reason'));
select is((select body->>'replayed' from events where n=2),'true','retry works after key rotation and null omission');
select is((select body->'data' from events where n=2),(select body->'data' from events where n=1),'retry retains identity, original key and recording time');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000,'rejected','Unknown item'))$$,'MQ409',null,'changed report conflicts');
select throws_ok($$select public.api_transfer_handoff_acknowledge(pg_temp.hash(40),'transfer-handoff-batches',(select id from batches),pg_temp.body(2000))$$,'MQ409',null,'event identity is organization-wide across targets');
insert into events values(3,pg_temp.ack(2001,40,pg_temp.body(2001,'rejected','Unknown item')));
select is(public.api_transfer_handoff_acknowledgements(pg_temp.hash(40),'transfer-handoffs',(select id from lines where n=0),(select (body#>>'{data,id}')::uuid from events where n=1))->'data',(select body->'data' from events where n=1),'read original event');
select throws_ok($$select public.api_transfer_handoff_acknowledgements(pg_temp.hash(40),'transfer-handoffs',(select id from lines where n=1),(select (body#>>'{data,id}')::uuid from events where n=1))$$,'MQ404',null,'event must belong to parent');
select throws_ok($$select public.api_transfer_handoff_acknowledgements(pg_temp.hash(44),'transfer-handoffs',(select id from lines where n=0))$$,'MQ404',null,'cross-tenant history denied');
select throws_ok($$select public.api_transfer_handoff_acknowledgements(pg_temp.hash(40),'transfer-handoffs',(select id from lines where n=0),null,null,101)$$,'MQ422',null,'bounded list backstop');
reset role;
select is((select count(*) from public.transfer_handoff_acknowledgements where organization_id=pg_temp.id(1)),2::bigint,'retries and failures add no extra event');
select is((select count(*) from public.audit_log where organization_id=pg_temp.id(1) and table_name='transfer_handoff_acknowledgements'),2::bigint,'one audit entry per new event');
update public.transfer_handoff_acknowledgements set recorded_at=statement_timestamp()-interval '1 hour' where organization_id=pg_temp.id(1);
create temporary table pages(n integer,body jsonb);
grant all on pages to service_role;
set local role service_role;
insert into pages values(1,public.api_transfer_handoff_acknowledgements(pg_temp.hash(40),'transfer-handoffs',(select id from lines where n=0),null,null,1));
insert into pages values(2,public.api_transfer_handoff_acknowledgements(pg_temp.hash(40),'transfer-handoffs',(select id from lines where n=0),null,(select body->>'next_cursor' from pages where n=1),1));
select is((select count(distinct body#>>'{data,0,id}') from pages),2::bigint,'timestamp ties traverse distinct events');
select is((select body->>'next_cursor' from pages where n=2),null,'last page ends');
select is((select count(distinct body->>'as_of') from pages),1::bigint,'paging time bound retained');
select throws_ok($$select public.api_transfer_handoff_acknowledgements(pg_temp.hash(40),'transfer-handoffs',(select id from lines where n=1),null,(select body->>'next_cursor' from pages where n=1),1)$$,'MQ422',null,'cursor binds parent');
select throws_ok($$select public.api_transfer_handoff_acknowledgements(pg_temp.hash(40),'transfer-handoff-batches',(select id from batches),null,(select body->>'next_cursor' from pages where n=1),1)$$,'MQ422',null,'cursor binds resource');
select throws_ok($$select public.api_transfer_handoff_acknowledgements(pg_temp.hash(40),'transfer-handoffs',(select id from lines where n=0),null,'bad',1)$$,'MQ422',null,'malformed cursor refused');
select is(jsonb_array_length(public.api_transfer_handoff_acknowledgements(pg_temp.hash(40),'transfer-handoff-batches',(select id from batches))->'data'),0,'individual reports do not propagate to batch');
select lives_ok($$select public.api_transfer_handoff_acknowledge(pg_temp.hash(40),'transfer-handoff-batches',(select id from batches),pg_temp.body(2002))$$,'batch report accepted');
select is(jsonb_array_length(public.api_transfer_handoff_acknowledgements(pg_temp.hash(40),'transfer-handoffs',(select id from lines where n=1))->'data'),0,'batch report does not propagate to its other member');
select throws_ok($$update public.transfer_handoff_acknowledgements set reason='changed'$$,'42501',null,'service role cannot directly change events');
reset role;
select pg_temp.login(11,1);
set local role authenticated;
select is((select count(*) from public.transfer_handoff_acknowledgements),3::bigint,'viewer reads own organization history');
select throws_ok($$delete from public.transfer_handoff_acknowledgements$$,'42501',null,'members cannot delete history');
select throws_ok($$select pg_temp.ack(2003)$$,'42501',null,'members cannot call service RPC');
select pg_temp.login(12,1);
select is((select count(*) from public.transfer_handoff_acknowledgements),0::bigint,'destination-only member cannot read transfer history');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));
set local role authenticated;
select is((select count(*) from public.transfer_handoff_acknowledgements),3::bigint,'member assigned both endpoints reads transfer history');
reset role;
delete from public.membership_locations where organization_id=pg_temp.id(1) and user_id=pg_temp.id(12) and location_id=pg_temp.id(20);
set local role authenticated;
select is((select count(*) from public.transfer_handoff_acknowledgements),0::bigint,'source-only member cannot read transfer history');
select pg_temp.login(13,2);
select is((select count(*) from public.transfer_handoff_acknowledgements),0::bigint,'other tenant cannot read member history');
reset role;
select pg_temp.login(10,1);
set local role authenticated;
insert into proposals select pg_temp.submit(1001);
select pg_temp.login(16,1);
select pg_temp.decide('approved',1101,'Reviewed',(select id from proposals where id not in(select proposal_id from exports)));
reset role;
update public.network_links set freight_cost=2 where organization_id=pg_temp.id(1);
set local role service_role;
select lives_ok($$select pg_temp.ack(2003)$$,'historical package accepts later reports despite changed freight');
select is(public.api_transfer_handoff_get(pg_temp.hash(40),'transfer-handoffs',id)#>'{data,payload}',original,'individual saved evidence unchanged') from lines;
select is(public.api_transfer_handoff_get(pg_temp.hash(40),'transfer-handoff-batches',id)#>'{data,payload}',payload,'batch saved evidence unchanged') from batches;
reset role;
update public.memberships set role='planner' where organization_id=pg_temp.id(1) and user_id=pg_temp.id(10);
set local role service_role;
select throws_ok($$select pg_temp.ack(2000)$$,'MQ401',null,'creator authority checked even for identical retry');
reset role;
select is((select count(*) from public.open_orders where organization_id=pg_temp.id(1)),3::bigint,'reports add no inbound orders');
select is((select count(*) from public.receipts where organization_id=pg_temp.id(1)),0::bigint,'reports add no receipts');
select is((select count(*) from public.stock_snapshots where organization_id=pg_temp.id(1)),3::bigint,'reports add no stock snapshots');
select * from finish();
rollback;
