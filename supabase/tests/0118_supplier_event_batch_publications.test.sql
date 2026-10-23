begin;
select no_plan();
insert into auth.users(id,email) values('a26f0000-0000-4000-8000-000000000010','batch-owner@test.local');
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select case when n=10 then 'a26f0000-0000-4000-8000-000000000010'::uuid else ('a26f0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid end$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'event-a26f0000-'||n||'@test.local' from generate_series(11,16) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'event-publish-a26f0000','Events A'),(pg_temp.id(2),'event-publish-other-a26f0000','Events B');
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

create function pg_temp.handoff() returns uuid language sql as $$select public.event_purchase_handoff_create(pg_temp.id(1),(select proposal_id from review_fixture))$$;

update review_fixture set proposal_id=pg_temp.propose();
select pg_temp.login(15,1);
select pg_temp.decide('approved');
select pg_temp.login(10,1);
create temporary table publication_fixture(handoff uuid,preview jsonb,publication uuid,grant_id uuid);
grant all on publication_fixture to authenticated;
insert into publication_fixture(handoff) select pg_temp.handoff();
reset role;

update public.organizations set arabic_enabled=true where id=pg_temp.id(1);
insert into public.user_settings(user_id,active_organization_id) values(pg_temp.id(10),pg_temp.id(1));

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

create temporary table batch_fixture(id uuid,preview jsonb,publication uuid,overlap uuid);
grant all on batch_fixture to authenticated;
create temporary table lines(n integer,id uuid);
insert into lines values(0,(select handoff from publication_fixture)),(1,pg_temp.line(1,'KG')),(2,pg_temp.line(2));
grant select on lines to authenticated;
set local role authenticated;
insert into batch_fixture(id,overlap) select public.event_purchase_handoff_batch_create(pg_temp.id(1),array[(select id from lines where n=0),(select id from lines where n=1)]),public.event_purchase_handoff_batch_create(pg_temp.id(1),array[(select id from lines where n=1),(select id from lines where n=2)]);
create function pg_temp.batch_preview() returns jsonb language sql as $$select public.supplier_event_batch_publication_preview(pg_temp.id(1),(select id from batch_fixture))$$;
create function pg_temp.publish_batch(confirmed boolean default true,fp text default null) returns uuid language sql as $$select public.supplier_event_batch_publication_publish(pg_temp.id(1),(select id from batch_fixture),confirmed,coalesce(fp,(select preview->>'fingerprint' from batch_fixture)))$$;
create function pg_temp.packages(page integer default 1,size integer default 25) returns jsonb language sql as $$select public.supplier_portal_event_packages((select grant_id from publication_fixture),page,size)$$;
update batch_fixture set preview=pg_temp.batch_preview();
select is((select preview#>>'{summary,subtotal}' from batch_fixture),(select payload#>>'{summary,subtotal}' from public.event_purchase_handoff_batches where id=(select id from batch_fixture)),'saved sum of rounded adjusted subtotals');
select is((select jsonb_array_length(preview#>'{summary,lines}') from batch_fixture),2,'all original lines included');
select is((select array_agg(k order by k) from batch_fixture,jsonb_object_keys(preview->'summary') k),array['currency','lines','location_code','order_date','purpose','schema_version','subtotal','supplier_code'],'exact batch allowlist');
select ok((select bool_and((select array_agg(k order by k) from jsonb_object_keys(l) k)=array['currency','item_code','location_code','order_date','purpose','quantity','receipt_date','schema_version','subtotal','supplier_code','unit','unit_price']) from batch_fixture,jsonb_array_elements(preview#>'{summary,lines}') l),'each line uses exact supplier allowlist');
select ok((select bool_and(l#>>'{summary,quantity}'=h.payload#>>'{estimate,adjusted,quantity}') from lines join public.event_purchase_handoffs h on h.id=lines.id cross join lateral public.supplier_event_publication_preview(pg_temp.id(1),h.id) l),'full adjusted quantities remain selected');
select throws_ok($$select pg_temp.publish_batch(false)$$,'MQ422',null,'explicit confirmation required');
select throws_ok($$select pg_temp.publish_batch(true,repeat('0',64))$$,'MQ409',null,'stale preview refused');
select pg_temp.login(11,1);
select throws_ok($$select pg_temp.batch_preview()$$,'MQ403',null,'viewer cannot preview');
select throws_ok($$select pg_temp.publish_batch()$$,'MQ403',null,'viewer cannot publish');
select pg_temp.login(12,1);
select is((select count(*) from public.event_purchase_handoff_batches),0::bigint,'wrong branch source hidden');
select pg_temp.login(13,1);
select throws_ok($$select pg_temp.publish_batch()$$,'MQ403',null,'foreign tenant denied with forged claims');
select pg_temp.login(10,1);
reset role;
update public.supplier_items set unit_price=9 where item_id=pg_temp.id(10001);
set local role authenticated;
select throws_ok($$select pg_temp.publish_batch()$$,'MQ409',null,'second member price change fails entire publication');
select is((select count(*) from public.supplier_event_batch_publications),0::bigint,'no partial publication');
reset role;
update public.supplier_items set unit_price=1.234 where item_id=pg_temp.id(10001);
create temporary table original_cost as select id,report from public.event_purchase_cost_estimates where id=(select p.estimate_id from public.event_purchase_handoffs h join public.event_purchase_proposals p on p.id=h.proposal_id where h.id=(select id from lines where n=1));
update public.event_purchase_cost_estimates set report=jsonb_set(report,'{source,policy_recalculation_required}','true') where id=(select id from original_cost);
set local role authenticated;
select throws_ok($$select pg_temp.publish_batch()$$,'MQ409',null,'second member policy timing warning refused');
reset role;
update public.event_purchase_cost_estimates c set report=o.report #- '{source,event_before_receipt}' from original_cost o where c.id=o.id;
set local role authenticated;
select throws_ok($$select pg_temp.publish_batch()$$,'MQ409',null,'second member missing event timing refused');
reset role;
update public.event_purchase_cost_estimates c set report=o.report from original_cost o where c.id=o.id;
-- Each adversarial change is rolled back inside the helper; successful publication is a failure.
create function pg_temp.invalid_batch(path text[],replacement jsonb) returns text language plpgsql as $$
begin
 update public.event_purchase_handoff_batches set payload=jsonb_set(payload,path,replacement) where id=(select id from batch_fixture);
 perform pg_temp.publish_batch();
 raise exception using errcode='XX999',message='unexpected success';
exception when others then return sqlstate;
end; $$;
select is(pg_temp.invalid_batch('{summary,subtotal}','"999.99"'),'MQ409','saved subtotal cannot disagree with selected lines');
select is(pg_temp.invalid_batch('{summary,supplier_code}','"OTHER"'),'MQ409','saved supplier header must match all lines');
select is(pg_temp.invalid_batch('{summary,line_count}','1'),'MQ409','declared count must match original member set');
select is(pg_temp.invalid_batch('{lines}','[]'),'MQ409','empty copied batch refused');
create function pg_temp.deleted_member() returns text language plpgsql as $$
begin
 delete from public.event_purchase_handoffs where id=(select id from lines where n=1);
 perform pg_temp.publish_batch();
 raise exception using errcode='XX999',message='unexpected success';
exception when others then return sqlstate;
end; $$;
select is(pg_temp.deleted_member(),'MQ404','first publication requires every original handoff');
set local role authenticated;
update batch_fixture set publication=pg_temp.publish_batch();
select is(pg_temp.publish_batch(),(select publication from batch_fixture),'one immutable publication per batch');
select is((select count(*) from public.supplier_event_publications),0::bigint,'batch does not publish individual handoffs');
select is((select count(*) from public.supplier_batch_publications),0::bigint,'ordinary batches unaffected');
select throws_ok($$update public.supplier_event_batch_publications set summary='{}'$$,'42501',null,'direct update denied');
select throws_ok($$delete from public.supplier_event_batch_publications$$,'42501',null,'direct delete denied');
reset role;
insert into auth.users(id,email,email_confirmed_at) values(pg_temp.id(2000),'supplier-event-batch@test.local',now()),(pg_temp.id(2001),'supplier-other-batch@test.local',now());
set local role authenticated;
update publication_fixture set grant_id=(public.supplier_portal_invite(pg_temp.id(1),pg_temp.id(200),'supplier-event-batch@test.local')->>'id')::uuid;
select pg_temp.login(2000,1);
select throws_ok($$select pg_temp.packages()$$,'MQ404',null,'pending grant denied');
select public.supplier_portal_accept((select grant_id from publication_fixture));
select is(pg_temp.packages()->>'total','1','only explicit event batch visible');
select is(pg_temp.packages()#>>'{rows,0,overlap_count}','0','unpublished overlaps private');
select is(pg_temp.packages()#>'{rows,0,summary}',(select preview->'summary' from batch_fixture),'supplier gets copied allowlist only');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.packages()#>'{rows,0}') k),array['created_at','id','kind','overlap_count','overlaps','summary'],'only public publication references');
select is((select count(*) from public.supplier_event_batch_publications),0::bigint,'supplier cannot access raw internal table');
select is((select count(*) from public.event_purchase_handoff_batches),0::bigint,'supplier cannot access batch evidence');
select is(public.supplier_portal_publications((select grant_id from publication_fixture))->>'total','0','ordinary feed independent');
select is(public.supplier_portal_event_publications((select grant_id from publication_fixture))->>'total','0','legacy event single reader unchanged');
select throws_ok($$select public.supplier_response_submit((select grant_id from publication_fixture),'batch',(select publication from batch_fixture),pg_temp.id(8000),'received')$$,'MQ404',null,'no event supplier response support inferred');
select is(pg_temp.packages(999)->>'page','1','page clamped');
select throws_ok($$select pg_temp.packages(0)$$,'MQ422',null,'invalid page denied');
select throws_ok($$select pg_temp.packages(1,1000)$$,'MQ422',null,'size bounded');
select is(public.supplier_portal_event_packages((select grant_id from publication_fixture),1,25,pg_temp.id(9999))->>'total','0','missing detail empty');
select pg_temp.login(10,1);
update publication_fixture set publication=public.supplier_event_publication_publish(pg_temp.id(1),handoff,true,public.supplier_event_publication_preview(pg_temp.id(1),handoff)->>'fingerprint');
select public.supplier_event_batch_publication_publish(pg_temp.id(1),overlap,true,public.supplier_event_batch_publication_preview(pg_temp.id(1),overlap)->>'fingerprint') from batch_fixture;
select pg_temp.login(2000,1);
select is(pg_temp.packages()->>'total','3','independent single and batch publications visible');
select is(public.supplier_portal_event_packages((select grant_id from publication_fixture),1,25,(select publication from batch_fixture))#>>'{rows,0,overlap_count}','2','only visible event overlaps counted');
select pg_temp.login(10,1);
select public.supplier_event_publication_withdraw(pg_temp.id(1),(select publication from publication_fixture));
select pg_temp.login(2000,1);
select is(public.supplier_portal_event_packages((select grant_id from publication_fixture),1,25,(select publication from batch_fixture))#>>'{rows,0,overlap_count}','1','withdrawn overlaps hidden');
select pg_temp.login(2001,1);
select throws_ok($$select pg_temp.packages()$$,'MQ404',null,'another account denied');
select pg_temp.login(12,1);
select is((select count(*) from public.supplier_event_batch_publications),0::bigint,'wrong branch publication hidden');
select pg_temp.login(13,2);
select is((select count(*) from public.supplier_event_batch_publications),0::bigint,'foreign tenant publication hidden');
select pg_temp.login(11,1);
select is((select count(*) from public.supplier_event_batch_publications),2::bigint,'internal viewer sees history');
select throws_ok($$select public.supplier_event_batch_publication_withdraw(pg_temp.id(1),(select publication from batch_fixture))$$,'MQ403',null,'viewer cannot withdraw');
reset role;
update public.supplier_items set unit_price=9 where organization_id=pg_temp.id(1);
delete from public.event_purchase_handoffs where id=(select handoff from publication_fixture);
set local role authenticated;
select pg_temp.login(10,1);
select is(pg_temp.publish_batch(),(select publication from batch_fixture),'retry survives changed price and source deletion');
select is((select summary from public.supplier_event_batch_publications where id=(select publication from batch_fixture)),(select preview->'summary' from batch_fixture),'copied summary unchanged');
select pg_temp.login(2000,1);
select is(pg_temp.packages()->>'total','2','copied batch publications survive source deletion');
select pg_temp.login(10,1);
select public.supplier_event_batch_publication_withdraw(pg_temp.id(1),(select publication from batch_fixture));
select is(pg_temp.publish_batch(),(select publication from batch_fixture),'retry never restores withdrawn access');
select pg_temp.login(2000,1);
select is(pg_temp.packages()->>'total','1','withdrawal blocks subsequent access only to actual publication');
select pg_temp.login(10,1);
select public.supplier_portal_revoke(pg_temp.id(1),(select grant_id from publication_fixture));
select pg_temp.login(2000,1);
select throws_ok($$select pg_temp.packages()$$,'MQ404',null,'revocation immediate');
reset role;
select is((select count(*) from public.audit_log where organization_id=pg_temp.id(1) and table_name='supplier_event_batch_publications' and operation='INSERT'),2::bigint,'one audit per publication');
select ok(not has_function_privilege('anon','public.supplier_portal_event_packages(uuid,integer,integer,uuid)','execute'),'anonymous feed denied');
select ok(not has_function_privilege('service_role','public.supplier_portal_event_packages(uuid,integer,integer,uuid)','execute'),'service integrations gain no access');
select ok(not has_function_privilege('zeespare_worker','public.supplier_event_batch_publication_publish(uuid,uuid,boolean,text)','execute'),'worker cannot publish');
delete from public.event_purchase_handoff_batches where id=(select id from batch_fixture);
select is((select count(*) from public.supplier_event_batch_publications where id=(select publication from batch_fixture)),0::bigint,'actual batch deletion cascades');
select * from finish();
rollback;
