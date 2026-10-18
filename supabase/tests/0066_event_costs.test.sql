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
update delivery_capture set saved=pg_temp.delivery_save();
create temporary table cost_capture(report jsonb,saved uuid);
grant all on cost_capture to authenticated;
create function pg_temp.cost_preview(confirmed boolean default true) returns jsonb language sql as $$
select public.event_purchase_cost_preview(pg_temp.id(1),(select saved from delivery_capture),confirmed)$$;
create function pg_temp.cost_save(request integer default 700,fp text default null,confirmed boolean default true) returns uuid language sql as $$
select public.event_purchase_cost_save(pg_temp.id(1),(select saved from delivery_capture),confirmed,pg_temp.id(request),coalesce(fp,pg_temp.cost_preview(confirmed)->>'fingerprint'))$$;
select is(pg_temp.cost_preview()->>'status','price_date_unknown','missing price date is not free');
select throws_ok($$select pg_temp.cost_save()$$,'MQ422',null,'missing price evidence cannot save');
reset role;
update public.supplier_items set unit_price=1.234,valid_from='2026-10-11' where id=pg_temp.id(300);
set local role authenticated;
insert into cost_capture(report) select pg_temp.cost_preview();
select is(pg_temp.cost_preview()->>'status','available','known confirmed price applies at adjusted order date');
select is(pg_temp.cost_preview()->'source',(select report from delivery_capture),'complete immutable delivery retained');
select is(pg_temp.cost_preview()#>>'{baseline,exact_product}','3.702','baseline exact product');
select is(pg_temp.cost_preview()#>>'{baseline,subtotal}','3.70','baseline currency rounding');
select is(pg_temp.cost_preview()#>>'{adjusted,exact_product}','5.5530','adjusted fractional exact product');
select is(pg_temp.cost_preview()#>>'{adjusted,subtotal}','5.55','adjusted currency rounding');
select is(pg_temp.cost_preview()->>'cost_increase','1.85','increase uses rounded subtotals');
select is(pg_temp.cost_preview()#>>'{price,unit_price}','1.234','unit price precision retained');
select is(pg_temp.cost_preview()#>>'{source,policy_recalculation_required}','true','policy timing warning retained without blocking cost');
select is(pg_temp.cost_preview()#>'{source,event_before_receipt}',(select report->'event_before_receipt' from delivery_capture),'event timing evidence retained');
select is(pg_temp.cost_preview(false)->>'status','price_unconfirmed','positive price requires applicability for both quantities');
select throws_ok($$select pg_temp.cost_save(701,null,false)$$,'MQ422',null,'unconfirmed prices cannot save');
select throws_ok($$select pg_temp.cost_preview(null)$$,'MQ422',null,'null confirmation rejected');
select throws_ok($$select pg_temp.cost_save(701,repeat('a',64))$$,'MQ409',null,'forged fingerprint rejected');
update cost_capture set saved=pg_temp.cost_save();
select is(pg_temp.cost_save(),(select saved from cost_capture),'identical retry returns original');
select throws_ok($$select pg_temp.cost_save(700,(select report->>'fingerprint' from cost_capture),false)$$,'MQ409',null,'conflicting applicability reuse rejected');
select is((select count(*)::integer from public.event_purchase_cost_estimates),1,'one saved comparison');
select is((select count(*)::integer from public.purchase_cost_estimates where organization_id=pg_temp.id(1)),0,'no ordinary purchasing estimate');
select is((select count(*)::integer from public.open_orders where organization_id=pg_temp.id(1)),4,'no orders created');
select throws_ok($$insert into public.event_purchase_cost_estimates default values$$,'42501',null,'direct insert denied');
select throws_ok($$update public.event_purchase_cost_estimates set report='{}'$$,'42501',null,'direct update denied');
select throws_ok($$delete from public.event_purchase_cost_estimates$$,'42501',null,'direct delete denied');
select pg_temp.login(11,1);
select is((select count(*)::integer from public.event_purchase_cost_estimates),1,'viewer reads history');
select lives_ok($$select pg_temp.cost_preview()$$,'viewer may inspect price evidence');
select throws_ok($$select pg_temp.cost_save()$$,'MQ403',null,'viewer cannot save or retry');
select pg_temp.login(15,1);
select throws_ok($$select pg_temp.cost_save()$$,'MQ403',null,'approver cannot save');
select pg_temp.login(12,1);
select is((select count(*)::integer from public.event_purchase_cost_estimates),0,'other branch cannot read');
select throws_ok($$select pg_temp.cost_preview()$$,'MQ404',null,'definer enforces receiving scope');
select pg_temp.login(13,2);
select is((select count(*)::integer from public.event_purchase_cost_estimates),0,'foreign tenant cannot read');
select throws_ok($$select pg_temp.cost_preview()$$,'MQ404',null,'foreign tenant cannot preview');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.cost_preview()$$,'MQ404',null,'active claim narrows membership');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
select pg_temp.login(12,1); set local role authenticated;
select is((select count(*)::integer from public.event_purchase_cost_estimates),1,'permitted branch reads');
select lives_ok($$select pg_temp.cost_preview()$$,'permitted branch previews');
select throws_ok($$select pg_temp.cost_save()$$,'MQ403',null,'branch cannot save');
select pg_temp.login(14,1);
select lives_ok($$select pg_temp.cost_save(702)$$,'planner saves');
select pg_temp.login(16,1);
select lives_ok($$select pg_temp.cost_save(703)$$,'admin saves');
select throws_ok($$select pg_temp.cost_save()$$,'MQ409',null,'another author cannot reuse request');
reset role; select pg_temp.login(10,1);
select is((select count(*)::integer from public.audit_log where organization_id=pg_temp.id(1) and table_name='event_purchase_cost_estimates'),3,'one audit entry per new comparison');
update public.supplier_items set unit_price=2 where id=pg_temp.id(300);
select throws_ok($$select pg_temp.cost_save(704,(select report->>'fingerprint' from cost_capture))$$,'MQ409',null,'price edits require refreshed preview');
select is(pg_temp.cost_save(700,(select report->>'fingerprint' from cost_capture)),(select saved from cost_capture),'retry retains original price after edits');
select is((select report from public.event_purchase_cost_estimates where id=(select saved from cost_capture)),(select report from cost_capture),'history immutable');
update public.stock_snapshots set quantity=100 where organization_id=pg_temp.id(1);
delete from public.open_orders where organization_id=pg_temp.id(1);
update public.supplier_items set pack_size=100,lead_time_days=50 where id=pg_temp.id(300);
update public.work_calendars set observe_public_holidays=true where organization_id=pg_temp.id(1);
select is(pg_temp.cost_preview()->'source',(select report from delivery_capture),'current stock inbound terms and calendars cannot recalculate source');
update public.suppliers set is_active=false where id=pg_temp.id(200);
select is(pg_temp.cost_preview()->>'status','supplier_unavailable','inactive supplier blocked');
select throws_ok($$select pg_temp.cost_save(704)$$,'MQ422',null,'inactive supplier prevents saving');
update public.suppliers set is_active=true where id=pg_temp.id(200);
update public.locations set is_active=false where id=pg_temp.id(20);
select is(pg_temp.cost_preview()->>'status','location_unavailable','inactive receiver blocked');
update public.locations set is_active=true where id=pg_temp.id(20);
update public.supplier_items set id=pg_temp.id(301) where id=pg_temp.id(300);
select is(pg_temp.cost_preview()->>'status','terms_missing','recreated supplier-item pair cannot replace original identity');
update public.supplier_items set id=pg_temp.id(300),unit_of_measure=null where id=pg_temp.id(301);
select is(pg_temp.cost_preview()->>'status','unit_unknown','missing supplied unit blocked');
update public.supplier_items set unit_of_measure='SET' where id=pg_temp.id(300);
select is(pg_temp.cost_preview()->>'status','unit_mismatch','price unit must match saved quantity');
update public.supplier_items set unit_of_measure='EA',valid_from='2026-10-12' where id=pg_temp.id(300);
select is(pg_temp.cost_preview()->>'status','price_not_effective','price must apply by saved adjusted order date');
update public.supplier_items set valid_from='infinity' where id=pg_temp.id(300);
select is(pg_temp.cost_preview()->>'status','price_date_unknown','infinite date not evidence');
update public.supplier_items set valid_from='2026-10-11',unit_price='NaN' where id=pg_temp.id(300);
select is(pg_temp.cost_preview()->>'status','price_invalid','nonfinite price blocked');
update public.supplier_items set unit_price=0 where id=pg_temp.id(300);
select is(pg_temp.cost_preview()->>'status','available','explicit zero price allowed with evidence');
select is((pg_temp.cost_preview()->>'cost_increase')::numeric,0::numeric,'zero price gives zero increase');
select is(pg_temp.cost_preview(false)->>'status','price_unconfirmed','zero price still needs applicability');
update public.supplier_items set unit_price=1.234,currency='KWD' where id=pg_temp.id(300);
select is(pg_temp.cost_preview()#>>'{adjusted,subtotal}','5.553','three-decimal currency preserved');
select is(pg_temp.cost_preview()->>'cost_increase','1.851','three-decimal difference');
create function pg_temp.cost_quantities(b text,a text) returns void language sql as $$
update public.event_delivery_scenarios set report=jsonb_set(jsonb_set(report,'{source,baseline,quantity}',to_jsonb(b)),'{source,adjusted,quantity}',to_jsonb(a)) where id=(select saved from delivery_capture)$$;
select pg_temp.cost_quantities('0.001','0.002');
update public.supplier_items set unit_price=5,currency='SAR' where id=pg_temp.id(300);
select is(pg_temp.cost_preview()#>>'{baseline,subtotal}','0.01','half-up rounds baseline independently');
select is(pg_temp.cost_preview()#>>'{adjusted,subtotal}','0.01','adjusted subtotal rounded independently');
select is(pg_temp.cost_preview()->>'cost_increase','0.00','difference is not rounded quantity-gap times price');
select pg_temp.cost_quantities('0','4.5');
select is(pg_temp.cost_preview()#>>'{baseline,subtotal}','0.00','zero side shares known price currency without ordering');
select pg_temp.cost_quantities('999999999999999.998','999999999999999.999');
update public.supplier_items set unit_price=0.001 where id=pg_temp.id(300);
select is(pg_temp.cost_preview()#>>'{adjusted,exact_product}','999999999999.999999','large exact product does not use binary floats');
update public.supplier_items set unit_price=2 where id=pg_temp.id(300);
select is(pg_temp.cost_preview()->>'status','amount_out_of_range','monetary overflow unavailable');
select is(pg_temp.cost_preview()->'cost_increase','null'::jsonb,'overflow cannot show partial totals');
select throws_ok($$select pg_temp.cost_save(704)$$,'MQ422',null,'overflow cannot save');
select pg_temp.cost_quantities('0','0');
update public.event_delivery_scenarios set report=report||'{"status":"no_order_needed","order_date":null,"receipt_date":null}' where id=(select saved from delivery_capture);
update public.suppliers set is_active=false where id=pg_temp.id(200);
update public.locations set is_active=false where id=pg_temp.id(20);
select is(pg_temp.cost_preview(false)->>'status','no_order_needed','both zero require no active trading entities or price');
select is(pg_temp.cost_preview()->'price','null'::jsonb,'no-order does not fabricate a price or currency');
select lives_ok($$select pg_temp.cost_save(704,null,false)$$,'no-order outcome may save');
select pg_temp.cost_quantities('4.5','3');
select is(pg_temp.cost_preview()->>'status','source_unavailable','inconsistent quantities fail closed');
select pg_temp.cost_quantities('bad','3');
select is(pg_temp.cost_preview()->>'status','source_unavailable','malformed quantity fails closed');
set local role anon;
select throws_ok($$select * from public.event_purchase_cost_estimates$$,'42501',null,'anonymous cannot read');
select throws_ok($$select pg_temp.cost_preview()$$,'42501',null,'anonymous cannot preview');
reset role;
delete from public.event_delivery_scenarios where id=(select saved from delivery_capture);
select is((select count(*)::integer from public.event_purchase_cost_estimates where organization_id=pg_temp.id(1)),0,'parent retention cascades');
select * from finish();
rollback;
