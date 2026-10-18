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
select is(pg_temp.supplier_preview()->>'status','available','known matching supplier terms are available');
select is(pg_temp.supplier_preview()#>>'{baseline,quantity}','3','baseline gap 1.004 rounds to 3 at MOQ 2 pack 1.5');
select is(pg_temp.supplier_preview()#>>'{adjusted,quantity}','4.5','adjusted gap 3.263 rounds independently to 4.5');
select is(pg_temp.supplier_preview()#>>'{baseline,overage}','1.996','baseline overage is exact');
select is(pg_temp.supplier_preview()#>>'{adjusted,overage}','1.237','adjusted overage is exact');
select is(pg_temp.supplier_preview()->>'quantity_increase','1.5','increase compares rounded quantities');
select is(pg_temp.supplier_preview()->'draft',(select report from capture),'full immutable source evidence retained');
select is(pg_temp.supplier_preview()#>>'{draft,baseline,orders,1,late}','true','saved timing warning retained');
select is(pg_temp.supplier_preview('SUP',false)->>'status','terms_unconfirmed','confirmation required');
select throws_ok($$select pg_temp.supplier_save(401,null,'SUP',false)$$,'MQ422',null,'unavailable preview cannot save');
select throws_ok($$select pg_temp.supplier_preview(null)$$,'MQ422',null,'supplier required');
select throws_ok($$select pg_temp.supplier_preview('bad code')$$,'MQ422',null,'invalid supplier code rejected');
select throws_ok($$select pg_temp.supplier_preview('SUP',null)$$,'MQ422',null,'confirmation cannot be null');
select is(pg_temp.supplier_preview('OTHER')->>'status','supplier_missing','missing supplier explicit');
select throws_ok($$select pg_temp.supplier_save(401,repeat('a',64))$$,'MQ409',null,'forged fingerprint rejected');
update supplier_capture set saved=pg_temp.supplier_save();
select is(pg_temp.supplier_save(),(select saved from supplier_capture),'same request returns original');
select throws_ok($$select pg_temp.supplier_save(400,null,'OTHER')$$,'MQ409',null,'conflicting reuse rejected');
select is((select count(*)::integer from public.event_supplier_scenarios),1,'one immutable record');
select is((select count(*)::integer from public.supplier_scenarios where organization_id=pg_temp.id(1)),0,'no ordinary supplier scenario created');
select is((select count(*)::integer from public.open_orders where organization_id=pg_temp.id(1)),4,'no orders created');
select throws_ok($$insert into public.event_supplier_scenarios default values$$,'42501',null,'no direct insert');
select throws_ok($$update public.event_supplier_scenarios set report='{}'$$,'42501',null,'no direct update');
select throws_ok($$delete from public.event_supplier_scenarios$$,'42501',null,'no direct delete');
select pg_temp.login(11,1);
select is((select count(*)::integer from public.event_supplier_scenarios),1,'viewer reads');
select lives_ok($$select pg_temp.supplier_preview()$$,'viewer can inspect terms');
select throws_ok($$select pg_temp.supplier_save()$$,'MQ403',null,'viewer cannot save or retry');
select pg_temp.login(15,1);
select throws_ok($$select pg_temp.supplier_save()$$,'MQ403',null,'approver cannot save');
select pg_temp.login(12,1);
select is((select count(*)::integer from public.event_supplier_scenarios),0,'other branch cannot read');
select throws_ok($$select pg_temp.supplier_preview()$$,'MQ404',null,'definer enforces location access');
select pg_temp.login(13,2);
select is((select count(*)::integer from public.event_supplier_scenarios),0,'foreign tenant cannot read');
select throws_ok($$select pg_temp.supplier_preview()$$,'MQ404',null,'foreign tenant cannot preview');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.supplier_preview()$$,'MQ404',null,'active claim narrows membership');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
select pg_temp.login(12,1); set local role authenticated;
select is((select count(*)::integer from public.event_supplier_scenarios),1,'permitted branch reads history');
select lives_ok($$select pg_temp.supplier_preview()$$,'permitted branch inspects preview');
select throws_ok($$select pg_temp.supplier_save()$$,'MQ403',null,'branch cannot save');
select pg_temp.login(14,1);
select lives_ok($$select pg_temp.supplier_save(402)$$,'planner saves');
select pg_temp.login(16,1);
select lives_ok($$select pg_temp.supplier_save(403)$$,'admin saves');
select throws_ok($$select pg_temp.supplier_save()$$,'MQ409',null,'another author cannot retry');
reset role; select pg_temp.login(10,1);
select is((select count(*)::integer from public.audit_log where organization_id=pg_temp.id(1) and table_name='event_supplier_scenarios'),3,'one audit per new record');
update public.stock_snapshots set quantity=100 where organization_id=pg_temp.id(1);
update public.open_orders set quantity=100 where organization_id=pg_temp.id(1);
update public.inventory_policies set evidence=jsonb_set(evidence,'{options,lead_time}','5') where id=pg_temp.id(120);
select is(pg_temp.supplier_preview(),(select report from supplier_capture),'stock inbound and live policy changes do not refresh the saved draft');
update public.supplier_items set pack_size=2 where id=pg_temp.id(300);
select throws_ok($$select pg_temp.supplier_save(404,(select report->>'fingerprint' from supplier_capture))$$,'MQ409',null,'changed terms require refresh');
select is(pg_temp.supplier_preview()#>>'{adjusted,quantity}','4','fresh preview uses new pack');
select is(pg_temp.supplier_save(400,(select report->>'fingerprint' from supplier_capture)),(select saved from supplier_capture),'retry retains old evidence');
select is((select report from public.event_supplier_scenarios where id=(select saved from supplier_capture)),(select report from supplier_capture),'saved report unchanged after edits');
update public.suppliers set is_active=false where id=pg_temp.id(200);
select is(pg_temp.supplier_preview()->>'status','supplier_inactive','inactive supplier blocked');
update public.suppliers set is_active=true where id=pg_temp.id(200);
update public.supplier_items set unit_of_measure=null where id=pg_temp.id(300);
select is(pg_temp.supplier_preview()->>'status','unit_unknown','unknown units not inferred');
update public.supplier_items set unit_of_measure='KG' where id=pg_temp.id(300);
select is(pg_temp.supplier_preview()->>'status','unit_mismatch','mismatched units blocked');
update public.supplier_items set unit_of_measure='EA',lead_time_days=5 where id=pg_temp.id(300);
select is(pg_temp.supplier_preview()->>'status','lead_time_mismatch','matches saved lead 1 rather than current policy 5');
update public.supplier_items set lead_time_days=1 where id=pg_temp.id(300);
create function pg_temp.gaps(b text,a text) returns void language sql as $$
update public.event_replenishment_drafts set report=jsonb_set(jsonb_set(report,'{baseline_gap}',to_jsonb(b)),'{adjusted_gap}',to_jsonb(a)) where id=(select saved from capture)$$;
select pg_temp.gaps('0','0');
update public.supplier_items set min_order_quantity=20,pack_size=6 where id=pg_temp.id(300);
select is(pg_temp.supplier_preview()#>>'{baseline,quantity}','0','zero baseline ignores positive MOQ');
select is(pg_temp.supplier_preview()#>>'{adjusted,quantity}','0','zero adjusted ignores positive MOQ');
select is(pg_temp.supplier_preview('SUP',false)->>'status','terms_unconfirmed','zero gaps still need evidence confirmation');
select pg_temp.gaps('0','0.001');
select is(pg_temp.supplier_preview()#>>'{adjusted,quantity}','24','first positive gap triggers MOQ and pack');
select is(pg_temp.supplier_preview()->>'quantity_increase','24','zero-to-positive increase remains exact');
select pg_temp.gaps('1.125','1.126');
update public.supplier_items set min_order_quantity=1.5,pack_size=.25 where id=pg_temp.id(300);
select is(pg_temp.supplier_preview()#>>'{adjusted,quantity}','1.5','fractional packs preserved');
select is(pg_temp.supplier_preview()->>'quantity_increase','0','same pack absorbs added demand');
select pg_temp.gaps('999999999999999.998','999999999999999.999');
update public.supplier_items set min_order_quantity=0,pack_size=.001 where id=pg_temp.id(300);
select is(pg_temp.supplier_preview()#>>'{adjusted,quantity}','999999999999999.999','large exact boundary retained');
select is(pg_temp.supplier_preview()->>'quantity_increase','0.001','large small difference remains exact');
update public.supplier_items set pack_size=.002 where id=pg_temp.id(300);
select is(pg_temp.supplier_preview()->>'status','quantity_out_of_range','pack rounding overflow unavailable');
select is(pg_temp.supplier_preview()->'baseline','null'::jsonb,'overflow exposes no partial comparison');
select throws_ok($$select pg_temp.supplier_save(404)$$,'MQ422',null,'overflow cannot save');
select pg_temp.gaps('2','1');
select is(pg_temp.supplier_preview()->>'status','draft_unavailable','inconsistent source gaps fail closed');
select pg_temp.gaps('bad','1');
select is(pg_temp.supplier_preview()->>'status','draft_unavailable','malformed saved gap is unavailable');
select pg_temp.gaps('0','1');
delete from public.supplier_items where id=pg_temp.id(300);
select is(pg_temp.supplier_preview()->>'status','terms_missing','missing terms explicit');
set local role anon;
select throws_ok($$select * from public.event_supplier_scenarios$$,'42501',null,'anonymous cannot read');
select throws_ok($$select pg_temp.supplier_preview()$$,'42501',null,'anonymous cannot preview');
reset role;
delete from public.event_replenishment_drafts where id=(select saved from capture);
select is((select count(*)::integer from public.event_supplier_scenarios where organization_id=pg_temp.id(1)),0,'parent retention cascades');
select * from finish();
rollback;
