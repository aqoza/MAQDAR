begin;
select no_plan();
insert into auth.users(id,email) values('a2670000-0000-4000-8000-000000000010','batch-owner@test.local');
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select case when n=10 then 'a2670000-0000-4000-8000-000000000010'::uuid else ('a2670000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid end$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'event-a2670000-'||n||'@test.local' from generate_series(11,16) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'event-publish-a2670000','Events A'),(pg_temp.id(2),'event-publish-other-a2670000','Events B');
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

create temporary table response_fixture(handoff_id uuid);
grant all on response_fixture to authenticated;
insert into response_fixture select handoff from publication_fixture;
alter table response_fixture add batch_id uuid, add publication_id uuid, add batch_publication_id uuid, add response_id uuid;
select pg_temp.login(10,1);
set local role authenticated;
update response_fixture set batch_id=public.event_purchase_handoff_batch_create(pg_temp.id(1),array[handoff_id]);
update response_fixture set publication_id=public.supplier_event_publication_publish(pg_temp.id(1),handoff_id,true,public.supplier_event_publication_preview(pg_temp.id(1),handoff_id)->>'fingerprint');
update response_fixture set batch_publication_id=public.supplier_event_batch_publication_publish(pg_temp.id(1),batch_id,true,public.supplier_event_batch_publication_preview(pg_temp.id(1),batch_id)->>'fingerprint');
reset role;
insert into auth.users(id,email,email_confirmed_at) select pg_temp.id(n),'supplier-'||n||'@test.local',now() from generate_series(2000,2003) n;
insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90) values(pg_temp.id(111),pg_temp.id(1),'OTHER','Other','SA','SAR',3,3);
insert into public.supplier_portal_grants(id,organization_id,supplier_id,email,user_id,created_by,accepted_at) values
 (pg_temp.id(2100),pg_temp.id(1),pg_temp.id(200),'supplier-2000@test.local',pg_temp.id(2000),pg_temp.id(10),now()),
 (pg_temp.id(2101),pg_temp.id(1),pg_temp.id(200),'supplier-2001@test.local',pg_temp.id(2001),pg_temp.id(10),now()),
 (pg_temp.id(2102),pg_temp.id(1),pg_temp.id(111),'supplier-2002@test.local',pg_temp.id(2002),pg_temp.id(10),now()),
 (pg_temp.id(2103),pg_temp.id(1),pg_temp.id(200),'supplier-2003@test.local',null,pg_temp.id(10),null);
create function pg_temp.report(request integer default 3000,state text default 'received',why text default '',kind text default 'batch',grantn integer default 2100,ref text default '') returns uuid language sql as $$
 select public.supplier_event_response_submit(pg_temp.id(grantn),kind,(select case when kind='batch' then batch_publication_id else publication_id end from response_fixture),pg_temp.id(request),state,ref,why) $$;
create function pg_temp.history(kind text default 'batch',grantn integer default 2100,page integer default 1) returns jsonb language sql as $$
 select public.supplier_event_response_history(pg_temp.id(grantn),kind,(select case when kind='batch' then batch_publication_id else publication_id end from response_fixture),page) $$;
create function pg_temp.internal(kind text default 'batch') returns jsonb language sql as $$
 select public.supplier_event_response_history_internal(pg_temp.id(1),kind,(select case when kind='batch' then batch_publication_id else publication_id end from response_fixture)) $$;
create temporary table overlapping(id uuid); grant all on overlapping to authenticated;
reset role;
create temporary table extra_line as select pg_temp.line(1,'KG') id; grant select on extra_line to authenticated;
set local role authenticated;
insert into overlapping select public.event_purchase_handoff_batch_create(pg_temp.id(1),array[(select handoff_id from response_fixture),(select id from extra_line)]);
update overlapping set id=public.supplier_event_batch_publication_publish(pg_temp.id(1),id,true,public.supplier_event_batch_publication_preview(pg_temp.id(1),id)->>'fingerprint');
reset role;
create temporary table unchanged as select (select jsonb_agg(to_jsonb(o) order by id) from public.open_orders o) orders,(select jsonb_agg(to_jsonb(s) order by id) from public.stock_snapshots s) stock,(select jsonb_agg(to_jsonb(p) order by id) from public.event_purchase_proposals p) proposals;
select pg_temp.login(2000,2); -- Forged/stale staff tenant claim must not widen or deny the separate supplier grant.
set local role authenticated;
select is(pg_temp.history()->>'total','0','no response is absence');
select is(pg_temp.history()->'latest','null'::jsonb,'no inferred acceptance');
select throws_ok($$select pg_temp.report(3000,'declined')$$,'MQ422',null,'decline needs reason');
select throws_ok($$select pg_temp.report(3000,'declined',E'\n\t')$$,'MQ422',null,'whitespace is not a reason');
select throws_ok($$select pg_temp.report(3000,'accepted')$$,'MQ422',null,'acceptance is not a response status');
select throws_ok($$select pg_temp.report(3000,'received',repeat('x',2001))$$,'MQ422',null,'bounded reason');
select throws_ok($$select pg_temp.report(3000,'received','','batch',2100,E'bad\nref')$$,'MQ422',null,'control reference rejected');
update response_fixture set response_id=pg_temp.report();
select is(pg_temp.report(),(select response_id from response_fixture),'identical retries return original event');
select throws_ok($$select pg_temp.report(3000,'declined','Unavailable')$$,'MQ409',null,'conflicting retry rejected');
select throws_ok($$select pg_temp.report(3000,'received','','handoff')$$,'MQ409',null,'request identity spans package kinds');
select is(pg_temp.history('handoff')->>'total','0','batch report does not report its member');
select is(public.supplier_event_response_history(pg_temp.id(2100),'batch',(select id from overlapping))->>'total','0','overlapping publication remains independent');
select throws_ok($$select public.supplier_response_submit(pg_temp.id(2100),'batch',(select batch_publication_id from response_fixture),pg_temp.id(9999),'received')$$,'MQ404',null,'ordinary response endpoint cannot reach event publications');
select throws_ok($$select public.supplier_response_history(pg_temp.id(2100),'batch',(select batch_publication_id from response_fixture))$$,'MQ404',null,'ordinary history cannot reach event publications');
select is(pg_temp.history()->>'total','1','retry creates one event');
select is((select array_agg(key order by key) from jsonb_object_keys(pg_temp.history()#>'{rows,0}') key),array['author','created_at','id','reason','reference','revision','status'],'supplier history has exact allowlist');
select is(pg_temp.history()#>>'{latest,author}','supplier-2000@test.local','responding account is captured');
select is((select count(*) from public.supplier_event_responses),0::bigint,'supplier has no direct table access');
select throws_ok($$delete from public.supplier_event_responses$$,'42501',null,'direct delete denied');
select throws_ok($$update public.supplier_event_responses set status='received'$$,'42501',null,'direct update denied');
select throws_ok($$select app.supplier_event_response_page(pg_temp.id(1),'batch',(select batch_publication_id from response_fixture),1)$$,'42501',null,'private history bypass denied');
select throws_ok($$select pg_temp.internal()$$,'MQ403',null,'supplier is not staff');
select throws_ok($$select pg_temp.report(3001,'received','','batch',2101)$$,'MQ404',null,'cannot act through a colleague grant');
select pg_temp.login(2001,1);
select is(pg_temp.history('batch',2101)->>'total','1','colleague with same supplier scope sees history');
select lives_ok($$select pg_temp.report(3000,'declined','Capacity unavailable','batch',2101,'SUP-REF')$$,'different actor can use its own request id');
select is(pg_temp.history('batch',2101)#>>'{latest,revision}','2','publication serial revision identifies latest');
select is(pg_temp.history('batch',2101)#>>'{latest,author}','supplier-2001@test.local','latest author is shown');
select pg_temp.login(2002,1);
select throws_ok($$select pg_temp.history('batch',2102)$$,'MQ404',null,'other supplier cannot read response history');
select throws_ok($$select pg_temp.report(3002,'received','','batch',2102)$$,'MQ404',null,'other supplier cannot respond');
select pg_temp.login(2003,1);
select throws_ok($$select pg_temp.report(3002,'received','','batch',2103)$$,'MQ404',null,'pending grant cannot respond');
select pg_temp.login(13,2);
select is((select count(*) from public.supplier_event_responses),0::bigint,'foreign tenant sees no reports');
select throws_ok($$select pg_temp.internal()$$,'MQ403',null,'foreign tenant history denied');
select pg_temp.login(12,1);
select is((select count(*) from public.supplier_event_responses),0::bigint,'wrong branch sees no reports');
select throws_ok($$select pg_temp.internal()$$,'MQ404',null,'wrong branch history denied');
select pg_temp.login(11,1);
select is(pg_temp.internal()->>'total','2','viewer can inspect without editor permission');
reset role;
update auth.users set email_confirmed_at=null where id=pg_temp.id(2000);
select pg_temp.login(2000,1);
set local role authenticated;
select throws_ok($$select pg_temp.report()$$,'MQ404',null,'retry rechecks confirmed account');
select throws_ok($$select pg_temp.history()$$,'MQ404',null,'unconfirmed account cannot inspect');
reset role;
update auth.users set email_confirmed_at=now() where id=pg_temp.id(2000);
update public.suppliers set is_active=false where id=pg_temp.id(200);
set local role authenticated;
select throws_ok($$select pg_temp.report()$$,'MQ404',null,'retry rechecks supplier activity');
reset role;
update public.suppliers set is_active=true where id=pg_temp.id(200);
-- No changes to the published summary or operational state; new responses append corrections.
set local role authenticated;
select lives_ok($$select pg_temp.report(3001,'received','','handoff')$$,'single publications have independent responses');
select lives_ok($$select pg_temp.report(n,'received') from generate_series(4000,4025) n$$,'history can span pages');
select is(pg_temp.history()->>'total','28','all batch responses retained');
select is(jsonb_array_length(pg_temp.history()->'rows'),25,'bounded first page');
select is(jsonb_array_length(pg_temp.history('batch',2100,2)->'rows'),3,'remaining page');
select is(pg_temp.history('batch',2100,2)#>>'{latest,revision}','28','latest independent of selected history page');
select is(pg_temp.history('batch',2100,999)->>'page','2','out of range page clamps');
select throws_ok($$select pg_temp.history('batch',2100,0)$$,'MQ422',null,'invalid page rejected');
select pg_temp.login(10,1);
select public.supplier_portal_revoke(pg_temp.id(1),pg_temp.id(2100));
select pg_temp.login(2000,1);
select throws_ok($$select pg_temp.report()$$,'MQ404',null,'revoked retries fail');
select throws_ok($$select pg_temp.history()$$,'MQ404',null,'revoked history fails');
select pg_temp.login(2001,1);
select is(pg_temp.history('batch',2101)->>'total','28','another current grant remains independent');
select pg_temp.login(10,1);
select public.supplier_event_batch_publication_withdraw(pg_temp.id(1),(select batch_publication_id from response_fixture));
select pg_temp.login(2001,1);
select throws_ok($$select pg_temp.report(3000,'declined','Capacity unavailable','batch',2101,'SUP-REF')$$,'MQ404',null,'withdrawn retries fail');
select throws_ok($$select pg_temp.history('batch',2101)$$,'MQ404',null,'withdrawn history hidden from supplier');
select pg_temp.login(11,1);
select is(pg_temp.internal()->>'total','28','staff history retained after withdrawal');
reset role;
select is((select jsonb_agg(to_jsonb(o) order by id) from public.open_orders o),(select orders from unchanged),'responses do not create or update orders');
select is((select jsonb_agg(to_jsonb(s) order by id) from public.stock_snapshots s),(select stock from unchanged),'responses do not move stock');
select is((select jsonb_agg(to_jsonb(p) order by id) from public.event_purchase_proposals p),(select proposals from unchanged),'responses do not change approvals');
select is((select count(*) from public.audit_log where table_name='supplier_event_responses'),29::bigint,'one audit event per response');
delete from auth.users where id=pg_temp.id(2001);
select is((select count(*) from public.supplier_event_responses),29::bigint,'actor/grant deletion retains responses');
delete from public.event_purchase_handoffs where id=(select handoff_id from response_fixture);
select is((select count(*) from public.supplier_event_responses where publication_id is not null),0::bigint,'single responses follow actual parent deletion');
select is((select count(*) from public.supplier_event_responses where batch_publication_id is not null),28::bigint,'copied batch responses survive member deletion');
delete from public.open_orders where organization_id=pg_temp.id(1);
delete from public.receipts where organization_id=pg_temp.id(1);
delete from public.suppliers where id=pg_temp.id(200);
select is((select count(*) from public.supplier_event_responses),28::bigint,'copied batch history survives supplier and grant deletion');
delete from public.event_purchase_handoff_batches where id=(select batch_id from response_fixture);
select is((select count(*) from public.supplier_event_responses),0::bigint,'batch response deletion follows actual batch');
select ok(not has_function_privilege('anon','public.supplier_event_response_submit(uuid,text,uuid,uuid,text,text,text)','execute'),'anonymous cannot submit');
select ok(not has_function_privilege('service_role','public.supplier_event_response_submit(uuid,text,uuid,uuid,text,text,text)','execute'),'integrations do not gain supplier response authority');
select ok(not has_function_privilege('zeespare_worker','public.supplier_event_response_submit(uuid,text,uuid,uuid,text,text,text)','execute'),'worker cannot submit');
select ok(not has_function_privilege('zeespare_simulation_worker','public.supplier_event_response_history(uuid,text,uuid,integer)','execute'),'simulation worker cannot inspect');
select ok(not has_function_privilege('authenticated','app.supplier_event_response_page(uuid,text,uuid,integer)','execute'),'private history projection has no caller grants');
select * from finish();
rollback;
