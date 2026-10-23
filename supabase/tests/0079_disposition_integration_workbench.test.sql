begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('a5000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer default 1) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'excess-'||n||'@test.local' from generate_series(10,16) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'excess-a','Excess A'),(pg_temp.id(2),'excess-b','Excess B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),
 (pg_temp.id(1),pg_temp.id(12),'branch_user'),(pg_temp.id(2),pg_temp.id(13),'owner'),(pg_temp.id(1),pg_temp.id(14),'planner'),(pg_temp.id(1),pg_temp.id(15),'approver'),(pg_temp.id(1),pg_temp.id(16),'admin');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone)
 select pg_temp.id(20+n),pg_temp.id(case when n=2 then 2 else 1 end),'L'||n,'Location','branch','SA','Asia/Riyadh' from generate_series(0,2) n;
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
 select pg_temp.id(100+n),pg_temp.id(1),'ITEM-'||n,'Item','Test','SET',999,'SAR' from generate_series(1,55) n;
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 select pg_temp.id(200+n),pg_temp.id(case when n=56 then 2 else 1 end),pg_temp.id(case when n=56 then 22 when n=53 then 21 else 20 end),pg_temp.id(300+n),
 '2026-01-01','2026-10-10','policy','succeeded','{}',now(),'{}' from generate_series(1,56) n;
insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
 select pg_temp.id(1000+n),pg_temp.id(case when n=56 then 2 else 1 end),pg_temp.id(200+n),pg_temp.id(case when n=56 then 22 when n=53 then 21 else 20 end),pg_temp.id(400+n),
 pg_temp.id(case when n=52 then 101 else 100+n end),'ITEM-'||n,case when n=2 then 'KG' else 'EA' end,'available',
 '{"protection":{"target":"10.001"}}',
 jsonb_build_object('options',jsonb_build_object('lead_time',3,'review_interval',4),'forecast',jsonb_build_object('to_date',case when n=54 then '2026-10-09' else '2026-10-10' end,
 'method',case when n=55 then 'regional-v1' else 'baseline-v1' end,'source',jsonb_build_object('unit_provenance',
 jsonb_build_object('method','source-units-v1','status','consistent','unit',case when n=2 then 'KG' else 'EA' end,'rows',1,'unknown_rows',0,'units',jsonb_build_array(case when n=2 then 'KG' else 'EA' end)))))
 from generate_series(1,56) n;
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
 select pg_temp.id(1),pg_temp.id(100+n),pg_temp.id(20),case when n=3 then date '2026-10-03' else date '2026-10-10' end,
 case when n=4 then 1 else 30.001 end,2,case when n=3 then 0.333 else 1.125 end,case when n=2 then 'SAR' else 'KWD' end,case when n=2 then 'KG' else 'EA' end
 from generate_series(1,51) n;
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
 values(pg_temp.id(1),pg_temp.id(101),pg_temp.id(20),'2026-10-11',999,0,999,'SAR','KG');
insert into public.policy_overrides(id,organization_id,policy_id,location_id,revision,request_id,submitted_by,reorder_point,order_up_to,reason,status,decided_by,decided_at,decision_reason,decision_request_id)
 select pg_temp.id(60+n),pg_temp.id(1),pg_temp.id(1001),pg_temp.id(20),n,pg_temp.id(70+n),pg_temp.id(14),1,10.001+2*n,'Explicit maximum',
 'approved',pg_temp.id(10),now(),'Approved independently',pg_temp.id(80+n) from generate_series(1,2) n;
create function pg_temp.choices(ns integer[] default array[1,2,3,4]) returns jsonb language sql as $$select jsonb_agg(jsonb_build_object('policy_id',pg_temp.id(1000+n),'maximum','calculated')) from unnest(ns) n$$;

update public.stock_snapshots set quantity=30.001,currency='KWD' where snapshot_date<='2026-10-10';
create temporary table fixture(n integer,assessment uuid,proposal uuid,handoff uuid);
create temporary table batches(ids uuid[],id uuid,payload jsonb);
grant all on fixture,batches to authenticated;
create function pg_temp.ids(ns integer[] default array[1,2]) returns uuid[] language sql as $$select array_agg(handoff order by n) from fixture where n=any(ns)$$;
create function pg_temp.preview(ns integer[] default array[1,2]) returns jsonb language sql as $$select public.excess_disposition_handoff_batch_preview(pg_temp.id(1),pg_temp.ids(ns))$$;
create function pg_temp.batch(ns integer[] default array[1,2]) returns uuid language sql as $$select public.excess_disposition_handoff_batch_create(pg_temp.id(1),pg_temp.ids(ns))$$;
select pg_temp.login(14);
set local role authenticated;
do $$declare a uuid; p uuid; h uuid; n integer; choices jsonb;
begin
 for n in 1..3 loop
  choices:=pg_temp.choices(array[n]);
  a:=public.excess_stock_save(pg_temp.id(1),choices,'Batch source',true,gen_random_uuid(),public.excess_stock_preview(pg_temp.id(1),choices)->>'fingerprint');
  p:=public.excess_disposition_submit(pg_temp.id(1),a,pg_temp.id(100+n),'scrap','3.333',gen_random_uuid(),'Batch disposition');
  perform pg_temp.login(10);
  perform public.excess_disposition_decide(pg_temp.id(1),p,gen_random_uuid(),'approved','Independent review');
  perform pg_temp.login(14);
  h:=public.excess_disposition_handoff_create(pg_temp.id(1),p);
  insert into fixture values(n,a,p,h);
 end loop;
end; $$;
insert into batches(ids,id) values(pg_temp.ids(),pg_temp.batch());
reset role;
update batches set payload=b.payload from public.excess_disposition_handoff_batches b where b.id=batches.id;
create temporary table lines as select f.n-1 n,h.id,h.payload original from fixture f join public.excess_disposition_handoffs h on h.id=f.handoff;
update public.excess_disposition_handoffs set created_at='2026-10-01T00:00:00Z' where organization_id=pg_temp.id(1);

set local role authenticated;
insert into batches(ids,id) values(pg_temp.ids(array[1,3]),pg_temp.batch(array[1,3]));
reset role;
update batches set payload=b.payload from public.excess_disposition_handoff_batches b where b.id=batches.id;
insert into public.excess_disposition_handoff_acknowledgements(id,organization_id,location_id,handoff_id,client_event_id,api_key_id,external_system,external_reference,status,reason,recorded_at)
select pg_temp.id(v.n),pg_temp.id(1),pg_temp.id(20),l.id,pg_temp.id(v.n+100),pg_temp.id(4000),v.label,v.ref,v.status,v.reason,v.at::timestamptz
from (values
 (2000,0,'ERP','old-reference','rejected','Old rejection','2026-10-02'),
 (2001,0,'ERP','current-reference','received',null,'2026-10-03'),
 (2002,0,'erp','case-reference','rejected','Case-sensitive system','2026-10-03'),
 (2003,0,' ERP ','space-reference','rejected','Space-sensitive system','2026-10-03'),
 (2010,1,'WMS','warehouse-reference','rejected','Missing mapping','2026-10-02')
) v(n,item,label,ref,status,reason,at) join lines l on l.n=v.item;
insert into public.excess_disposition_handoff_acknowledgements(id,organization_id,location_id,batch_id,client_event_id,api_key_id,external_system,external_reference,status,recorded_at)
select pg_temp.id(2020),pg_temp.id(1),pg_temp.id(20),id,pg_temp.id(2120),pg_temp.id(4000),'ERP','batch-reference','received','2026-10-02' from batches order by batches.id limit 1;
create function pg_temp.workbench(filters jsonb default '{}',page integer default 1,size integer default 25) returns jsonb language sql as $$select public.excess_disposition_integration_workbench(pg_temp.id(1),filters,page,size)$$;
create temporary table before_reads as select
  (select jsonb_agg(to_jsonb(a) order by id) from public.excess_disposition_handoff_acknowledgements a) events,
  (select count(*) from public.audit_log) audits,
  (select count(*) from public.open_orders) orders,
  (select count(*) from public.receipts) receipts,
  (select count(*) from public.stock_snapshots) stock;
grant select on lines,batches,fixture to authenticated;
select pg_temp.login(10,1);
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
select is(pg_temp.workbench('{"intent":"supplier_return"}')->>'total','0','return filter excludes scrap');
select is(pg_temp.workbench('{"intent":"scrap"}')->>'total','7','saved disposition intent filter');
select is(pg_temp.workbench('{}',999)->>'page','1','out-of-range page resolves to last page');
select throws_ok($$select pg_temp.workbench('{"status":"failed"}')$$,'MQ422',null,'failed is not a reported status');
select throws_ok($$select pg_temp.workbench('{"system":"   "}')$$,'MQ422',null,'blank system rejected');
select throws_ok($$select pg_temp.workbench('{"q":null}')$$,'MQ422',null,'non-string filter rejected');
select throws_ok($$select pg_temp.workbench('{"secret":true}')$$,'MQ422',null,'unknown filter rejected');
select throws_ok($$select pg_temp.workbench(jsonb_build_object('system',repeat('x',81)))$$,'MQ422',null,'system bounded');
select throws_ok($$select pg_temp.workbench('{}',0)$$,'MQ422',null,'positive page required');
select throws_ok($$select pg_temp.workbench('{}',1,101)$$,'MQ422',null,'page size bounded');
select throws_ok($$select public.excess_disposition_integration_workbench(pg_temp.id(2))$$,'MQ404',null,'cross-tenant organization refused');
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
select ok(not has_function_privilege('zeespare_worker','public.excess_disposition_integration_workbench(uuid,jsonb,integer,integer)','EXECUTE'),'worker RPC denied');
select is((select jsonb_agg(to_jsonb(a) order by id) from public.excess_disposition_handoff_acknowledgements a),(select events from before_reads),'read preserves events');
select is((select count(*) from public.open_orders),(select orders from before_reads),'no order writes');
select is((select count(*) from public.receipts),(select receipts from before_reads),'no receipt writes');
select is((select count(*) from public.stock_snapshots),(select stock from before_reads),'no stock writes');
select is(h.payload,l.original,'individual exports unchanged') from lines l join public.excess_disposition_handoffs h on h.id=l.id;
select is(b.payload,f.payload,'batch exports unchanged') from batches f join public.excess_disposition_handoff_batches b on b.id=f.id;

-- A rotated reporting key and an exact timestamp tie still select one stable report.
insert into public.excess_disposition_handoff_acknowledgements(id,organization_id,location_id,handoff_id,client_event_id,api_key_id,external_system,external_reference,status,recorded_at)
select pg_temp.id(1999),pg_temp.id(1),pg_temp.id(20),id,pg_temp.id(2099),pg_temp.id(4001),'ERP','tied-reference','received','2026-10-03' from lines where n=0;
insert into public.excess_disposition_handoff_acknowledgements(id,organization_id,location_id,handoff_id,client_event_id,api_key_id,external_system,external_reference,status)
select pg_temp.id(3000+s.n),pg_temp.id(1),pg_temp.id(20),l.id,pg_temp.id(5000+s.n),pg_temp.id(4001),'System-'||s.n,'reference-'||s.n,'received' from lines l cross join generate_series(1,30) s(n) where l.n=0;
select pg_temp.login(10,1);
set local role authenticated;
select is(pg_temp.workbench('{"system":"ERP","q":"tied-reference"}')#>>'{rows,0,event_id}',pg_temp.id(1999)::text,'UUID resolves equal timestamps across key rotation');
select is(pg_temp.workbench()->>'total','37','many systems count results, not packages');
select is(jsonb_array_length(pg_temp.workbench()->'rows'),25,'page size enforced');
select is(jsonb_array_length(pg_temp.workbench('{}',2)->'rows'),12,'second page returns remainder');
select is(pg_temp.workbench('{}',999)->>'page','2','deep page clamps to last');
select is((select count(*) from (select value->>'id',value->>'external_system' from jsonb_array_elements(pg_temp.workbench()->'rows') intersect select value->>'id',value->>'external_system' from jsonb_array_elements(pg_temp.workbench('{}',2)->'rows')) overlap),0::bigint,'stable pages have no repeated package/system results');

select pg_temp.login(14,1);
do $$declare p uuid;
begin
 p:=public.excess_disposition_submit(pg_temp.id(1),(select assessment from fixture where n=1),pg_temp.id(101),'supplier_return','2.000',gen_random_uuid(),'Replacement');
 perform pg_temp.login(10);
 perform public.excess_disposition_decide(pg_temp.id(1),p,gen_random_uuid(),'approved','Independent replacement');
end; $$;
select pg_temp.login(10,1);
select is(pg_temp.workbench('{"selection":"historical"}')->>'total','35','later selection makes source and both overlapping batches historical');
select is(pg_temp.workbench('{"selection":"current"}')->>'total','2','unaffected handoffs stay current');
select is(pg_temp.workbench('{"selection":"historical","system":"ERP","status":"received"}')->>'total','2','historical reports remain independently visible');
reset role;
-- Search uses the saved item/assessment context.
select pg_temp.login(10,1);
set local role authenticated;
select cmp_ok((pg_temp.workbench('{"q":"ITEM-1"}')->>'total')::integer,'>',0,'saved item codes are searchable');
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
select is((select count(*) from public.excess_disposition_handoff_acknowledgements where organization_id=pg_temp.id(1)),37::bigint,'queries append no reports');

select pg_temp.login(10,1);
set local role authenticated;
select throws_ok($$select pg_temp.workbench('{"intent":"write_off"}')$$,'MQ422',null,'unknown intent rejected');
select throws_ok($$select pg_temp.workbench('{"selection":"selected"}')$$,'MQ422',null,'unknown context rejected');
select is(pg_temp.workbench('{"selection":"unavailable"}')->>'total','0','complete historical context is not unavailable');
reset role;
-- Source deletion removes singles, while both copied overlapping batches and their own report survive.
delete from public.excess_stock_assessments where id=(select assessment from fixture where n=1);
select pg_temp.login(10,1);
set local role authenticated;
select is(pg_temp.workbench('{"selection":"unavailable"}')->>'total','2','both copied batches remain searchable after source deletion');
select is(pg_temp.workbench('{"selection":"unavailable","system":"ERP","status":"received"}')->>'total','1','retained batch report remains independent of unavailable context');
select is(pg_temp.workbench('{"selection":"unavailable","system":"ERP","status":"no_report"}')->>'total','1','overlapping batch has no inferred report');
select is(pg_temp.workbench('{"selection":"unavailable","system":"Unknown","status":"no_report"}')->>'total','2','selected system absence includes retained batches');
select is(pg_temp.workbench('{"selection":"unavailable","q":"ITEM-1"}')->>'total','2','copied item search evidence survives source deletion');
select is((select count(*) from jsonb_array_elements(pg_temp.workbench('{"kind":"handoff"}')->'rows') r where r->>'id'=(select id::text from lines where n=0)),0::bigint,'deleted single is absent');
select is(pg_temp.workbench('{"selection":"current"}')->>'total','2','unaffected singles remain current');
select pg_temp.login(12,1);
select is(pg_temp.workbench('{"selection":"unavailable"}')->>'total','0','retained batch counts still respect removed branch access');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
set local role authenticated;
select is(pg_temp.workbench('{"selection":"unavailable"}')->>'total','2','authorized branch can inspect retained copied batches');
reset role;
select is(b.payload,f.payload,'copied batch original evidence unchanged after source deletion') from batches f join public.excess_disposition_handoff_batches b on b.id=f.id;
select ok(not p.prosecdef and p.provolatile='s','workbench is stable invoker') from pg_proc p where p.oid='public.excess_disposition_integration_workbench(uuid,jsonb,integer,integer)'::regprocedure;
select * from finish();
rollback;
