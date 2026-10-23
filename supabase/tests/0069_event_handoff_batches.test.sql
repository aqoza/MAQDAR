begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('99500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
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
insert into lines values(0,pg_temp.line(0),null),(1,pg_temp.line(1,'KG'),null),(2,pg_temp.line(2),null),(3,pg_temp.line(3,'EA',true),null);
update lines set original=h.payload from public.event_purchase_handoffs h where h.id=lines.id;
grant select,update on lines to authenticated;
create function pg_temp.ids(ns integer[] default array[0,1]) returns uuid[] language sql as $$select array_agg(id order by n) from lines where n=any(ns)$$;
create function pg_temp.batch(ns integer[] default array[0,1]) returns uuid language sql as $$select public.event_purchase_handoff_batch_create(pg_temp.id(1),pg_temp.ids(ns))$$;
create temporary table batches(id uuid,payload jsonb);
grant all on batches to authenticated;
set local role authenticated;
select is((public.event_purchase_handoff_batch_preview(pg_temp.id(1),pg_temp.ids())#>>'{summary,subtotal}')::numeric,12.95::numeric,'sum saved rounded adjusted costs');
select is((public.event_purchase_handoff_batch_preview(pg_temp.id(1),pg_temp.ids())#>>'{summary,baseline_subtotal}')::numeric,9.25::numeric,'sum saved rounded baseline costs');
select is((public.event_purchase_handoff_batch_preview(pg_temp.id(1),pg_temp.ids())#>>'{summary,cost_increase}')::numeric,3.70::numeric,'difference of rounded subtotal sums');
insert into batches(id) select pg_temp.batch();
update batches set payload=(select payload from public.event_purchase_handoff_batches where id=batches.id);
select is(public.event_purchase_handoff_batch_create(pg_temp.id(1),array[(select id from lines where n=1),(select id from lines where n=0)]),(select id from batches),'set identity ignores input order');
select is((select handoff_ids from public.event_purchase_handoff_batches),(select array_agg(id order by id) from lines where n in(0,1)),'stored IDs canonical');
select is((select payload->'lines' from batches),(select jsonb_agg(original order by id) from lines where n in(0,1)),'complete exact source payloads preserved');
select is((select count(distinct value#>>'{estimate,source,source,draft,scenario,event,input,unit}') from batches,jsonb_array_elements(payload->'lines')),2::bigint,'different units retained without quantity pooling');
select is((select payload->>'selected_quantity_basis' from batches),'full_event_adjusted','full selection explicit');
select throws_ok($$select public.event_purchase_handoff_batch_create(pg_temp.id(1),null)$$,'MQ422',null,'null selection');
select throws_ok($$select public.event_purchase_handoff_batch_create(pg_temp.id(1),'{}')$$,'MQ422',null,'empty selection');
select throws_ok($$select public.event_purchase_handoff_batch_create(pg_temp.id(1),array[null::uuid])$$,'MQ422',null,'null member');
select throws_ok($$select public.event_purchase_handoff_batch_create(pg_temp.id(1),array[[pg_temp.id(9)]])$$,'MQ422',null,'multidimensional selection');
select throws_ok($$select public.event_purchase_handoff_batch_create(pg_temp.id(1),array[(select id from lines where n=0),(select id from lines where n=0)])$$,'MQ422',null,'repeated handoff');
select throws_ok($$select public.event_purchase_handoff_batch_create(pg_temp.id(1),array_fill(pg_temp.id(9),array[51]))$$,'MQ422',null,'51 exceeds bound');
select throws_ok($$select public.event_purchase_handoff_batch_create(pg_temp.id(1),array[pg_temp.id(999)])$$,'MQ404',null,'unknown handoff');
select throws_ok($$select pg_temp.batch(array[0,3])$$,'MQ422',null,'same item from independent events refused');
select throws_ok($$insert into public.event_purchase_handoff_batches select * from public.event_purchase_handoff_batches$$,'42501',null,'direct insertion denied');
select throws_ok($$update public.event_purchase_handoff_batches set payload='{}'$$,'42501',null,'direct edit denied');
select throws_ok($$delete from public.event_purchase_handoff_batches$$,'42501',null,'direct deletion denied');
select lives_ok($$select pg_temp.batch(array[1,2])$$,'overlapping batch allowed');
select is((select overlap_count from public.event_purchase_handoff_batch_list where id=(select id from batches)),1::bigint,'overlap visible');
select is((select batch_count from public.event_purchase_handoff_batch_candidates where id=(select id from lines where n=1)),2::bigint,'line reuse count');
select ok((select search_text from public.event_purchase_handoff_batch_list where id=(select id from batches)) like '%launch%','event search evidence');
select pg_temp.login(11,1);
select is((select count(*) from public.event_purchase_handoff_batches),2::bigint,'viewer reads');
select throws_ok($$select pg_temp.batch()$$,'MQ403',null,'viewer cannot save or replay');
select throws_ok($$select public.event_purchase_handoff_batch_preview(pg_temp.id(1),pg_temp.ids())$$,'MQ403',null,'viewer cannot preview');
select pg_temp.login(12,1);
select is((select count(*) from public.event_purchase_handoff_batches),0::bigint,'unassigned branch hides batch');
select is((select count(*) from public.event_purchase_handoff_batch_list),0::bigint,'branch list scoped');
select is((select count(*) from public.event_purchase_handoff_batch_candidates),0::bigint,'branch candidates scoped');
select pg_temp.login(13,2);
select is((select count(*) from public.event_purchase_handoff_batches),0::bigint,'other tenant hidden');
select throws_ok($$select public.event_purchase_handoff_batch_create(pg_temp.id(2),pg_temp.ids())$$,'MQ404',null,'foreign IDs inaccessible');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
select pg_temp.login(12,1);
set local role authenticated;
select is((select count(*) from public.event_purchase_handoff_batch_list),2::bigint,'assigned branch sees context');
select throws_ok($$select pg_temp.batch()$$,'MQ403',null,'assigned branch cannot save');
select pg_temp.login(15,1);
select throws_ok($$select pg_temp.batch()$$,'MQ403',null,'approver cannot save');
reset role;
select is((select count(*) from public.audit_log where organization_id=pg_temp.id(1) and table_name='event_purchase_handoff_batches'),2::bigint,'one audit per batch');
select pg_temp.login(10,1);
-- Privileged tampering isolates fail-closed gates. The nested exception rolls every mutation back.
create function pg_temp.invalid(path text[],v jsonb) returns text language plpgsql as $$
begin
  update public.event_purchase_handoffs set payload=case when v is null then payload #- path else jsonb_set(payload,path,v) end where id=(select id from lines where n=2);
  perform pg_temp.batch(array[0,2]);
  raise exception using errcode='P0001',message='unexpected success';
exception when others then return sqlstate;
end; $$;
select is(pg_temp.invalid('{estimate,source,order_date}','"2026-10-11"'),'MQ422','mixed dates');
select is(pg_temp.invalid('{estimate,source,source,supplier,id}',to_jsonb(pg_temp.id(999)::text)),'MQ422','mixed suppliers');
select is(pg_temp.invalid('{estimate,location_id}',to_jsonb(pg_temp.id(21)::text)),'MQ422','mixed receivers');
select is(pg_temp.invalid('{estimate,price,currency}','"KWD"'),'MQ422','mixed currencies');
select is(pg_temp.invalid('{estimate,price,minor_units}','3'),'MQ422','mixed precision');
select is(pg_temp.invalid('{estimate,source,policy_recalculation_required}','true'),'MQ422','policy warning');
select is(pg_temp.invalid('{estimate,source,policy_recalculation_required}','null'),'MQ422','null policy evidence');
select is(pg_temp.invalid('{estimate,source,policy_recalculation_required}',null),'MQ422','missing policy evidence');
select is(pg_temp.invalid('{estimate,source,event_before_receipt}','[{"date":"2026-10-10","quantity":"1"}]'),'MQ422','early event demand');
select is(pg_temp.invalid('{estimate,source,event_before_receipt}','null'),'MQ422','null event timing');
select is(pg_temp.invalid('{estimate,source,event_before_receipt}','{}'),'MQ422','malformed event timing');
select is(pg_temp.invalid('{estimate,source,event_before_receipt}',null),'MQ422','missing event timing');
select is(pg_temp.invalid('{estimate,source,source,draft,scenario,event,input,unit}','null'),'MQ422','missing unit');
select is(pg_temp.invalid('{estimate,baseline,subtotal}','null'),'MQ422','missing baseline cost');
select is(pg_temp.invalid('{estimate,adjusted,quantity}','"0"'),'MQ422','zero selected quantity');
select is(pg_temp.invalid('{selected_quantity_basis}','"increase_only"'),'MQ422','wrong quantity basis');
select is(pg_temp.invalid('{estimate,source,source,draft,scenario,event,source,item_code}','"ITEM"'),'MQ422','reused saved item code rejected');
select is((select count(*) from public.event_purchase_handoff_batches where organization_id=pg_temp.id(1)),2::bigint,'failed validation atomic');
update public.supplier_items set unit_price=2 where item_id=pg_temp.id(10002);
set local role authenticated;
select throws_ok($$select pg_temp.batch(array[0,2])$$,'MQ409',null,'changed price blocks new set');
select is(pg_temp.batch(array[1,2]),(select id from public.event_purchase_handoff_batches where id<>(select id from batches)),'existing retry retains prior price');
update review_fixture set proposal_id=pg_temp.propose(902);
select pg_temp.login(15,1);
select pg_temp.decide('approved',952);
select pg_temp.login(10,1);
select throws_ok($$select pg_temp.batch(array[0,2])$$,'MQ409',null,'historical approval blocks new set');
select is(pg_temp.batch(),(select id from batches),'historical exact-set retry');
select ok(not (select selected from public.event_purchase_handoff_batch_list where id=(select id from batches)),'historical context');
select is((select payload from public.event_purchase_handoff_batches where id=(select id from batches)),(select payload from batches),'original bytes unchanged');
reset role;
select is((select count(*) from public.open_orders where organization_id=pg_temp.id(1)),4::bigint,'inbound unchanged');
select is((select count(*) from public.receipts where organization_id=pg_temp.id(1)),1::bigint,'receipts unchanged');
select is((select count(*) from public.stock_snapshots where organization_id=pg_temp.id(1)),4::bigint,'stock unchanged');
select is((select count(*) from public.purchase_handoff_batches where organization_id=pg_temp.id(1)),0::bigint,'ordinary batches independent');
select ok(not has_table_privilege('anon','public.event_purchase_handoff_batches','SELECT'),'anon cannot read');
select ok(not has_table_privilege('service_role','public.event_purchase_handoff_batches','SELECT'),'service cannot read');
select ok(not has_table_privilege('zeespare_worker','public.event_purchase_handoff_batches','SELECT'),'worker cannot read');
select ok(not has_function_privilege('anon','public.event_purchase_handoff_batch_create(uuid,uuid[])','EXECUTE'),'anon cannot create');
select ok(not has_function_privilege('service_role','public.event_purchase_handoff_batch_create(uuid,uuid[])','EXECUTE'),'service cannot create');
select ok(not has_function_privilege('zeespare_worker','public.event_purchase_handoff_batch_create(uuid,uuid[])','EXECUTE'),'worker cannot create');
insert into lines(n,id) select n,pg_temp.line(n) from generate_series(10,59) n;
set local role authenticated;
set local statement_timeout='8s';
select lives_ok($$select public.event_purchase_handoff_batch_create(pg_temp.id(1),(select array_agg(id) from lines where n between 10 and 59))$$,'50 real lines save within budget');
select is((select (payload#>>'{summary,subtotal}')::numeric from public.event_purchase_handoff_batches where cardinality(handoff_ids)=50),370.00::numeric,'50-line adjusted sum');
select is((select (payload#>>'{summary,baseline_subtotal}')::numeric from public.event_purchase_handoff_batches where cardinality(handoff_ids)=50),277.50::numeric,'50-line baseline sum');
select is((select (payload#>>'{summary,cost_increase}')::numeric from public.event_purchase_handoff_batches where cardinality(handoff_ids)=50),92.50::numeric,'50-line difference');
reset statement_timeout;
select lives_ok($$select pg_temp.batch(array[10])$$,'one line allowed');
reset role;
insert into lines(n,id) values(60,pg_temp.line(60,'EA',false,0)),(61,pg_temp.line(61,'EA',false,1.234,'KWD')),(62,pg_temp.line(62,'EA',false,1.234,'KWD')),
 (63,pg_temp.line(63,'EA',false,166666666666666.666,'KWD')),(64,pg_temp.line(64,'EA',false,166666666666666.666,'KWD'));
set local role authenticated;
select lives_ok($$select pg_temp.batch(array[60])$$,'explicit zero price can be packaged');
select is((public.event_purchase_handoff_batch_preview(pg_temp.id(1),pg_temp.ids(array[60]))#>>'{summary,subtotal}')::numeric,0::numeric,'zero total remains exact');
select is((public.event_purchase_handoff_batch_preview(pg_temp.id(1),pg_temp.ids(array[61,62]))#>>'{summary,subtotal}'),'14.808','three-decimal adjusted sum');
select is((public.event_purchase_handoff_batch_preview(pg_temp.id(1),pg_temp.ids(array[61,62]))#>>'{summary,baseline_subtotal}'),'11.106','three-decimal baseline sum');
select is((public.event_purchase_handoff_batch_preview(pg_temp.id(1),pg_temp.ids(array[61,62]))#>>'{summary,cost_increase}'),'3.702','three-decimal difference');
select lives_ok($$select pg_temp.batch(array[63,64])$$,'derived sum may exceed a single line maximum');
select is((public.event_purchase_handoff_batch_preview(pg_temp.id(1),pg_temp.ids(array[63,64]))#>>'{summary,subtotal}'),'1999999999999999.992','large exact subtotal string');
select is((public.event_purchase_handoff_batch_preview(pg_temp.id(1),pg_temp.ids(array[63,64]))#>>'{summary,cost_increase}'),'499999999999999.998','large exact difference string');
reset role;
delete from public.event_purchase_handoffs where id=(select id from lines where n=1);
set local role authenticated;
select is((select payload from public.event_purchase_handoff_batches where id=(select id from batches)),(select payload from batches),'copy survives source deletion');
select throws_ok($$select pg_temp.batch()$$,'MQ404',null,'retry still requires source visibility');
select pg_temp.login(10,2);
select is((select count(*) from public.event_purchase_handoff_batches),0::bigint,'claim cannot widen membership');
reset role;
select * from finish();
rollback;
