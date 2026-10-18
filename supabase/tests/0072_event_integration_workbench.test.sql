begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('99810000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'event-'||n||'@test.local' from generate_series(10,16) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'event-draft-a','Events A'),(pg_temp.id(2),'event-draft-b','Events B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),(pg_temp.id(1),pg_temp.id(12),'branch_user'),
 (pg_temp.id(2),pg_temp.id(13),'owner'),(pg_temp.id(1),pg_temp.id(14),'planner'),(pg_temp.id(1),pg_temp.id(15),'approver'),(pg_temp.id(1),pg_temp.id(16),'admin');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone)
 select pg_temp.id(20+n),pg_temp.id(case when n=2 then 2 else 1 end),'L'||n,'Location','branch','SA','Asia/Riyadh' from generate_series(0,2) n;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 select pg_temp.id(30+n),pg_temp.id(case when n=2 then 2 else 1 end),pg_temp.id(20+n),pg_temp.id(40+n),
 '2026-01-01','2026-10-10','forecast','succeeded','{"method":"expanded-v1"}',now(),'{}' from generate_series(0,2) n;
insert into public.forecast_results(id,organization_id,run_id,location_id,item_id,item_code,item_name,status,model,summary,evidence)
 select pg_temp.id(50+n),pg_temp.id(case when n=2 then 2 else 1 end),pg_temp.id(30+n),pg_temp.id(20+n),pg_temp.id(60+n),'ITEM','Saved item','selected','mean',
 '{"total":"3.003","scores":[]}',
 '{"source":{"start_day":"2026-01-01","end_day":"2026-10-10","introduced_on":null,"discontinued_on":null,"demand":[],"unit_provenance":{"method":"source-units-v1","status":"consistent","unit":"EA","rows":1,"unknown_rows":0,"units":["EA"]}},"output":{"status":"selected","model":"mean","total":"3.003","scores":[],"folds":[],"forecast":[{"date":"2026-10-11","quantity":"1.001"},{"date":"2026-10-12","quantity":"2.002"}],"uncertainty":{"status":"available","bands":[{"lower80":"0","upper80":"2","lower95":"0","upper95":"3"},{"lower80":"0","upper80":"3","lower95":"0","upper95":"4"}]}}}' from generate_series(0,2) n;
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 select pg_temp.id(100+n),pg_temp.id(case when n=2 then 2 else 1 end),pg_temp.id(20+n),pg_temp.id(110+n),
 '2026-01-01','2026-10-10','policy','succeeded',jsonb_build_object('method','policy-v1','forecast_id',pg_temp.id(50+n),'lead_time',1,'review_interval',1,'service_level','0.95'),now(),'{}' from generate_series(0,2) n;
insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
 select pg_temp.id(120+n),f.organization_id,pg_temp.id(100+n),f.location_id,f.id,f.item_id,f.item_code,'EA','available',o.output-'calibration',
 jsonb_build_object('method','policy-v1','options',r.options,'forecast',jsonb_build_object('id',f.id,'run_id',f.run_id,'item_id',f.item_id,'unit','EA','method','expanded-v1','to_date','2026-10-10','horizon',2,'source',f.evidence->'source','output',f.evidence->'output'),'output',o.output)
 from generate_series(0,2) n join public.forecast_results f on f.id=pg_temp.id(50+n) join public.planning_runs r on r.id=pg_temp.id(100+n)
 cross join lateral(select '{"status":"available","lead_time":{"days":1,"forecast":"1.001","quantile":"2.001","target":"2.001","safety_stock":"1.000"},"protection":{"days":2,"forecast":"3.003","quantile":"4.003","target":"4.003","safety_stock":"1.000"},"samples":5000,"seed":"baseline-seed","residual_count":20,"positive_days":10,"calibration":[]}'::jsonb output) o;
create temporary table fixture(event uuid,report jsonb,saved uuid,e jsonb,p jsonb);
grant all on fixture to authenticated;
select pg_temp.login(10,1);
set local role authenticated;
insert into fixture(event) select public.planned_event_save(pg_temp.id(1),pg_temp.id(50),'campaign','Launch','Incremental demand','EA',
 '[{"date":"2026-10-11","quantity":"0.009"},{"date":"2026-10-12","quantity":"2.250"}]',true,pg_temp.id(80),
 public.planned_event_preview(pg_temp.id(1),pg_temp.id(50),'campaign','Launch','Incremental demand','EA','[{"date":"2026-10-11","quantity":"0.009"},{"date":"2026-10-12","quantity":"2.250"}]',true)->>'fingerprint');
reset role;
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
values(pg_temp.id(60),pg_temp.id(1),'ITEM','Item','Test','SET',1,'SAR');
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values
(pg_temp.id(1),pg_temp.id(60),pg_temp.id(20),'2026-10-10',2.001,1.001,1,'SAR','EA'),
(pg_temp.id(1),pg_temp.id(60),pg_temp.id(20),'2026-10-11',999,0,1,'SAR','EA');
insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90)
values(pg_temp.id(200),pg_temp.id(1),'SUP','Supplier','SA','SAR',1,1);
insert into public.open_orders(id,organization_id,order_code,line_code,item_id,location_id,supplier_id,expected_date,quantity,unit_cost,currency,status,unit_of_measure) values
(pg_temp.id(201),pg_temp.id(1),'EARLY','1',pg_temp.id(60),pg_temp.id(20),pg_temp.id(200),'2026-10-09',1.001,1,'SAR','open','EA'),
(pg_temp.id(202),pg_temp.id(1),'LATE','1',pg_temp.id(60),pg_temp.id(20),pg_temp.id(200),'2026-10-13',1.000,1,'SAR','open','EA'),
(pg_temp.id(203),pg_temp.id(1),'CLOSED','1',pg_temp.id(60),pg_temp.id(20),pg_temp.id(200),'2026-10-11',999,1,'SAR','closed',null),
(pg_temp.id(204),pg_temp.id(1),'ZERO','1',pg_temp.id(60),pg_temp.id(20),pg_temp.id(200),'2026-10-11',0,1,'SAR','open',null);
insert into public.receipts(organization_id,receipt_code,line_code,item_id,location_id,supplier_id,receipt_date,quantity,unit_cost,currency)
values(pg_temp.id(1),'REC','1',pg_temp.id(60),pg_temp.id(20),pg_temp.id(200),'2026-10-10',100,1,'SAR');
create temporary table capture(scenario uuid,report jsonb,saved uuid);
grant all on capture to authenticated;
set local role authenticated;
insert into capture(scenario) select public.event_policy_save(pg_temp.id(1),event,pg_temp.id(120),'Fixed event',pg_temp.id(210),public.event_policy_preview(pg_temp.id(1),event,pg_temp.id(120),'Fixed event')->>'fingerprint') from fixture;
create function pg_temp.preview(backorders text default '0.002',orders_ok boolean default true,event_ok boolean default true) returns jsonb language sql as $$
select public.event_replenishment_preview(pg_temp.id(1),(select scenario from capture),backorders,orders_ok,event_ok)$$;
create function pg_temp.save(request integer default 220,fp text default null,backorders text default '0.002',orders_ok boolean default true,event_ok boolean default true) returns uuid language sql as $$
select public.event_replenishment_save(pg_temp.id(1),(select scenario from capture),backorders,orders_ok,event_ok,pg_temp.id(request),coalesce(fp,pg_temp.preview(backorders,orders_ok,event_ok)->>'fingerprint'))$$;
update capture set report=pg_temp.preview(),saved=pg_temp.save();
reset role;
insert into public.supplier_items(id,organization_id,supplier_id,item_id,lead_time_days,min_order_quantity,pack_size,unit_price,currency,unit_of_measure)
values(pg_temp.id(300),pg_temp.id(1),pg_temp.id(200),pg_temp.id(60),1,2,1.5,1,'SAR','EA');
create temporary table supplier_capture(report jsonb,saved uuid);
grant all on supplier_capture to authenticated;
create function pg_temp.supplier_preview(code text default 'SUP',confirmed boolean default true) returns jsonb language sql as $$
select public.event_supplier_preview(pg_temp.id(1),(select saved from capture),code,confirmed)$$;
create function pg_temp.supplier_save(request integer default 400,fp text default null,code text default 'SUP',confirmed boolean default true) returns uuid language sql as $$
select public.event_supplier_save(pg_temp.id(1),(select saved from capture),code,confirmed,pg_temp.id(request),coalesce(fp,pg_temp.supplier_preview(code,confirmed)->>'fingerprint'))$$;
set local role authenticated;
insert into supplier_capture(report) select pg_temp.supplier_preview();
update supplier_capture set saved=pg_temp.supplier_save();
reset role;
insert into public.work_calendars(id,organization_id,code,name_en,country_code,weekend_days,observe_public_holidays)
values(pg_temp.id(500),pg_temp.id(1),'SUP-CAL','Supplier calendar','SA',array[5,6]::smallint[],false),
(pg_temp.id(501),pg_temp.id(1),'REC-CAL','Receiver calendar','SA','{}',false);
update public.suppliers set work_calendar_id=pg_temp.id(500) where id=pg_temp.id(200);
update public.locations set work_calendar_id=pg_temp.id(501) where id=pg_temp.id(20);
insert into public.holiday_overrides(id,organization_id,work_calendar_id,starts_on,ends_on,kind,name_en)
values(pg_temp.id(502),pg_temp.id(1),pg_temp.id(501),'2026-10-12','2026-10-12','closure','Receiving closed');
create temporary table delivery_capture(report jsonb,saved uuid);
grant all on delivery_capture to authenticated;
create function pg_temp.delivery_preview(requested date default '2026-10-10',confirmed boolean default true) returns jsonb language sql as $$
select public.event_delivery_preview(pg_temp.id(1),(select saved from supplier_capture),requested,confirmed)$$;
create function pg_temp.delivery_save(request integer default 600,fp text default null,requested date default '2026-10-10',confirmed boolean default true) returns uuid language sql as $$
select public.event_delivery_save(pg_temp.id(1),(select saved from supplier_capture),requested,confirmed,pg_temp.id(request),coalesce(fp,pg_temp.delivery_preview(requested,confirmed)->>'fingerprint'))$$;
set local role authenticated;
reset role;
update public.work_calendars set weekend_days='{}' where organization_id=pg_temp.id(1);
delete from public.holiday_overrides where organization_id=pg_temp.id(1);
update public.supplier_items set unit_price=1.234,valid_from='2026-10-10' where organization_id=pg_temp.id(1);
set local role authenticated;
insert into delivery_capture(report,saved) select pg_temp.delivery_preview(),pg_temp.delivery_save();

create temporary table review_fixture(draft_id uuid,delivery_id uuid,scenario_id uuid,estimate_id uuid,report jsonb,proposal_id uuid);
grant all on review_fixture to authenticated;
create function pg_temp.cost_preview() returns jsonb language sql as $$select public.event_purchase_cost_preview(pg_temp.id(1),(select saved from delivery_capture),true)$$;
create function pg_temp.cost_save(request integer default 800) returns uuid language sql as $$select public.event_purchase_cost_save(pg_temp.id(1),(select saved from delivery_capture),true,pg_temp.id(request),pg_temp.cost_preview()->>'fingerprint')$$;
insert into review_fixture(draft_id,delivery_id,scenario_id,estimate_id,report)
select (select saved from capture),(select saved from delivery_capture),(select saved from supplier_capture),pg_temp.cost_save(),pg_temp.cost_preview();

create function pg_temp.propose(request integer default 900,why text default 'Plan purchase') returns uuid language sql as $$select public.event_purchase_proposal_submit(pg_temp.id(1),(select estimate_id from review_fixture),pg_temp.id(request),why)$$;
create function pg_temp.decide(decision text,request integer default 950,why text default 'Reviewed') returns uuid language sql as $$select public.event_purchase_proposal_decide(pg_temp.id(1),(select proposal_id from review_fixture),pg_temp.id(request),decision,why)$$;
set local role authenticated;


reset role;
-- Worker outputs are synthetic; every subsequent scenario, independent approval and handoff uses real RPCs.
create function pg_temp.line(n integer,u text default 'EA',duplicate boolean default false,quote_price numeric default 1.234,quote_currency text default 'SAR') returns uuid language plpgsql as $$
declare item uuid:=case when duplicate then pg_temp.id(60) else pg_temp.id(10000+n) end;
  forecast uuid:=pg_temp.id(40000+n); policy uuid:=pg_temp.id(30000+n);
  event uuid; scenario uuid; draft uuid; supplier uuid; delivery uuid; estimate uuid; proposal uuid; report jsonb;
  fe jsonb; pe jsonb; code text:=case when duplicate then 'ITEM' else 'ITEM-'||n end;
begin
  perform pg_temp.login(10,1);
  if n=0 then estimate:=(select estimate_id from review_fixture);
  else
    if not duplicate then
      insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
        values(item,pg_temp.id(1),code,'Item','Test',u,1,'SAR');
      insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
        values(pg_temp.id(1),item,pg_temp.id(20),'2026-10-10',2.001,1.001,1,'SAR',u);
      insert into public.supplier_items(organization_id,supplier_id,item_id,lead_time_days,min_order_quantity,pack_size,unit_price,currency,unit_of_measure,valid_from)
        values(pg_temp.id(1),pg_temp.id(200),item,1,2,1.5,quote_price,quote_currency,u,'2026-10-10');
    end if;
    insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
      select pg_temp.id(50000+n),organization_id,location_id,gen_random_uuid(),from_date,to_date,kind,status,options,finished_at,result
      from public.planning_runs where id=pg_temp.id(30);
    select replace(evidence::text,'"EA"',to_jsonb(u)::text)::jsonb into fe from public.forecast_results where id=pg_temp.id(50);
    insert into public.forecast_results(id,organization_id,run_id,location_id,item_id,item_code,item_name,status,model,summary,evidence)
      select forecast,organization_id,pg_temp.id(50000+n),location_id,item,code,item_name,status,model,summary,fe
      from public.forecast_results where id=pg_temp.id(50);
    insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
      select pg_temp.id(20000+n),organization_id,location_id,gen_random_uuid(),from_date,to_date,kind,status,jsonb_set(options,'{forecast_id}',to_jsonb(forecast)),finished_at,result
      from public.planning_runs where id=pg_temp.id(100);
    select replace(replace(replace(replace(evidence::text,pg_temp.id(50)::text,forecast::text),pg_temp.id(30)::text,pg_temp.id(50000+n)::text),pg_temp.id(60)::text,item::text),'"EA"',to_jsonb(u)::text)::jsonb into pe
      from public.inventory_policies where id=pg_temp.id(120);
    insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
      select policy,organization_id,pg_temp.id(20000+n),location_id,forecast,item,code,u,status,summary,pe
      from public.inventory_policies where id=pg_temp.id(120);
    report:=public.planned_event_preview(pg_temp.id(1),forecast,'campaign','Launch '||n,'Additional demand',u,'[{"date":"2026-10-11","quantity":"0.009"},{"date":"2026-10-12","quantity":"2.250"}]',true);
    event:=public.planned_event_save(pg_temp.id(1),forecast,'campaign','Launch '||n,'Additional demand',u,'[{"date":"2026-10-11","quantity":"0.009"},{"date":"2026-10-12","quantity":"2.250"}]',true,gen_random_uuid(),report->>'fingerprint');
    report:=public.event_policy_preview(pg_temp.id(1),event,policy,'Fixed event');
    scenario:=public.event_policy_save(pg_temp.id(1),event,policy,'Fixed event',gen_random_uuid(),report->>'fingerprint');
    report:=public.event_replenishment_preview(pg_temp.id(1),scenario,'0.002',true,true);
    draft:=public.event_replenishment_save(pg_temp.id(1),scenario,'0.002',true,true,gen_random_uuid(),report->>'fingerprint');
    report:=public.event_supplier_preview(pg_temp.id(1),draft,'SUP',true);
    supplier:=public.event_supplier_save(pg_temp.id(1),draft,'SUP',true,gen_random_uuid(),report->>'fingerprint');
    report:=public.event_delivery_preview(pg_temp.id(1),supplier,'2026-10-10',true);
    delivery:=public.event_delivery_save(pg_temp.id(1),supplier,'2026-10-10',true,gen_random_uuid(),report->>'fingerprint');
    report:=public.event_purchase_cost_preview(pg_temp.id(1),delivery,true);
    estimate:=public.event_purchase_cost_save(pg_temp.id(1),delivery,true,gen_random_uuid(),report->>'fingerprint');
  end if;
  proposal:=public.event_purchase_proposal_submit(pg_temp.id(1),estimate,gen_random_uuid(),'Reason');
  perform pg_temp.login(15,1);
  perform public.event_purchase_proposal_decide(pg_temp.id(1),proposal,gen_random_uuid(),'approved','Independent review');
  perform pg_temp.login(10,1);
  return public.event_purchase_handoff_create(pg_temp.id(1),proposal);
end; $$;
create temporary table lines(n integer,id uuid,original jsonb);
insert into lines values(0,pg_temp.line(0),null),(1,pg_temp.line(1,'KG'),null),(2,pg_temp.line(2),null);
update lines set original=h.payload from public.event_purchase_handoffs h where h.id=lines.id;
grant select,update on lines to authenticated;
create function pg_temp.ids(ns integer[] default array[0,1]) returns uuid[] language sql as $$select array_agg(id order by n) from lines where n=any(ns)$$;
create function pg_temp.batch(ns integer[] default array[0,1]) returns uuid language sql as $$select public.event_purchase_handoff_batch_create(pg_temp.id(1),pg_temp.ids(ns))$$;
create temporary table batches(id uuid,payload jsonb);
grant all on batches to authenticated;
set local role authenticated;
insert into batches(id) select pg_temp.batch();
reset role;
update batches set payload=b.payload from public.event_purchase_handoff_batches b where b.id=batches.id;
-- Force timestamp ties to exercise the UUID tiebreak and inclusive lower bound.
update public.event_purchase_handoffs set created_at='2026-10-01T00:00:00Z' where organization_id=pg_temp.id(1);
select pg_temp.login(10,1);
set local role authenticated;
insert into batches(id) select pg_temp.batch(array[0,2]);
reset role;
update batches set payload=b.payload from public.event_purchase_handoff_batches b where b.id=batches.id;
insert into public.event_purchase_handoff_acknowledgements(id,organization_id,location_id,handoff_id,client_event_id,api_key_id,external_system,external_reference,status,reason,recorded_at)
select pg_temp.id(v.n),pg_temp.id(1),pg_temp.id(20),l.id,pg_temp.id(v.n+100),pg_temp.id(4000),v.label,v.ref,v.status,v.reason,v.at::timestamptz
from (values
 (2000,0,'ERP','old-reference','rejected','Old rejection','2026-10-02'),
 (2001,0,'ERP','current-reference','received',null,'2026-10-03'),
 (2002,0,'erp','case-reference','rejected','Case-sensitive system','2026-10-03'),
 (2003,0,' ERP ','space-reference','rejected','Space-sensitive system','2026-10-03'),
 (2010,1,'WMS','warehouse-reference','rejected','Missing mapping','2026-10-02')
) v(n,item,label,ref,status,reason,at) join lines l on l.n=v.item;
insert into public.event_purchase_handoff_acknowledgements(id,organization_id,location_id,batch_id,client_event_id,api_key_id,external_system,external_reference,status,recorded_at)
select pg_temp.id(2020),pg_temp.id(1),pg_temp.id(20),id,pg_temp.id(2120),pg_temp.id(4000),'ERP','batch-reference','received','2026-10-02' from batches order by batches.id limit 1;
create function pg_temp.workbench(filters jsonb default '{}',page integer default 1,size integer default 25) returns jsonb language sql as $$select public.event_purchase_integration_workbench(pg_temp.id(1),filters,page,size)$$;
create temporary table before_reads as select
  (select jsonb_agg(to_jsonb(a) order by id) from public.event_purchase_handoff_acknowledgements a) events,
  (select count(*) from public.audit_log) audits,
  (select count(*) from public.open_orders) orders,
  (select count(*) from public.receipts) receipts,
  (select count(*) from public.stock_snapshots) stock;
grant select on lines,batches,review_fixture to authenticated;
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
select is(pg_temp.workbench('{"supplier":"wrong"}')->>'total','0','supplier filter exact');
select is(pg_temp.workbench(jsonb_build_object('supplier',(select original#>>'{estimate,source,source,supplier,code}' from lines where n=0)))->>'total','7','saved supplier context is searchable');
select is(pg_temp.workbench('{}',999)->>'page','1','out-of-range page resolves to last page');
select throws_ok($$select pg_temp.workbench('{"status":"failed"}')$$,'MQ422',null,'failed is not a reported status');
select throws_ok($$select pg_temp.workbench('{"system":"   "}')$$,'MQ422',null,'blank system rejected');
select throws_ok($$select pg_temp.workbench('{"q":null}')$$,'MQ422',null,'non-string filter rejected');
select throws_ok($$select pg_temp.workbench('{"secret":true}')$$,'MQ422',null,'unknown filter rejected');
select throws_ok($$select pg_temp.workbench(jsonb_build_object('system',repeat('x',81)))$$,'MQ422',null,'system bounded');
select throws_ok($$select pg_temp.workbench('{}',0)$$,'MQ422',null,'positive page required');
select throws_ok($$select pg_temp.workbench('{}',1,101)$$,'MQ422',null,'page size bounded');
select throws_ok($$select public.event_purchase_integration_workbench(pg_temp.id(2))$$,'MQ404',null,'cross-tenant organization refused');
reset role;
select is((select count(*) from public.audit_log),(select audits from before_reads),'workbench reads add no audit writes');
set local role authenticated;
select pg_temp.login(11,1);
select is(pg_temp.workbench()->>'total','7','viewer may read organization workbench');
select pg_temp.login(12,1);
select is(pg_temp.workbench()->>'total','0','branch scope hides rows and counts');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
set local role authenticated;
select is(pg_temp.workbench()->>'total','7','assigned branch reads permitted packages');
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
select ok(not has_function_privilege('maqdar_worker','public.event_purchase_integration_workbench(uuid,jsonb,integer,integer)','EXECUTE'),'worker RPC denied');
select is((select jsonb_agg(to_jsonb(a) order by id) from public.event_purchase_handoff_acknowledgements a),(select events from before_reads),'read preserves events');
select is((select count(*) from public.open_orders),(select orders from before_reads),'no order writes');
select is((select count(*) from public.receipts),(select receipts from before_reads),'no receipt writes');
select is((select count(*) from public.stock_snapshots),(select stock from before_reads),'no stock writes');
select is(h.payload,l.original,'individual exports unchanged') from lines l join public.event_purchase_handoffs h on h.id=l.id;
select is(b.payload,f.payload,'batch exports unchanged') from batches f join public.event_purchase_handoff_batches b on b.id=f.id;

-- A rotated reporting key and an exact timestamp tie still select one stable report.
insert into public.event_purchase_handoff_acknowledgements(id,organization_id,location_id,handoff_id,client_event_id,api_key_id,external_system,external_reference,status,recorded_at)
select pg_temp.id(1999),pg_temp.id(1),pg_temp.id(20),id,pg_temp.id(2099),pg_temp.id(4001),'ERP','tied-reference','received','2026-10-03' from lines where n=0;
insert into public.event_purchase_handoff_acknowledgements(id,organization_id,location_id,handoff_id,client_event_id,api_key_id,external_system,external_reference,status)
select pg_temp.id(3000+s.n),pg_temp.id(1),pg_temp.id(20),l.id,pg_temp.id(5000+s.n),pg_temp.id(4001),'System-'||s.n,'reference-'||s.n,'received' from lines l cross join generate_series(1,30) s(n) where l.n=0;
select pg_temp.login(10,1);
set local role authenticated;
select is(pg_temp.workbench('{"system":"ERP","q":"tied-reference"}')#>>'{rows,0,event_id}',pg_temp.id(1999)::text,'UUID resolves equal timestamps across key rotation');
select is(pg_temp.workbench()->>'total','37','many systems count results, not packages');
select is(jsonb_array_length(pg_temp.workbench()->'rows'),25,'page size enforced');
select is(jsonb_array_length(pg_temp.workbench('{}',2)->'rows'),12,'second page returns remainder');
select is(pg_temp.workbench('{}',999)->>'page','2','deep page clamps to last');
select is((select count(*) from (select value->>'id',value->>'external_system' from jsonb_array_elements(pg_temp.workbench()->'rows') intersect select value->>'id',value->>'external_system' from jsonb_array_elements(pg_temp.workbench('{}',2)->'rows')) overlap),0::bigint,'stable pages have no repeated package/system results');

update review_fixture set proposal_id=pg_temp.propose(901);
select pg_temp.login(15,1);
select pg_temp.decide('approved',951);
select pg_temp.login(10,1);
select is(pg_temp.workbench('{"selection":"historical"}')->>'total','35','later selection makes source and both overlapping batches historical');
select is(pg_temp.workbench('{"selection":"current"}')->>'total','2','unaffected handoffs stay current');
select is(pg_temp.workbench('{"selection":"historical","system":"ERP","status":"received"}')->>'total','2','historical reports remain independently visible');
reset role;
-- Search includes saved event context, and current catalog edits do not rewrite it.
select pg_temp.login(10,1);
set local role authenticated;
select cmp_ok((pg_temp.workbench(jsonb_build_object('q',(select event_name from public.event_purchase_handoff_list where id=(select id from lines where n=0))))->>'total')::integer,'>',0,'saved event names are searchable');
select throws_ok($$select pg_temp.workbench('[]')$$,'MQ422',null,'non-object filters rejected');
select throws_ok($$select pg_temp.workbench(jsonb_build_object('q',repeat('x',101)))$$,'MQ422',null,'query length bounded');
select throws_ok($$select pg_temp.workbench(jsonb_build_object('system',E'bad\nlabel'))$$,'MQ422',null,'control characters rejected');
select throws_ok($$select pg_temp.workbench('{}',100001)$$,'MQ422',null,'deep page bounded');
select is(pg_temp.workbench('{}',1,50)->>'size','50','supported larger page size');
select is(pg_temp.workbench('{}',1,100)->>'size','100','maximum page size accepted');
select pg_temp.login(12,1);
select is(pg_temp.workbench()->>'total','37','assigned branch sees all permitted current and historical rows');
reset role;
delete from public.membership_locations where organization_id=pg_temp.id(1) and user_id=pg_temp.id(12) and location_id=pg_temp.id(20);
set local role authenticated;
select is(pg_temp.workbench()->>'total','0','removed receiving-location access hides rows and totals');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select pg_temp.workbench()$$,'MQ401',null,'missing session subject refused');
reset role;
select is((select count(*) from public.event_purchase_handoff_acknowledgements where organization_id=pg_temp.id(1)),37::bigint,'queries append no reports');
select * from finish();
rollback;
