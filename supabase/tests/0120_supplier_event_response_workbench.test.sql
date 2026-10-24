begin;
select no_plan();
insert into auth.users(id,email) values('a2680000-0000-4000-8000-000000000010','batch-owner@test.local');
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select case when n=10 then 'a2680000-0000-4000-8000-000000000010'::uuid else ('a2680000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid end$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'event-a2680000-'||n||'@test.local' from generate_series(11,16) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'event-publish-a2680000','Events A'),(pg_temp.id(2),'event-publish-other-a2680000','Events B');
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
create function pg_temp.workbench(filters jsonb default '{}',page integer default 1,size integer default 25) returns jsonb language sql as $$
 select public.supplier_event_response_workbench(pg_temp.id(1),filters,page,size) $$;
select pg_temp.login(11,1);
set local role authenticated;
select is(pg_temp.workbench()->>'total','2','members see explicit event single and batch publications');
select is(public.supplier_response_workbench(pg_temp.id(1))->>'total','0','ordinary workbench excludes event publications and responses');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.workbench()#>'{rows,0}') k),array['created_at','id','item_codes','kind','line_count','location_code','response','source_id','state','status','supplier_code','withdrawn_at'],'only workbench metadata is returned, no event assumptions');
select is(pg_temp.workbench('{"status":"no_response"}')->>'total','2','silence is no response');
select is(pg_temp.workbench('{"kind":"batch"}')#>>'{rows,0,source_id}',(select batch_id::text from response_fixture),'links use original batch id');
select is(pg_temp.workbench('{"kind":"handoff"}')#>>'{rows,0,id}',(select publication_id::text from response_fixture),'publication identity stays distinct');
select is(pg_temp.workbench('{"q":"SUP L0"}')->>'total','2','tokens match saved codes');
select is(pg_temp.workbench('{"supplier":"SU"}')->>'total','0','supplier filter is exact');
select is(pg_temp.workbench('{"location":"L1"}')->>'total','0','receiver filter exact');
select is(pg_temp.workbench('{"q":"%absent%"}')->>'total','0','search punctuation does not become SQL wildcards');
select is(pg_temp.workbench('{}',999)->>'page','1','out of range page clamps');
select is(pg_temp.workbench('{}',1,50)->>'size','50','allowed page size');
select throws_ok($$select pg_temp.workbench('{}',0)$$,'MQ422',null,'page bounds');
select throws_ok($$select pg_temp.workbench('{}',1,1000)$$,'MQ422',null,'size bounds');
select throws_ok($$select pg_temp.workbench('[]')$$,'MQ422',null,'object filters only');
select throws_ok($$select pg_temp.workbench('{"status":"accepted"}')$$,'MQ422',null,'no inferred acceptance status');
select throws_ok($$select pg_temp.workbench('{"kind":"event"}')$$,'MQ422',null,'only handoff and batch kinds');
select throws_ok($$select pg_temp.workbench('{"state":"current"}')$$,'MQ422',null,'publication and selection states differ');
select throws_ok($$select pg_temp.workbench('{"system":"ERP"}')$$,'MQ422',null,'not external API acknowledgement search');
select throws_ok($$select pg_temp.workbench('{"supplier":null}')$$,'MQ422',null,'filter values must be strings');
select throws_ok($$select pg_temp.workbench(jsonb_build_object('q',repeat('x',101)))$$,'MQ422',null,'search bound');
select throws_ok($$select pg_temp.workbench(jsonb_build_object('q',E'a\nb'))$$,'MQ422',null,'control filters rejected');
select pg_temp.login(2000,1);
select throws_ok($$select pg_temp.workbench()$$,'MQ404',null,'supplier grant is not staff access');
select pg_temp.report(3000,'declined','Earlier reason','batch',2100,'OLD');
select pg_temp.report(3001,'received','','batch',2100,'NEW');
select pg_temp.report(3002,'declined','Capacity unavailable','handoff',2100,'INDIVIDUAL');
select pg_temp.login(11,1);
select is(pg_temp.workbench('{"status":"received"}')->>'total','1','latest revision selected before status filter');
select is(pg_temp.workbench('{"status":"declined"}')->>'total','1','only single remains declined');
select is(pg_temp.workbench('{"kind":"batch","status":"declined"}')->>'total','0','old decline does not match');
select is(pg_temp.workbench('{"q":"Earlier reason"}')->>'total','0','search inspects latest response only');
select is(pg_temp.workbench('{"q":"NEW"}')->>'total','1','latest reference searchable');
select is(pg_temp.workbench('{"q":"supplier-2000@test.local"}')->>'total','2','author searchable');
select is(pg_temp.workbench('{"kind":"handoff"}')#>>'{rows,0,response,reason}','Capacity unavailable','decline reason retained');
select is(pg_temp.workbench('{"kind":"batch"}')#>>'{rows,0,response,revision}','2','exact publication serial revision');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.workbench('{"kind":"batch"}')#>'{rows,0,response}') k),array['author','created_at','id','reason','reference','revision','status'],'response evidence allowlist');
select pg_temp.login(10,1);
select public.supplier_event_batch_publication_withdraw(pg_temp.id(1),(select batch_publication_id from response_fixture));
select is(pg_temp.workbench('{"state":"withdrawn","status":"received"}')->>'total','1','withdrawal independent of received status');
select is(pg_temp.workbench('{"state":"published","status":"declined"}')->>'total','1','published decline remains visible');
select is(public.supplier_response_workbench(pg_temp.id(1))->>'total','0','event responses do not enter ordinary reporting');
select pg_temp.login(12,1);
select is(pg_temp.workbench()->>'total','0','wrong branch cannot see publications, authors or counts');
select pg_temp.login(13,1);
select throws_ok($$select pg_temp.workbench()$$,'MQ404',null,'forged tenant claim does not grant membership');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
select pg_temp.login(12,1);
set local role authenticated;
select is(pg_temp.workbench()->>'total','2','assigned receiver admits both kinds');
reset role;
delete from public.membership_locations where location_id=pg_temp.id(20);
set local role authenticated;
select is(pg_temp.workbench()->>'total','0','location revocation applies on next request');
reset role;
-- Copied, retained batches can exist without any current handoff. Also exercise real pagination.
insert into public.event_purchase_handoff_batches(id,organization_id,location_id,handoff_ids,created_by,payload,created_at)
 select pg_temp.id(8000+n),organization_id,location_id,array[pg_temp.id(9000+n)],created_by,payload,'2026-01-01'::timestamptz
 from public.event_purchase_handoff_batches cross join generate_series(1,26) n where id=(select batch_id from response_fixture);
insert into public.supplier_event_batch_publications(id,organization_id,batch_id,supplier_id,location_id,handoff_ids,created_by,summary,created_at)
 select pg_temp.id(10000+n),organization_id,pg_temp.id(8000+n),supplier_id,location_id,array[pg_temp.id(9000+n)],created_by,summary,'2026-01-01'::timestamptz
 from public.supplier_event_batch_publications cross join generate_series(1,26) n where id=(select batch_publication_id from response_fixture);
select pg_temp.login(11,1);
set local role authenticated;
select is(pg_temp.workbench('{"status":"no_response"}')->>'total','26','overlapping copied packages do not inherit responses');
select is(jsonb_array_length(pg_temp.workbench()->'rows'),25,'first page bounded');
select is(jsonb_array_length(pg_temp.workbench('{}',2)->'rows'),3,'remaining page bounded');
select is(pg_temp.workbench('{}',999)->>'page','2','last page redirect target');
select is(pg_temp.workbench('{}',2)#>>'{rows,0,id}',pg_temp.id(10024)::text,'tied timestamps use stable publication ID order');
select is(jsonb_array_length(pg_temp.workbench('{}',1,50)->'rows'),28,'larger allowed page returns all');
reset role;
delete from public.event_purchase_handoffs where id=(select handoff_id from response_fixture);
delete from auth.users where id=pg_temp.id(2000);
select pg_temp.login(11,1);
set local role authenticated;
select is(pg_temp.workbench()->>'total','27','single follows source deletion; copied batches remain');
select is(pg_temp.workbench('{"state":"withdrawn"}')#>>'{rows,0,response,author}','supplier-2000@test.local','original author survives account deletion');
select is(pg_temp.workbench('{"state":"withdrawn"}')#>>'{rows,0,response,reference}','NEW','retained batch history survives member deletion');
select is(pg_temp.workbench('{"q":"SUP L0 ITEM"}')->>'total','27','copied codes searchable without current source');
reset role;
select ok(not (select prosecdef from pg_proc where oid='public.supplier_event_response_workbench(uuid,jsonb,integer,integer)'::regprocedure),'invoker retains RLS');
select ok(not has_function_privilege('anon','public.supplier_event_response_workbench(uuid,jsonb,integer,integer)','execute'),'anon denied');
select ok(not has_function_privilege('service_role','public.supplier_event_response_workbench(uuid,jsonb,integer,integer)','execute'),'integration service denied');
select ok(not has_function_privilege('zeespare_worker','public.supplier_event_response_workbench(uuid,jsonb,integer,integer)','execute'),'worker denied');
select ok(not has_function_privilege('zeespare_simulation_worker','public.supplier_event_response_workbench(uuid,jsonb,integer,integer)','execute'),'simulation worker denied');
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
select throws_ok($$select pg_temp.workbench()$$,'MQ401',null,'missing user denied');
reset role;
select * from finish();
rollback;
