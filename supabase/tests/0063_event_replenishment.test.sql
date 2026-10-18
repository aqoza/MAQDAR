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
update capture set report=pg_temp.preview();
select is(pg_temp.preview()->>'status','available','matching saved scenario and exact-cutoff feeds are available');
select is(pg_temp.preview()#>>'{baseline,inventory_position}','2.999','same exact position: 2.001 - 1.001 + 2.001 - .002');
select is(pg_temp.preview()->>'baseline_gap','1.004','baseline maximum 4.003 minus position');
select is(pg_temp.preview()->>'adjusted_gap','3.263','event maximum 6.262 minus same position');
select is(pg_temp.preview()->>'gap_increase','2.259','exact incremental gap');
select is(pg_temp.preview()#>>'{baseline,inbound_quantity}','2.001','remaining inbound counted without deducting receipts again');
select is(pg_temp.preview()#>>'{baseline,orders,0,overdue}','true','overdue inbound retained and flagged');
select is(pg_temp.preview()#>>'{baseline,orders,1,late}','true','late inbound retained and flagged');
select is(pg_temp.preview()#>>'{baseline,policy,basis}','calculated','no approved override carried forward');
select is(pg_temp.preview()->'scenario',(select report from public.event_policy_scenarios where id=(select scenario from capture)),'entire saved scenario captured');
select is(pg_temp.preview('0',false)->>'status','orders_unconfirmed','inbound requires explicit completeness confirmation');
select is(pg_temp.preview('0',true,false)->>'status','event_unconfirmed','event must be absent from allocations and backorders');
select is(pg_temp.preview('0',true,false)->>'adjusted_gap',null,'unconfirmed event has no actionable gap');
select throws_ok($$select pg_temp.save(221,null,'0',true,false)$$,'MQ422',null,'unconfirmed preview cannot be saved');
select throws_ok($$select pg_temp.preview('-1')$$,'MQ422',null,'negative backorders rejected');
select throws_ok($$select pg_temp.preview('0.0001')$$,'MQ422',null,'excess precision rejected');
select throws_ok($$select pg_temp.preview(null)$$,'MQ422',null,'missing backorders are not zero');
select throws_ok($$select pg_temp.preview('NaN')$$,'MQ422',null,'nonfinite input rejected');
select throws_ok($$select pg_temp.preview('0',null)$$,'MQ422',null,'missing orders confirmation rejected');
select throws_ok($$select pg_temp.preview('0',true,null)$$,'MQ422',null,'missing event confirmation rejected');
select throws_ok($$select pg_temp.save(221,repeat('a',64))$$,'MQ409',null,'forged preview rejected');
update capture set saved=pg_temp.save();
select is(pg_temp.save(),(select saved from capture),'identical retry returns original');
select is(pg_temp.save(220,null,'00.002'),(select saved from capture),'equivalent decimal retry returns original');
select throws_ok($$select pg_temp.save(220,null,'1')$$,'MQ409',null,'changed request input rejected');
select is((select count(*)::integer from public.event_replenishment_drafts),1,'one record per retry identity');
select is((select count(*)::integer from public.replenishment_drafts where organization_id=pg_temp.id(1)),0,'no ordinary draft created');
select is((select count(*)::integer from public.supplier_scenarios where organization_id=pg_temp.id(1)),0,'no supplier scenario created');
select is((select count(*)::integer from public.open_orders where organization_id=pg_temp.id(1)),4,'no inbound order created');
select throws_ok($$update public.event_replenishment_drafts set report='{}'$$,'42501',null,'direct update denied');
select throws_ok($$delete from public.event_replenishment_drafts$$,'42501',null,'direct deletion denied');
select throws_ok($$insert into public.event_replenishment_drafts default values$$,'42501',null,'direct insertion denied');
select pg_temp.login(11,1);
select lives_ok($$select pg_temp.preview()$$,'viewer can inspect preview');
select is((select count(*)::integer from public.event_replenishment_drafts),1,'viewer reads history');
select throws_ok($$select pg_temp.save()$$,'MQ403',null,'viewer cannot save or retry');
select pg_temp.login(15,1);
select throws_ok($$select pg_temp.save()$$,'MQ403',null,'approver cannot save');
select pg_temp.login(12,1);
select is((select count(*)::integer from public.event_replenishment_drafts),0,'branch cannot read other location');
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'definer enforces branch access');
select pg_temp.login(13,2);
select is((select count(*)::integer from public.event_replenishment_drafts),0,'foreign organization has no history');
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'foreign organization cannot preview');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'active organization claim narrows access');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
select pg_temp.login(12,1);set local role authenticated;
select is((select count(*)::integer from public.event_replenishment_drafts),1,'permitted branch reads');
select lives_ok($$select pg_temp.preview()$$,'permitted branch inspects');
select throws_ok($$select pg_temp.save()$$,'MQ403',null,'branch role remains read only');
select pg_temp.login(14,1);
select lives_ok($$select pg_temp.save(222)$$,'planner saves');
select pg_temp.login(16,1);
select lives_ok($$select pg_temp.save(223)$$,'admin saves');
select throws_ok($$select pg_temp.save()$$,'MQ409',null,'different author cannot replay');
reset role;
select pg_temp.login(10,1);
select is((select count(*)::integer from public.audit_log where organization_id=pg_temp.id(1) and table_name='event_replenishment_drafts'),3,'one audit per new draft');
update public.stock_snapshots set quantity=4.001 where organization_id=pg_temp.id(1) and snapshot_date='2026-10-10';
select is(pg_temp.preview()->>'baseline_gap','0','baseline gap clamps to zero');
select is(pg_temp.preview()->>'adjusted_gap','1.263','event gap uses same position, not baseline clamped gap plus additions');
select is(pg_temp.preview()->>'gap_increase','1.263','existing stock absorbs part of event demand');
select throws_ok($$select pg_temp.save(224,(select report->>'fingerprint' from capture))$$,'MQ409',null,'changed stock requires refresh');
select is(pg_temp.save(220,(select report->>'fingerprint' from capture)),(select saved from capture),'retry retains original after stock changes');
select is((select report from public.event_replenishment_drafts where id=(select saved from capture)),(select report from capture),'saved evidence unchanged');
update public.stock_snapshots set quantity=10 where organization_id=pg_temp.id(1) and snapshot_date='2026-10-10';
select is(pg_temp.preview()->>'adjusted_gap','0','ample supply produces zero gap');
select is(pg_temp.preview()#>>'{baseline,orders,1,late}','true','zero gap retains late-arrival warning');
select lives_ok($$select pg_temp.save(224)$$,'available zero-gap draft may be saved');
update public.stock_snapshots set quantity=0,allocated_quantity=1 where organization_id=pg_temp.id(1) and snapshot_date='2026-10-10';
select is(pg_temp.preview('2')->>'adjusted_gap','7.261','negative inventory position is retained');
update public.stock_snapshots set unit_of_measure=null where organization_id=pg_temp.id(1) and snapshot_date='2026-10-10';
select is(pg_temp.preview()->>'status','stock_unit_unknown','unknown stock unit never inferred from catalog');
update public.stock_snapshots set unit_of_measure='KG' where organization_id=pg_temp.id(1) and snapshot_date='2026-10-10';
select is(pg_temp.preview()->>'status','unit_mismatch','incompatible stock is unavailable');
update public.stock_snapshots set unit_of_measure='EA',snapshot_date='2026-10-09' where organization_id=pg_temp.id(1) and snapshot_date='2026-10-10';
select is(pg_temp.preview()->>'status','stock_date_mismatch','previous-day stock cannot support a draft');
update public.stock_snapshots set snapshot_date='2026-10-10' where organization_id=pg_temp.id(1) and snapshot_date='2026-10-09';
update public.open_orders set unit_of_measure=null where id=pg_temp.id(201);
select is(pg_temp.preview()->>'status','inbound_unit_unknown','unknown inbound fails closed');
update public.open_orders set unit_of_measure='KG' where id=pg_temp.id(201);
select is(pg_temp.preview()->>'status','inbound_unit_mismatch','incompatible inbound fails closed');
update public.open_orders set unit_of_measure='EA' where id=pg_temp.id(201);
insert into public.open_orders(organization_id,order_code,line_code,item_id,location_id,supplier_id,expected_date,quantity,unit_cost,currency,status,unit_of_measure)
select pg_temp.id(1),'LIMIT-'||n,'1',pg_temp.id(60),pg_temp.id(20),pg_temp.id(200),'2026-10-11',1,1,'SAR','open','EA' from generate_series(1,999) n;
select is(pg_temp.preview()->>'status','inbound_limit','more than 1000 positive lines cannot produce a partial gap');
select is(pg_temp.preview()#>>'{baseline,inbound_quantity}',null,'oversized inbound total remains unknown');
select is(pg_temp.preview()->>'adjusted_gap',null,'truncated evidence has no adjusted gap');
delete from public.open_orders where organization_id=pg_temp.id(1) and order_code like 'LIMIT-%';
select is(pg_temp.preview('999999999999999.999')->>'status','quantity_out_of_range','overflowing resulting gap is unavailable');
select is(pg_temp.preview('999999999999999.999')->>'adjusted_gap',null,'overflow does not report a truncated gap');
update public.open_orders set quantity=0 where organization_id=pg_temp.id(1);
select is(pg_temp.preview()#>>'{baseline,inbound_quantity}','0','confirmed empty inbound is zero');
select is(pg_temp.preview('0',false)->>'status','orders_unconfirmed','empty inbound still requires confirmation');
update public.planned_event_scenarios set report=report||'{"changed":true}' where id=(select event from fixture);
select is(pg_temp.preview()->>'status','scenario_changed','changed original event blocks new drafts');
select is(pg_temp.preview()->>'adjusted_gap',null,'changed evidence has no gap');
select is(pg_temp.save(220,(select report->>'fingerprint' from capture)),(select saved from capture),'historical retry survives source changes');
update public.planned_event_scenarios set report=report-'changed' where id=(select event from fixture);
update public.inventory_policies set status='no_positive_history' where id=pg_temp.id(120);
select is(pg_temp.preview()->>'status','scenario_changed','unavailable baseline cannot substitute saved source');
update public.inventory_policies set status='available' where id=pg_temp.id(120);
delete from public.stock_snapshots where organization_id=pg_temp.id(1) and snapshot_date='2026-10-10';
select is(pg_temp.preview()->>'status','stock_missing','future stock never repairs missing cutoff stock');
select throws_ok($$select pg_temp.save(225)$$,'MQ422',null,'unavailable preview cannot save');
set local role anon;
select throws_ok($$select * from public.event_replenishment_drafts$$,'42501',null,'anonymous cannot read');
select throws_ok($$select pg_temp.preview()$$,'42501',null,'anonymous cannot preview');
reset role;
select * from finish();
rollback;
