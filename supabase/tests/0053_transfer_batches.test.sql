begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('a8200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
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
-- The first line used real application RPCs. Trusted clones isolate packaging bounds and header checks.
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
create temporary table lines(n integer,id uuid);
insert into lines select n,pg_temp.clone_line(n) from generate_series(1,51) n;
grant select on lines to authenticated;
create function pg_temp.bp(ids uuid[] default null) returns jsonb language sql as $$
 select public.transfer_handoff_batch_preview(pg_temp.id(1),coalesce(ids,(select array_agg(id order by n) from lines where n<=2)))$$;
create function pg_temp.bs(ids uuid[] default null) returns uuid language sql as $$
 select public.transfer_handoff_batch_create(pg_temp.id(1),coalesce(ids,(select array_agg(id order by n) from lines where n<=2)))$$;
create temporary table batches(id uuid,payload jsonb); grant all on batches to authenticated;
set local role authenticated;
select is(pg_temp.bp()#>>'{summary,subtotal}','21.60','sum saved rounded line freight, without consolidation');
select is(pg_temp.bp()#>>'{summary,source_location_id}',pg_temp.id(21)::text,'source identity saved');
select is(pg_temp.bp()#>>'{summary,lane_id}',pg_temp.id(90)::text,'directed lane identity saved');
insert into batches(id) select pg_temp.bs();
update batches set payload=(select b.payload from public.transfer_handoff_batches b where b.id=batches.id);
select is(pg_temp.bs((select array_agg(id order by n desc) from lines where n<=2)),(select id from batches),'canonical set retry');
select is(pg_temp.bp()->>'existing_batch_id',(select id::text from batches),'preview identifies immutable retry');
select is((select payload->>'schema_version' from batches),'transfer-handoff-batch-v1','versioned contract');
select is((select payload->'lines' from batches),(select jsonb_agg(payload order by id) from public.transfer_handoffs where id=any((select array_agg(id) from lines where n<=2)::uuid[])),'complete original evidence copied');
select lives_ok($$select pg_temp.bs(array[(select id from lines where n=1)])$$,'one-line overlapping package allowed');
select is((select overlap_count from public.transfer_handoff_batch_list where id=(select id from batches)),1::bigint,'overlap visible');
select is((select batch_count from public.transfer_handoff_batch_candidates where id=(select id from lines where n=1)),2::bigint,'candidate reuse count');
select throws_ok($$select pg_temp.bs('{}')$$,'MQ422',null,'empty selection rejected');
select throws_ok($$select public.transfer_handoff_batch_create(pg_temp.id(1),null)$$,'MQ422',null,'null selection rejected');
select throws_ok($$select pg_temp.bs(array[null::uuid])$$,'MQ422',null,'null member rejected');
select throws_ok($$select pg_temp.bs(array[pg_temp.id(4001),pg_temp.id(4001)])$$,'MQ422',null,'duplicate identity rejected');
select throws_ok($$select pg_temp.bs((select array_agg(id) from lines))$$,'MQ422',null,'51 lines rejected');
select throws_ok($$select pg_temp.bs(array[pg_temp.id(9999)])$$,'MQ404',null,'unknown source hidden');
select throws_ok($$insert into public.transfer_handoff_batches default values$$,'42501',null,'direct insert denied');
select throws_ok($$update public.transfer_handoff_batches set payload='{}'$$,'42501',null,'direct update denied');
select throws_ok($$delete from public.transfer_handoff_batches$$,'42501',null,'direct delete denied');
select pg_temp.login(11);
select is((select count(*) from public.transfer_handoff_batches),2::bigint,'viewer reads');
select throws_ok($$select pg_temp.bs()$$,'MQ403',null,'viewer cannot retry or save');
select throws_ok($$select pg_temp.bp()$$,'MQ403',null,'viewer cannot preview');
select pg_temp.login(12);
select is((select count(*) from public.transfer_handoff_batch_list),0::bigint,'destination-only history hidden');
select is((select count(*) from public.transfer_handoff_batch_candidates),0::bigint,'destination-only candidates hidden');
reset role;
update public.membership_locations set location_id=pg_temp.id(21) where user_id=pg_temp.id(12);
set local role authenticated;
select is((select count(*) from public.transfer_handoff_batches),0::bigint,'source-only hidden');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
set local role authenticated;
select is((select count(*) from public.transfer_handoff_batch_list),2::bigint,'both endpoints readable');
select pg_temp.login(13,2);
select is((select count(*) from public.transfer_handoff_batches),0::bigint,'tenant isolation');
select throws_ok($$select public.transfer_handoff_batch_create(pg_temp.id(2),array[pg_temp.id(4001)])$$,'MQ404',null,'cross-tenant RPC hidden');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.bs()$$,'MQ403',null,'active claim narrows authority');
select pg_temp.login(10);
reset role;
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,terms,id}','"00000000-0000-4000-8000-000000000001"') where id=pg_temp.id(4003);
set local role authenticated;
select throws_ok($$select pg_temp.bs(array[pg_temp.id(4001),pg_temp.id(4003)])$$,'MQ422',null,'lane mismatch rejects whole batch');
reset role;
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,terms,id}',(select payload#>'{estimate,terms,id}' from exports)) where id=pg_temp.id(4003);
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,source_location_id}','"00000000-0000-4000-8000-000000000001"') where id=pg_temp.id(4003);
set local role authenticated;
select throws_ok($$select pg_temp.bs(array[pg_temp.id(4001),pg_temp.id(4003)])$$,'MQ422',null,'source mismatch rejects whole batch');
reset role;
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,source_location_id}',(select payload#>'{estimate,source_location_id}' from exports)) where id=pg_temp.id(4003);
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,location_id}','"00000000-0000-4000-8000-000000000001"') where id=pg_temp.id(4003);
set local role authenticated;
select throws_ok($$select pg_temp.bs(array[pg_temp.id(4001),pg_temp.id(4003)])$$,'MQ422',null,'destination mismatch rejects whole batch');
reset role;
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,location_id}',(select payload#>'{estimate,location_id}' from exports)) where id=pg_temp.id(4003);
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,terms,currency}','"USD"') where id=pg_temp.id(4003);
set local role authenticated;
select throws_ok($$select pg_temp.bs(array[pg_temp.id(4001),pg_temp.id(4003)])$$,'MQ422',null,'currency mismatch rejects whole batch');
reset role;
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,terms,currency}',(select payload#>'{estimate,terms,currency}' from exports)) where id=pg_temp.id(4003);
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,terms,minor_units}','3') where id=pg_temp.id(4003);
set local role authenticated;
select throws_ok($$select pg_temp.bs(array[pg_temp.id(4001),pg_temp.id(4003)])$$,'MQ422',null,'precision mismatch rejects whole batch');
reset role;
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,terms,minor_units}',(select payload#>'{estimate,terms,minor_units}' from exports)) where id=pg_temp.id(4003);
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,source,dispatch,date}','"2026-10-12"') where id=pg_temp.id(4003);
set local role authenticated;
select throws_ok($$select pg_temp.bs(array[pg_temp.id(4001),pg_temp.id(4003)])$$,'MQ422',null,'dispatch mismatch rejects whole batch');
reset role;
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,source,dispatch,date}',(select payload#>'{estimate,source,dispatch,date}' from exports)) where id=pg_temp.id(4003);
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,source,receipts,p50,timing_review_required}','true') where id=pg_temp.id(4003);
set local role authenticated;
select throws_ok($$select pg_temp.bs(array[pg_temp.id(4001),pg_temp.id(4003)])$$,'MQ422',null,'typical timing rejects whole batch');
reset role;
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,source,receipts,p50,timing_review_required}',(select payload#>'{estimate,source,receipts,p50,timing_review_required}' from exports)) where id=pg_temp.id(4003);
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,source,receipts,p90,timing_review_required}','null') where id=pg_temp.id(4003);
set local role authenticated;
select throws_ok($$select pg_temp.bs(array[pg_temp.id(4001),pg_temp.id(4003)])$$,'MQ422',null,'slow timing unknown rejects whole batch');
reset role;
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,source,receipts,p90,timing_review_required}',(select payload#>'{estimate,source,receipts,p90,timing_review_required}' from exports)) where id=pg_temp.id(4003);
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,subtotal}','null') where id=pg_temp.id(4003);
set local role authenticated;
select throws_ok($$select pg_temp.bs(array[pg_temp.id(4001),pg_temp.id(4003)])$$,'MQ422',null,'missing cost rejects whole batch');
reset role;
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,subtotal}',(select payload#>'{estimate,subtotal}' from exports)) where id=pg_temp.id(4003);
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,source,source,quantity}','"0"') where id=pg_temp.id(4003);
set local role authenticated;
select throws_ok($$select pg_temp.bs(array[pg_temp.id(4001),pg_temp.id(4003)])$$,'MQ422',null,'zero quantity rejects whole batch');
reset role;
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,source,source,quantity}',(select payload#>'{estimate,source,source,quantity}' from exports)) where id=pg_temp.id(4003);
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,fingerprint}','"changed"') where id=pg_temp.id(4003);
set local role authenticated;
select throws_ok($$select pg_temp.bs(array[pg_temp.id(4001),pg_temp.id(4003)])$$,'MQ409',null,'stale fingerprint rejects whole batch');
reset role;
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,fingerprint}',(select payload#>'{estimate,fingerprint}' from exports)) where id=pg_temp.id(4003);
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,source,source,source_item_id}',to_jsonb(pg_temp.id(5001))) where id=pg_temp.id(4003);
set local role authenticated;
select throws_ok($$select pg_temp.bs(array[pg_temp.id(4001),pg_temp.id(4003)])$$,'MQ422',null,'duplicate item across drafts');
reset role;
update public.transfer_handoffs set payload=jsonb_set(payload,'{estimate,source,source,source_item_id}',to_jsonb(pg_temp.id(5003))) where id=pg_temp.id(4003);
-- Distinct units and receipt dates are retained, never pooled or repriced.
update public.transfer_handoffs set payload=jsonb_set(jsonb_set(payload,'{estimate,source,source,destination,policy,unit}','"KG"'),'{estimate,source,receipts,p90,search,date}','"2026-10-19"') where id=pg_temp.id(4003);
set local role authenticated;
select is(pg_temp.bp(array[pg_temp.id(4001),pg_temp.id(4003)])#>>'{lines,1,estimate,source,source,destination,policy,unit}','KG','line units retained');
set local statement_timeout='8s';
select lives_ok($$select pg_temp.bs((select array_agg(id) from lines where n<=50))$$,'50-line save under statement budget');
set local statement_timeout=0;
reset role;
update public.network_links set freight_cost=2 where id=pg_temp.id(90);
set local role authenticated;
select throws_ok($$select pg_temp.bs(array[pg_temp.id(4004)])$$,'MQ409',null,'current rate change blocks new batch');
select is(pg_temp.bs(),(select id from batches),'retry returns original despite rate change');
select is((select b.payload from public.transfer_handoff_batches b where b.id=(select id from batches)),(select payload from batches),'files immutable');
reset role;
update public.transfer_proposals set status='rejected' where id=pg_temp.id(3001);
set local role authenticated;
select is((select selected from public.transfer_handoff_batch_list where id=(select id from batches)),false,'batch selection follows every source');
select is(pg_temp.bs(),(select id from batches),'historical retry retains identity');
reset role;
delete from public.transfer_handoffs where id=pg_temp.id(4001);
set local role authenticated;
select is((select count(*) from public.transfer_handoff_batches),3::bigint,'saved batch evidence survives individual source deletion');
select throws_ok($$select pg_temp.bs()$$,'MQ404',null,'deleted source cannot retry');
reset role;
select is((select count(*) from public.audit_log where organization_id=pg_temp.id(1) and table_name='transfer_handoff_batches'),3::bigint,'one audit per new set');
select is((select count(*) from public.open_orders where organization_id=pg_temp.id(1)),3::bigint,'no inbound created');
select is((select count(*) from public.stock_snapshots where organization_id=pg_temp.id(1)),3::bigint,'no stock created');
set local role anon;
select throws_ok($$select * from public.transfer_handoff_batches$$,'42501',null,'anon denied');
reset role;
set local role service_role;
select throws_ok($$select pg_temp.bs()$$,'42501',null,'service RPC denied');
reset role;
select ok(not has_table_privilege('maqdar_worker','public.transfer_handoff_batches','select'),'worker denied');
select * from finish(); rollback;
