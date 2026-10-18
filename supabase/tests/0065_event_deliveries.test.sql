begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('99200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
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
insert into delivery_capture(report) select pg_temp.delivery_preview();
select is(pg_temp.delivery_preview()->>'status','available','known supplier and receiver calendars schedule');
select is(pg_temp.delivery_preview()->>'order_date','2026-10-11','supplier weekend shifts order');
select is(pg_temp.delivery_preview()->>'nominal_receipt','2026-10-12','saved lead is calendar days');
select is(pg_temp.delivery_preview()->>'receipt_date','2026-10-13','receiver closure shifts receipt');
select is(pg_temp.delivery_preview()->>'expected_receipt','2026-10-11','reference is saved cutoff plus lead');
select is(pg_temp.delivery_preview()->>'policy_recalculation_required','true','shift needs policy recalculation');
select is(pg_temp.delivery_preview()->'source',(select report from supplier_capture),'complete saved supplier evidence retained');
select is(pg_temp.delivery_preview()#>>'{source,baseline,quantity}','3','baseline quantity never recalculated');
select is(pg_temp.delivery_preview()#>>'{source,adjusted,quantity}','4.5','adjusted quantity never recalculated');
select is(pg_temp.delivery_preview()->'event_before_receipt','[{"date":"2026-10-11","quantity":"0.009"},{"date":"2026-10-12","quantity":"2.25"}]'::jsonb,'positive additions before receipt are exact evidence');
select is(pg_temp.delivery_preview()#>>'{source,draft,baseline,orders,1,late}','true','existing late-inbound warning retained');
select is(pg_temp.delivery_preview('2026-10-10',false)->>'status','calendars_unconfirmed','calendar confirmation explicit');
select throws_ok($$select pg_temp.delivery_save(601,null,'2026-10-10',false)$$,'MQ422',null,'unconfirmed schedules cannot save');
select throws_ok($$select pg_temp.delivery_preview(null)$$,'MQ422',null,'date required');
select throws_ok($$select pg_temp.delivery_preview('infinity')$$,'MQ422',null,'infinite date rejected');
select throws_ok($$select pg_temp.delivery_preview('2101-01-01')$$,'MQ422',null,'upper date bound enforced');
select throws_ok($$select pg_temp.delivery_preview('1899-12-31')$$,'MQ422',null,'lower date bound enforced');
select throws_ok($$select pg_temp.delivery_preview('2026-10-09')$$,'MQ422',null,'request cannot precede cutoff');
select throws_ok($$select pg_temp.delivery_preview('2026-10-10',null)$$,'MQ422',null,'confirmation cannot be null');
select throws_ok($$select pg_temp.delivery_save(601,repeat('a',64))$$,'MQ409',null,'forged fingerprint rejected');
update delivery_capture set saved=pg_temp.delivery_save();
select is(pg_temp.delivery_save(),(select saved from delivery_capture),'same request returns original');
select throws_ok($$select pg_temp.delivery_save(600,null,'2026-10-11')$$,'MQ409',null,'conflicting date reuse rejected');
select is((select count(*)::integer from public.event_delivery_scenarios),1,'one saved scenario');
select is((select count(*)::integer from public.delivery_scenarios where organization_id=pg_temp.id(1)),0,'no ordinary delivery created');
select is((select count(*)::integer from public.open_orders where organization_id=pg_temp.id(1)),4,'no orders created');
select throws_ok($$insert into public.event_delivery_scenarios default values$$,'42501',null,'no direct insert');
select throws_ok($$update public.event_delivery_scenarios set report='{}'$$,'42501',null,'no direct update');
select throws_ok($$delete from public.event_delivery_scenarios$$,'42501',null,'no direct delete');
select pg_temp.login(11,1);
select is((select count(*)::integer from public.event_delivery_scenarios),1,'viewer reads history');
select lives_ok($$select pg_temp.delivery_preview()$$,'viewer may inspect dates');
select throws_ok($$select pg_temp.delivery_save()$$,'MQ403',null,'viewer cannot save or retry');
select pg_temp.login(15,1);
select throws_ok($$select pg_temp.delivery_save()$$,'MQ403',null,'approver cannot save');
select pg_temp.login(12,1);
select is((select count(*)::integer from public.event_delivery_scenarios),0,'other branch cannot read');
select throws_ok($$select pg_temp.delivery_preview()$$,'MQ404',null,'definer enforces receiving scope');
select pg_temp.login(13,2);
select is((select count(*)::integer from public.event_delivery_scenarios),0,'foreign tenant cannot read');
select throws_ok($$select pg_temp.delivery_preview()$$,'MQ404',null,'foreign tenant cannot preview');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.delivery_preview()$$,'MQ404',null,'claim narrows membership');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
select pg_temp.login(12,1); set local role authenticated;
select is((select count(*)::integer from public.event_delivery_scenarios),1,'permitted branch reads');
select lives_ok($$select pg_temp.delivery_preview()$$,'permitted branch previews');
select throws_ok($$select pg_temp.delivery_save()$$,'MQ403',null,'branch cannot save');
select pg_temp.login(14,1);
select lives_ok($$select pg_temp.delivery_save(602)$$,'planner saves');
select pg_temp.login(16,1);
select lives_ok($$select pg_temp.delivery_save(603)$$,'admin saves');
select throws_ok($$select pg_temp.delivery_save()$$,'MQ409',null,'another author cannot reuse request');
reset role; select pg_temp.login(10,1);
select is((select count(*)::integer from public.audit_log where organization_id=pg_temp.id(1) and table_name='event_delivery_scenarios'),3,'one audit per new record');
update public.supplier_items set pack_size=100,lead_time_days=50 where organization_id=pg_temp.id(1);
update public.stock_snapshots set quantity=100 where organization_id=pg_temp.id(1);
delete from public.open_orders where organization_id=pg_temp.id(1);
select is(pg_temp.delivery_preview(),(select report from delivery_capture),'current terms stock and inbound do not refresh saved quantities or warnings');
update public.work_calendars set weekend_days='{}' where id=pg_temp.id(500);
select throws_ok($$select pg_temp.delivery_save(604,(select report->>'fingerprint' from delivery_capture))$$,'MQ409',null,'calendar edits require refresh');
select is(pg_temp.delivery_preview()->>'receipt_date','2026-10-11','refreshed calendar changes dates only');
select is(pg_temp.delivery_preview()->'event_before_receipt','[]'::jsonb,'same-day and later additions are not before receipt');
select is(pg_temp.delivery_preview()->>'policy_recalculation_required','false','no shift keeps reference date');
select is(pg_temp.delivery_save(600,(select report->>'fingerprint' from delivery_capture)),(select saved from delivery_capture),'retry retains original evidence after calendar edits');
select is((select report from public.event_delivery_scenarios where id=(select saved from delivery_capture)),(select report from delivery_capture),'history immutable');
update public.suppliers set is_active=false where id=pg_temp.id(200);
select is(pg_temp.delivery_preview()->>'status','supplier_unavailable','inactive supplier blocked');
update public.suppliers set is_active=true where id=pg_temp.id(200);
update public.locations set is_active=false where id=pg_temp.id(20);
select is(pg_temp.delivery_preview()->>'status','location_unavailable','inactive receiver blocked');
update public.locations set is_active=true where id=pg_temp.id(20);
update public.work_calendars set is_active=false where id=pg_temp.id(500);
select is(pg_temp.delivery_preview()->>'status','calendar_inactive','inactive assigned calendar blocked');
update public.work_calendars set is_active=true,observe_public_holidays=true where id=pg_temp.id(500);
select is(pg_temp.delivery_preview()->>'status','calendar_unknown','unverified public holiday coverage is unknown');
select is(pg_temp.delivery_preview()->>'blocked_stage','supplier','unknown supplier stage explicit');
select throws_ok($$select pg_temp.delivery_save(604)$$,'MQ422',null,'unknown calendars cannot save');
update public.work_calendars set observe_public_holidays=false where id=pg_temp.id(500);
update public.work_calendars set observe_public_holidays=true where id=pg_temp.id(501);
select is(pg_temp.delivery_preview()->>'blocked_stage','receiver','unknown receiving stage explicit');
update public.work_calendars set observe_public_holidays=false where id=pg_temp.id(501);
insert into public.holiday_overrides(id,organization_id,work_calendar_id,starts_on,ends_on,kind,name_en) values(pg_temp.id(503),pg_temp.id(1),pg_temp.id(500),'2026-10-10',date '2026-10-10'+89,'closure','Closed for ninety days');
select is(pg_temp.delivery_preview()->>'status','search_exhausted','bounded 90-closed-day search');
select is(jsonb_array_length(pg_temp.delivery_preview()#>'{order_search,days}'),90,'only 90 supplier dates examined');
delete from public.holiday_overrides where id=pg_temp.id(503);
update public.work_calendars set weekend_days='{}' where id=pg_temp.id(500);
create function pg_temp.quantities(b text,a text) returns void language sql as $$
update public.event_supplier_scenarios set report=jsonb_set(jsonb_set(report,'{baseline,quantity}',to_jsonb(b)),'{adjusted,quantity}',to_jsonb(a)) where id=(select saved from supplier_capture)$$;
select pg_temp.quantities('0','4.5');
select is(pg_temp.delivery_preview()->>'status','available','zero baseline still schedules positive adjusted quantity');
select is(pg_temp.delivery_preview()#>>'{source,baseline,quantity}','0','zero comparison retains no-order quantity');
select pg_temp.quantities('0','0');
update public.suppliers set is_active=false where id=pg_temp.id(200);
select is(pg_temp.delivery_preview('2026-10-10',false)->>'status','no_order_needed','both zero need neither active supplier nor calendar confirmation');
select is(pg_temp.delivery_preview()->'order_date','null'::jsonb,'zero quantities have no order date');
select is(pg_temp.delivery_preview()->'receipt_date','null'::jsonb,'zero quantities have no receipt date');
select is(pg_temp.delivery_preview()->'event_before_receipt','null'::jsonb,'without a receipt no event timing is inferred');
select lives_ok($$select pg_temp.delivery_save(604,null,'2026-10-10',false)$$,'zero result saves without fabricated schedule');
select pg_temp.quantities('4.5','3');
select is(pg_temp.delivery_preview()->>'status','source_unavailable','inconsistent source fails closed');
select pg_temp.quantities('bad','3');
select is(pg_temp.delivery_preview()->>'status','source_unavailable','malformed quantity fails closed');
set local role anon;
select throws_ok($$select * from public.event_delivery_scenarios$$,'42501',null,'anonymous cannot read');
select throws_ok($$select pg_temp.delivery_preview()$$,'42501',null,'anonymous cannot preview');
reset role;
delete from public.event_supplier_scenarios where id=(select saved from supplier_capture);
select is((select count(*)::integer from public.event_delivery_scenarios where organization_id=pg_temp.id(1)),0,'source retention cascades');
select * from finish();
rollback;
