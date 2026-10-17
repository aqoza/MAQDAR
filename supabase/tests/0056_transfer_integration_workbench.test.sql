begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('a8500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
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
insert into batches(id) select public.transfer_handoff_batch_create(pg_temp.id(1),array_agg(id order by id)) from lines where n in(0,2);
update batches set payload=b.payload from public.transfer_handoff_batches b where b.id=batches.id;
update public.transfer_handoffs set created_at='2026-10-01T00:00:00Z' where organization_id=pg_temp.id(1);
insert into public.transfer_handoff_acknowledgements(id,organization_id,location_id,source_location_id,handoff_id,client_event_id,api_key_id,external_system,external_reference,status,reason,recorded_at)
select pg_temp.id(v.n),pg_temp.id(1),pg_temp.id(20),pg_temp.id(21),l.id,pg_temp.id(v.n+100),pg_temp.id(4000),v.label,v.ref,v.status,v.reason,v.at::timestamptz
from (values
 (2000,0,'ERP','old-reference','rejected','Old rejection','2026-10-02'),
 (2001,0,'ERP','current-reference','received',null,'2026-10-03'),
 (2002,0,'erp','case-reference','rejected','Case-sensitive system','2026-10-03'),
 (2003,0,' ERP ','space-reference','rejected','Space-sensitive system','2026-10-03'),
 (2010,1,'WMS','warehouse-reference','rejected','Missing mapping','2026-10-02')
) v(n,item,label,ref,status,reason,at) join lines l on l.n=v.item;
insert into public.transfer_handoff_acknowledgements(id,organization_id,location_id,source_location_id,batch_id,client_event_id,api_key_id,external_system,external_reference,status,recorded_at)
select pg_temp.id(2020),pg_temp.id(1),pg_temp.id(20),pg_temp.id(21),id,pg_temp.id(2120),pg_temp.id(4000),'ERP','batch-reference','received','2026-10-02' from batches order by batches.id limit 1;
create function pg_temp.workbench(filters jsonb default '{}',page integer default 1,size integer default 25) returns jsonb language sql as $$select public.transfer_integration_workbench(pg_temp.id(1),filters,page,size)$$;
create temporary table before_reads as select
  (select jsonb_agg(to_jsonb(a) order by id) from public.transfer_handoff_acknowledgements a) events,
  (select count(*) from public.audit_log) audits,
  (select count(*) from public.open_orders) orders,
  (select count(*) from public.receipts) receipts,
  (select count(*) from public.stock_snapshots) stock;
grant select on lines,batches,exports to authenticated;
set local role authenticated;
select is(pg_temp.workbench()->>'total','7','one row per package/system, or one absent row');
select is(pg_temp.workbench('{"status":"received"}')->>'total','2','superseded rejection replaced by receipt independently');
select is(pg_temp.workbench('{"status":"rejected"}')->>'total','3','other systems retain their rejections');
select is(pg_temp.workbench('{"status":"no_report"}')->>'total','2','only packages without any report are absent in all-systems mode');
select is(pg_temp.workbench('{"system":"ERP"}')->>'total','5','system-specific mode includes every package');
select is(pg_temp.workbench('{"system":"ERP","status":"no_report"}')->>'total','3','other-system reports do not hide absence for selected system');
select is(pg_temp.workbench('{"system":"erp","status":"rejected"}')->>'total','1','system filter preserves case');
select is(pg_temp.workbench('{"system":" ERP ","status":"rejected"}')->>'total','1','system filter preserves spaces');
select is(pg_temp.workbench('{"system":"Unknown system","status":"no_report"}')->>'total','5','unknown label has absent evidence, not failed delivery');
select is(pg_temp.workbench('{"q":"old-reference"}')->>'total','0','search runs after latest event selection');
select is(pg_temp.workbench('{"q":"current-reference"}')->>'total','1','search finds latest reference');
select is(pg_temp.workbench('{"kind":"batch"}')->>'total','2','batch reports remain separate from member histories');
select is(pg_temp.workbench('{"kind":"handoff"}')->>'total','5','member histories remain separate from overlapping batches');
select is(pg_temp.workbench('{"location":"wrong"}')->>'total','0','location filter exact');
select is(pg_temp.workbench('{"source":"wrong"}')->>'total','0','source filter exact');
select is(pg_temp.workbench(jsonb_build_object('source',(select original#>>'{estimate,source,source,source_location_code}' from lines where n=0)))->>'total','7','saved source context is searchable');
select is(pg_temp.workbench('{}',999)->>'page','1','out-of-range page resolves to last page');
select throws_ok($$select pg_temp.workbench('{"status":"failed"}')$$,'MQ422',null,'failed is not a reported status');
select throws_ok($$select pg_temp.workbench('{"system":"   "}')$$,'MQ422',null,'blank system rejected');
select throws_ok($$select pg_temp.workbench('{"q":null}')$$,'MQ422',null,'non-string filter rejected');
select throws_ok($$select pg_temp.workbench('{"supplier":"SUP"}')$$,'MQ422',null,'purchase filters cannot enter transfer workbench');
select is(pg_temp.workbench('{"source":"L1","location":"L0"}')->>'total','7','both saved endpoint codes filter together');
select is(pg_temp.workbench('{"source":"L0","location":"L1"}')->>'total','0','directed endpoints are not interchangeable');
select is(pg_temp.workbench('{"q":"L1 L0"}')->>'total','7','search includes both saved endpoints even on batches');
select throws_ok($$select pg_temp.workbench('{"secret":true}')$$,'MQ422',null,'unknown filter rejected');
select throws_ok($$select pg_temp.workbench(jsonb_build_object('system',repeat('x',81)))$$,'MQ422',null,'system bounded');
select throws_ok($$select pg_temp.workbench('{}',0)$$,'MQ422',null,'positive page required');
select throws_ok($$select pg_temp.workbench('{}',1,101)$$,'MQ422',null,'page size bounded');
select throws_ok($$select public.transfer_integration_workbench(pg_temp.id(2))$$,'MQ404',null,'cross-tenant organization refused');
reset role;
select is((select count(*) from public.audit_log),(select audits from before_reads),'workbench reads add no audit writes');
set local role authenticated;
select pg_temp.login(11,1);
select is(pg_temp.workbench()->>'total','7','viewer may read organization workbench');
select pg_temp.login(12,1);
select is(pg_temp.workbench()->>'total','0','branch scope hides rows and counts');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));
set local role authenticated;
select is(pg_temp.workbench()->>'total','7','both endpoints permit rows and totals');
reset role;
delete from public.membership_locations where organization_id=pg_temp.id(1) and user_id=pg_temp.id(12) and location_id=pg_temp.id(20);
set local role authenticated;
select is(pg_temp.workbench()->>'total','0','source-only member cannot see rows or totals');
select pg_temp.login(13,2);
select throws_ok($$select pg_temp.workbench()$$,'MQ404',null,'other organization cannot read workbench');
reset role;
insert into public.memberships(organization_id,user_id,role) values(pg_temp.id(2),pg_temp.id(10),'viewer');
select pg_temp.login(10,2);
set local role authenticated;
select throws_ok($$select pg_temp.workbench()$$,'MQ404',null,'active organization claim narrows a multi-org membership');
reset role;
set local role anon;
select throws_ok($$select pg_temp.workbench()$$,'42501',null,'anonymous RPC denied');
reset role;
set local role service_role;
select throws_ok($$select pg_temp.workbench()$$,'42501',null,'integration service role cannot use member RPC');
reset role;
select ok(not has_function_privilege('maqdar_worker','public.transfer_integration_workbench(uuid,jsonb,integer,integer)','EXECUTE'),'worker RPC denied');
select is((select jsonb_agg(to_jsonb(a) order by id) from public.transfer_handoff_acknowledgements a),(select events from before_reads),'read preserves events');
select is((select count(*) from public.open_orders),(select orders from before_reads),'no order writes');
select is((select count(*) from public.receipts),(select receipts from before_reads),'no receipt writes');
select is((select count(*) from public.stock_snapshots),(select stock from before_reads),'no stock writes');
select is(h.payload,l.original,'individual exports unchanged') from lines l join public.transfer_handoffs h on h.id=l.id;
select is(b.payload,f.payload,'batch exports unchanged') from batches f join public.transfer_handoff_batches b on b.id=f.id;

-- A rotated reporting key and an exact timestamp tie still select one stable report.
insert into public.transfer_handoff_acknowledgements(id,organization_id,location_id,source_location_id,handoff_id,client_event_id,api_key_id,external_system,external_reference,status,recorded_at)
select pg_temp.id(1999),pg_temp.id(1),pg_temp.id(20),pg_temp.id(21),id,pg_temp.id(2099),pg_temp.id(4001),'ERP','tied-reference','received','2026-10-03' from lines where n=0;
insert into public.transfer_handoff_acknowledgements(id,organization_id,location_id,source_location_id,handoff_id,client_event_id,api_key_id,external_system,external_reference,status)
select pg_temp.id(3000+s.n),pg_temp.id(1),pg_temp.id(20),pg_temp.id(21),l.id,pg_temp.id(5000+s.n),pg_temp.id(4001),'System-'||s.n,'reference-'||s.n,'received' from lines l cross join generate_series(1,30) s(n) where l.n=0;
select pg_temp.login(10,1);
set local role authenticated;
select is(pg_temp.workbench('{"system":"ERP","q":"tied-reference"}')#>>'{rows,0,event_id}',pg_temp.id(1999)::text,'UUID resolves equal timestamps across key rotation');
select is(pg_temp.workbench()->>'total','37','many systems count results, not packages');
select is(jsonb_array_length(pg_temp.workbench()->'rows'),25,'page size enforced');
select is(jsonb_array_length(pg_temp.workbench('{}',2)->'rows'),12,'second page returns remainder');
select is(pg_temp.workbench('{}',999)->>'page','2','deep page clamps to last');
select is((select count(*) from (select value->>'id',value->>'external_system' from jsonb_array_elements(pg_temp.workbench()->'rows') intersect select value->>'id',value->>'external_system' from jsonb_array_elements(pg_temp.workbench('{}',2)->'rows')) overlap),0::bigint,'stable pages have no repeated package/system results');

insert into proposals select pg_temp.submit(1001);
select pg_temp.login(16,1);
select pg_temp.decide('approved',1101,'Replacement',(select id from proposals where id not in(select proposal_id from exports)));
select pg_temp.login(10,1);
select is(pg_temp.workbench('{"selection":"historical"}')->>'total','35','later selection makes source and both overlapping batches historical');
select is(pg_temp.workbench('{"selection":"current"}')->>'total','2','unaffected handoffs stay current');
select is(pg_temp.workbench('{"selection":"historical","system":"ERP","status":"received"}')->>'total','2','historical reports remain independently visible');
reset role;
select * from finish();
rollback;
