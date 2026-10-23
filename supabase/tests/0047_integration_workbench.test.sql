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
select pg_temp.login(10,1);
insert into batches(id) select public.purchase_handoff_batch_create(pg_temp.id(1),array_agg(id order by id)) from lines where n in(0,2);
update batches set payload=b.payload from public.purchase_handoff_batches b where b.id=batches.id;
update public.purchase_handoffs set created_at='2026-10-01T00:00:00Z' where organization_id=pg_temp.id(1);
insert into public.purchase_handoff_acknowledgements(id,organization_id,location_id,handoff_id,client_event_id,api_key_id,external_system,external_reference,status,reason,recorded_at)
select pg_temp.id(v.n),pg_temp.id(1),pg_temp.id(20),l.id,pg_temp.id(v.n+100),pg_temp.id(4000),v.label,v.ref,v.status,v.reason,v.at::timestamptz
from (values
 (2000,0,'ERP','old-reference','rejected','Old rejection','2026-10-02'),
 (2001,0,'ERP','current-reference','received',null,'2026-10-03'),
 (2002,0,'erp','case-reference','rejected','Case-sensitive system','2026-10-03'),
 (2003,0,' ERP ','space-reference','rejected','Space-sensitive system','2026-10-03'),
 (2010,1,'WMS','warehouse-reference','rejected','Missing mapping','2026-10-02')
) v(n,item,label,ref,status,reason,at) join lines l on l.n=v.item;
insert into public.purchase_handoff_acknowledgements(id,organization_id,location_id,batch_id,client_event_id,api_key_id,external_system,external_reference,status,recorded_at)
select pg_temp.id(2020),pg_temp.id(1),pg_temp.id(20),id,pg_temp.id(2120),pg_temp.id(4000),'ERP','batch-reference','received','2026-10-02' from batches order by batches.id limit 1;
create function pg_temp.workbench(filters jsonb default '{}',page integer default 1,size integer default 25) returns jsonb language sql as $$select public.handoff_integration_workbench(pg_temp.id(1),filters,page,size)$$;
create temporary table before_reads as select
  (select jsonb_agg(to_jsonb(a) order by id) from public.purchase_handoff_acknowledgements a) events,
  (select count(*) from public.audit_log) audits,
  (select count(*) from public.open_orders) orders,
  (select count(*) from public.receipts) receipts,
  (select count(*) from public.stock_snapshots) stock;
grant select on lines,batches,fixture to authenticated;
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
select is(pg_temp.workbench(jsonb_build_object('supplier',(select original#>>'{estimate,source,supplier_code}' from lines where n=0)))->>'total','7','saved supplier context is searchable');
select is(pg_temp.workbench('{}',999)->>'page','1','out-of-range page resolves to last page');
select throws_ok($$select pg_temp.workbench('{"status":"failed"}')$$,'MQ422',null,'failed is not a reported status');
select throws_ok($$select pg_temp.workbench('{"system":"   "}')$$,'MQ422',null,'blank system rejected');
select throws_ok($$select pg_temp.workbench('{"q":null}')$$,'MQ422',null,'non-string filter rejected');
select throws_ok($$select pg_temp.workbench('{"secret":true}')$$,'MQ422',null,'unknown filter rejected');
select throws_ok($$select pg_temp.workbench(jsonb_build_object('system',repeat('x',81)))$$,'MQ422',null,'system bounded');
select throws_ok($$select pg_temp.workbench('{}',0)$$,'MQ422',null,'positive page required');
select throws_ok($$select pg_temp.workbench('{}',1,101)$$,'MQ422',null,'page size bounded');
select throws_ok($$select public.handoff_integration_workbench(pg_temp.id(2))$$,'MQ404',null,'cross-tenant organization refused');
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
select ok(not has_function_privilege('zeespare_worker','public.handoff_integration_workbench(uuid,jsonb,integer,integer)','EXECUTE'),'worker RPC denied');
select is((select jsonb_agg(to_jsonb(a) order by id) from public.purchase_handoff_acknowledgements a),(select events from before_reads),'read preserves events');
select is((select count(*) from public.open_orders),(select orders from before_reads),'no order writes');
select is((select count(*) from public.receipts),(select receipts from before_reads),'no receipt writes');
select is((select count(*) from public.stock_snapshots),(select stock from before_reads),'no stock writes');
select is(h.payload,l.original,'individual exports unchanged') from lines l join public.purchase_handoffs h on h.id=l.id;
select is(b.payload,f.payload,'batch exports unchanged') from batches f join public.purchase_handoff_batches b on b.id=f.id;

-- A rotated reporting key and an exact timestamp tie still select one stable report.
insert into public.purchase_handoff_acknowledgements(id,organization_id,location_id,handoff_id,client_event_id,api_key_id,external_system,external_reference,status,recorded_at)
select pg_temp.id(1999),pg_temp.id(1),pg_temp.id(20),id,pg_temp.id(2099),pg_temp.id(4001),'ERP','tied-reference','received','2026-10-03' from lines where n=0;
insert into public.purchase_handoff_acknowledgements(id,organization_id,location_id,handoff_id,client_event_id,api_key_id,external_system,external_reference,status)
select pg_temp.id(3000+s.n),pg_temp.id(1),pg_temp.id(20),l.id,pg_temp.id(5000+s.n),pg_temp.id(4001),'System-'||s.n,'reference-'||s.n,'received' from lines l cross join generate_series(1,30) s(n) where l.n=0;
select pg_temp.login(10,1);
set local role authenticated;
select is(pg_temp.workbench('{"system":"ERP","q":"tied-reference"}')#>>'{rows,0,event_id}',pg_temp.id(1999)::text,'UUID resolves equal timestamps across key rotation');
select is(pg_temp.workbench()->>'total','37','many systems count results, not packages');
select is(jsonb_array_length(pg_temp.workbench()->'rows'),25,'page size enforced');
select is(jsonb_array_length(pg_temp.workbench('{}',2)->'rows'),12,'second page returns remainder');
select is(pg_temp.workbench('{}',999)->>'page','2','deep page clamps to last');
select is((select count(*) from (select value->>'id',value->>'external_system' from jsonb_array_elements(pg_temp.workbench()->'rows') intersect select value->>'id',value->>'external_system' from jsonb_array_elements(pg_temp.workbench('{}',2)->'rows')) overlap),0::bigint,'stable pages have no repeated package/system results');

update fixture set proposal_id=pg_temp.propose(901);
select pg_temp.login(14,1);
select pg_temp.decide('approved',951);
select pg_temp.login(10,1);
select is(pg_temp.workbench('{"selection":"historical"}')->>'total','35','later selection makes source and both overlapping batches historical');
select is(pg_temp.workbench('{"selection":"current"}')->>'total','2','unaffected handoffs stay current');
select is(pg_temp.workbench('{"selection":"historical","system":"ERP","status":"received"}')->>'total','2','historical reports remain independently visible');
reset role;
select * from finish();
rollback;
