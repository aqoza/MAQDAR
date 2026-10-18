begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('99600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
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
create function pg_temp.hash(n integer) returns bytea language sql immutable as $$select decode(lpad(n::text,64,'0'),'hex')$$;
create function pg_temp.key(n integer,scopes text[] default array['event_purchase_handoffs:read'],org integer default 1) returns uuid language sql as $$select public.create_api_key(pg_temp.id(org),'Test key '||n,scopes,30,pg_temp.hash(n),'maqdar_sk_test','test')$$;
select pg_temp.login(10,1);
set local role authenticated;
select lives_ok($$select pg_temp.key(40)$$,'owner can issue explicit handoff permission');
select lives_ok($$select pg_temp.key(41)$$,'expiry fixture');
select lives_ok($$select pg_temp.key(42)$$,'revocation fixture');
select lives_ok($$select pg_temp.key(43,array['master_data:read','master_data:write','transactions:read','transactions:write','purchase_handoffs:read','purchase_handoffs:acknowledge','transfer_handoffs:read','transfer_handoffs:acknowledge'])$$,'legacy scopes still accepted');
select throws_ok($$select pg_temp.key(45,array['event_purchase_handoffs:write'])$$,'MQ422',null,'no handoff write scope');
select throws_ok($$select pg_temp.key(45,array['event_purchase_handoffs:read',null])$$,'MQ422',null,'null scope refused');
select lives_ok($$select pg_temp.key(46,array['master_data:read','master_data:write','transactions:read','transactions:write','purchase_handoffs:read','purchase_handoffs:acknowledge','transfer_handoffs:read','transfer_handoffs:acknowledge','event_purchase_handoffs:read'])$$,'all nine scopes accepted explicitly');
select throws_ok($$select pg_temp.key(45,array['event_purchase_handoffs:execute'])$$,'MQ422',null,'event order execution is not enabled');
select pg_temp.login(16,1);
select lives_ok($$select pg_temp.key(47)$$,'admin can issue event reader');
select pg_temp.login(14,1);
select throws_ok($$select pg_temp.key(45)$$,'MQ403',null,'planner cannot issue organization-wide keys');
select pg_temp.login(11,1);
select throws_ok($$select pg_temp.key(45)$$,'MQ403',null,'viewer cannot issue organization-wide keys');
select pg_temp.login(12,1);
select throws_ok($$select pg_temp.key(45)$$,'MQ403',null,'branch member cannot issue keys');
select pg_temp.login(15,1);
select throws_ok($$select pg_temp.key(45)$$,'MQ403',null,'approver cannot issue keys');
select pg_temp.login(13,2);
select lives_ok($$select pg_temp.key(44,array['event_purchase_handoffs:read'],2)$$,'other tenant key fixture');
reset role;
update public.api_keys set expires_at=created_at+interval '1 second',created_at=now()-interval '2 days' where key_hash=pg_temp.hash(41);
update public.api_keys set expires_at=now()-interval '1 day' where key_hash=pg_temp.hash(41);
update public.api_keys set revoked_at=now() where key_hash=pg_temp.hash(42);
create temporary table pages(n integer,body jsonb);
grant all on lines,batches,pages to service_role;
-- Cookie/branch claims cannot narrow or replace the explicit key organization.
select pg_temp.login(12,1);
set local role service_role;
select throws_ok($$select * from app.event_purchase_handoff_api_records$$,'42501',null,'projection is private even to service role');
select throws_ok($$select public.api_event_purchase_handoff_list(pg_temp.hash(43),'event-purchase-handoffs')$$,'MQ403',null,'existing scopes do not imply handoff read');
select throws_ok($$select public.api_event_purchase_handoff_list(pg_temp.hash(41),'event-purchase-handoffs')$$,'MQ401',null,'expired key refused');
select throws_ok($$select public.api_event_purchase_handoff_list(pg_temp.hash(42),'event-purchase-handoff-batches')$$,'MQ401',null,'revoked key refused');
select throws_ok($$select public.api_event_purchase_handoff_get(pg_temp.hash(99),'event-purchase-handoffs',pg_temp.id(1))$$,'MQ401',null,'unknown key refused');
select is(jsonb_array_length(public.api_event_purchase_handoff_list(pg_temp.hash(40),'event-purchase-handoffs')->'data'),3,'explicit key reads whole organization despite unrelated branch claims');
insert into pages values(1,public.api_event_purchase_handoff_list(pg_temp.hash(40),'event-purchase-handoffs',null,1,'2026-10-01T00:00:00Z'));
insert into pages values(2,public.api_event_purchase_handoff_list(pg_temp.hash(40),'event-purchase-handoffs',(select body->>'next_cursor' from pages where n=1),1,'2026-10-01T00:00:00Z'));
insert into pages values(3,public.api_event_purchase_handoff_list(pg_temp.hash(40),'event-purchase-handoffs',(select body->>'next_cursor' from pages where n=2),1,'2026-10-01T00:00:00Z'));
select is((select jsonb_array_length(body->'data') from pages where n=1),1,'bounded first page');
select is((select count(distinct body#>>'{data,0,id}') from pages),3::bigint,'timestamp ties traversed exactly once');
select is((select array_agg((body#>>'{data,0,id}')::uuid order by n) from pages),(select array_agg(id order by id) from lines),'UUID ascending tiebreak');
select is((select count(distinct body->>'as_of') from pages),1::bigint,'creation upper bound stable across pages');
select is((select body->>'next_cursor' from pages where n=3),null,'final page ends cursor');
select ok(not (select (body#>'{data,0}')?'payload' from pages where n=1),'lists omit full evidence');
select is(jsonb_array_length(public.api_event_purchase_handoff_list(pg_temp.hash(40),'event-purchase-handoffs',null,100,'2026-10-01T00:00:01Z')->'data'),0,'created_since is inclusive creation filter');
select is(jsonb_array_length(public.api_event_purchase_handoff_list(pg_temp.hash(44),'event-purchase-handoffs')->'data'),0,'other organization list empty');
select throws_ok($$select public.api_event_purchase_handoff_get(pg_temp.hash(44),'event-purchase-handoffs',(select id from lines where n=0))$$,'MQ404',null,'cross-tenant detail indistinguishable from missing');
select throws_ok($$select public.api_event_purchase_handoff_get(pg_temp.hash(40),'event-purchase-handoffs',pg_temp.id(999))$$,'MQ404',null,'missing detail');
select throws_ok($$select public.api_event_purchase_handoff_get(pg_temp.hash(44),'event-purchase-handoff-batches',(select id from batches))$$,'MQ404',null,'cross-tenant batch detail hidden');
select throws_ok($$select public.api_event_purchase_handoff_list(pg_temp.hash(40),'items')$$,'MQ404',null,'resource allowlist');
select throws_ok($$select public.api_event_purchase_handoff_list(pg_temp.hash(40),'event-purchase-handoffs',null,101)$$,'MQ422',null,'SQL backstop limit');
select throws_ok($$select public.api_event_purchase_handoff_list(pg_temp.hash(40),'event-purchase-handoffs',null,1,'infinity')$$,'MQ422',null,'finite creation filter');
select throws_ok($$select public.api_event_purchase_handoff_list(pg_temp.hash(40),'event-purchase-handoffs','malformed')$$,'MQ422',null,'malformed cursor');
select throws_ok($$select public.api_event_purchase_handoff_list(pg_temp.hash(40),'event-purchase-handoff-batches',(select body->>'next_cursor' from pages where n=1),1,'2026-10-01T00:00:00Z')$$,'MQ422',null,'cursor cannot cross resource');
select throws_ok($$select public.api_event_purchase_handoff_list(pg_temp.hash(44),'event-purchase-handoffs',(select body->>'next_cursor' from pages where n=1),1,'2026-10-01T00:00:00Z')$$,'MQ422',null,'cursor cannot cross organization');
select throws_ok($$select public.api_event_purchase_handoff_list(pg_temp.hash(40),'event-purchase-handoffs',(select body->>'next_cursor' from pages where n=1),1,'2026-10-02T00:00:00Z')$$,'MQ422',null,'cursor requires original filter');
select is(public.api_event_purchase_handoff_get(pg_temp.hash(40),'event-purchase-handoffs',id)#>'{data,payload}',original,'individual evidence unchanged') from lines;
select is(public.api_event_purchase_handoff_get(pg_temp.hash(40),'event-purchase-handoff-batches',id)#>'{data,payload}',payload,'batch evidence unchanged') from batches;
select is(public.api_event_purchase_handoff_get(pg_temp.hash(40),'event-purchase-handoff-batches',(select id from batches))#>>'{data,current,selected}','true','all selected batch');
reset role;
-- A later approval makes the old package historical. Reads still return original evidence.
select pg_temp.login(10,1);
set local role authenticated;
update review_fixture set proposal_id=pg_temp.propose(1001);
select pg_temp.login(15,1);
select pg_temp.decide('approved',1101);
reset role;
update public.supplier_items set unit_price=2 where organization_id=pg_temp.id(1);
set local role service_role;
select is(public.api_event_purchase_handoff_get(pg_temp.hash(40),'event-purchase-handoffs',(select id from lines where n=0))#>>'{data,current,selected}','false','live historical status outside evidence');
select is(public.api_event_purchase_handoff_get(pg_temp.hash(40),'event-purchase-handoff-batches',(select id from batches))#>>'{data,current,selected}','false','one historical line makes batch historical');
select is(public.api_event_purchase_handoff_get(pg_temp.hash(40),'event-purchase-handoffs',id)#>'{data,payload}',original,'later approval/price edit preserves single payload') from lines;
select is(public.api_event_purchase_handoff_get(pg_temp.hash(40),'event-purchase-handoff-batches',id)#>'{data,payload}',payload,'later approval/price edit preserves batch payload') from batches;
reset role;
update public.memberships set role='planner' where organization_id=pg_temp.id(1) and user_id=pg_temp.id(10);
set local role service_role;
select throws_ok($$select public.api_event_purchase_handoff_list(pg_temp.hash(40),'event-purchase-handoffs')$$,'MQ401',null,'creator role checked on every request');
reset role;
select is((select scopes from public.api_keys where key_hash=pg_temp.hash(43)),array['master_data:read','master_data:write','purchase_handoffs:acknowledge','purchase_handoffs:read','transactions:read','transactions:write','transfer_handoffs:acknowledge','transfer_handoffs:read'],'legacy key unchanged');
select ok((select last_used_at is not null from public.api_keys where key_hash=pg_temp.hash(40)),'usage metadata updated');
select is((select count(*) from public.open_orders where organization_id=pg_temp.id(1)),4::bigint,'reads create no inbound orders');
select is((select count(*) from public.event_purchase_handoffs where organization_id=pg_temp.id(1)),3::bigint,'reads create no handoffs');
-- Restore authority to check snapshot bounds and retained batches after source deletion.
update public.memberships set role='owner' where organization_id=pg_temp.id(1) and user_id=pg_temp.id(10);
update public.event_purchase_handoffs set created_at=statement_timestamp()+interval '1 hour' where id=(select id from lines where n=2);
set local role service_role;
select is(jsonb_array_length(public.api_event_purchase_handoff_list(pg_temp.hash(40),'event-purchase-handoffs')->'data'),2,'creation upper bound excludes future records');
reset role;
delete from public.event_purchase_handoffs where id=(select id from lines where n=0);
set local role service_role;
select is(public.api_event_purchase_handoff_get(pg_temp.hash(40),'event-purchase-handoff-batches',id)#>'{data,payload}',payload,'batch retains payload after member deletion') from batches;
select is(public.api_event_purchase_handoff_get(pg_temp.hash(40),'event-purchase-handoff-batches',(select id from batches))#>>'{data,current,selected}','false','deleted member cannot be selected');
reset role;

-- Scope separation and direct privileges are enforced in SQL, not only the HTTP router.
set local role service_role;
select throws_ok($$select public.api_handoff_list(pg_temp.hash(40),'purchase-handoffs')$$,'MQ403',null,'event scope does not imply purchase scope');
select throws_ok($$select public.api_event_purchase_handoff_list(pg_temp.hash(40),'purchase-handoffs')$$,'MQ404',null,'event RPC rejects purchase resource');
select throws_ok($$select * from public.event_purchase_handoffs$$,'42501',null,'service has no direct handoff table privilege');
reset role;
select pg_temp.login(10,1);
set local role authenticated;
select throws_ok($$select public.api_event_purchase_handoff_list(pg_temp.hash(40),'event-purchase-handoffs')$$,'42501',null,'browser role cannot call API RPC');
select throws_ok($$select * from app.event_purchase_handoff_api_records$$,'42501',null,'private projection denied to members');
select pg_temp.login(12,1);
select is((select count(*) from public.event_purchase_handoff_batches),0::bigint,'unrelated-location browser member still cannot read batch');
reset role;
select ok(not has_function_privilege('anon','public.api_event_purchase_handoff_get(bytea,text,uuid)','execute'),'anon RPC denied');
select ok(not has_function_privilege('maqdar_worker','public.api_event_purchase_handoff_get(bytea,text,uuid)','execute'),'worker RPC denied');
select is((select count(*) from public.stock_snapshots where organization_id=pg_temp.id(1)),4::bigint,'reads leave stock unchanged');
select is((select count(*) from public.event_purchase_handoff_batches where organization_id=pg_temp.id(1)),1::bigint,'reads create no batches');
set local role service_role;
select throws_ok($$select public.api_transfer_handoff_list(pg_temp.hash(40),'transfer-handoffs')$$,'MQ403',null,'event scope does not imply transfer read');
select throws_ok($$select public.api_handoff_acknowledge(pg_temp.hash(40),'purchase-handoffs',pg_temp.id(1),'{}')$$,'MQ403',null,'event scope cannot report purchase acknowledgements');
select throws_ok($$select public.api_transfer_handoff_acknowledge(pg_temp.hash(40),'transfer-handoffs',pg_temp.id(1),'{}')$$,'MQ403',null,'event scope cannot report transfer acknowledgements');
select is(public.api_event_purchase_handoff_get(pg_temp.hash(40),'event-purchase-handoff-batches',(select id from batches))#>>'{data,summary,selected_quantity_basis}','full_event_adjusted','selection is full adjusted quantity');
select is(public.api_event_purchase_handoff_get(pg_temp.hash(40),'event-purchase-handoff-batches',(select id from batches))#>>'{data,summary,subtotal}','12.95','adjusted batch total exact');
select is(public.api_event_purchase_handoff_get(pg_temp.hash(40),'event-purchase-handoff-batches',(select id from batches))#>>'{data,summary,baseline_subtotal}','9.25','baseline comparison exact');
select is(public.api_event_purchase_handoff_get(pg_temp.hash(40),'event-purchase-handoff-batches',(select id from batches))#>>'{data,summary,cost_increase}','3.70','difference exact');
reset role;
select * from finish();
rollback;
