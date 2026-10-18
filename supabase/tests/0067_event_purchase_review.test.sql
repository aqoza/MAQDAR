begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('99300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
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
select throws_ok($$select pg_temp.propose(900,'  ')$$,'MQ422',null,'blank reason rejected');
select throws_ok($$select pg_temp.propose(900,repeat('x',2001))$$,'MQ422',null,'long reason rejected');
update review_fixture set proposal_id=pg_temp.propose();
select is(pg_temp.propose(),(select proposal_id from review_fixture),'submission retry returns original');
select throws_ok($$select pg_temp.propose(900,'Different')$$,'MQ409',null,'request binds reason');
select throws_ok($$select pg_temp.propose(901)$$,'MQ409',null,'one pending per draft');
select throws_ok($$select pg_temp.decide('approved')$$,'MQ403',null,'owner cannot approve own proposal');
select throws_ok($$select pg_temp.decide('rejected')$$,'MQ403',null,'owner cannot reject own proposal');
select throws_ok($$insert into public.event_purchase_proposals(organization_id,estimate_id,draft_id,location_id,revision,request_id,submitted_by,reason) select pg_temp.id(1),estimate_id,draft_id,pg_temp.id(20),2,pg_temp.id(901),pg_temp.id(10),'Direct' from review_fixture$$,'42501',null,'direct insertion denied');
select throws_ok($$update public.event_purchase_proposals set reason='Changed'$$,'42501',null,'direct update denied');
select throws_ok($$delete from public.event_purchase_proposals$$,'42501',null,'direct delete denied');
select pg_temp.login(11,1);
select is((select count(*) from public.event_purchase_review_list),1::bigint,'viewer can inspect');
select throws_ok($$select pg_temp.propose(901)$$,'MQ403',null,'viewer cannot submit');
select throws_ok($$select pg_temp.decide('approved')$$,'MQ403',null,'viewer cannot approve');
select throws_ok($$select pg_temp.decide('withdrawn')$$,'MQ403',null,'non-author cannot withdraw');
select pg_temp.login(12,1);
select is((select count(*) from public.event_purchase_proposals),0::bigint,'branch cannot read outside location');
select is((select count(*) from public.event_purchase_review_list),0::bigint,'branch list hides outside location');
select throws_ok($$select pg_temp.decide('withdrawn')$$,'MQ404',null,'out of branch decision unavailable');
select pg_temp.login(13,2);
select is((select count(*) from public.event_purchase_proposals),0::bigint,'other tenant cannot read');
select is((select count(*) from public.event_purchase_review_list),0::bigint,'other tenant list empty');
select throws_ok($$select pg_temp.propose(901)$$,'MQ403',null,'other tenant cannot submit');
select throws_ok($$select pg_temp.decide('approved')$$,'MQ403',null,'other tenant cannot decide');
select pg_temp.login(15,1);
select throws_ok($$select pg_temp.propose(901)$$,'MQ403',null,'approver cannot submit');
select is(pg_temp.decide('approved'),(select proposal_id from review_fixture),'independent approval');
select is(pg_temp.decide('approved'),(select proposal_id from review_fixture),'approval retry');
select throws_ok($$select pg_temp.decide('rejected')$$,'MQ409',null,'terminal decision immutable');
select ok((select selected from public.event_purchase_review_list where id=(select proposal_id from review_fixture)),'approval selected');
reset role;
select is((select count(*) from public.audit_log where record_id=(select proposal_id from review_fixture)),2::bigint,'one audit per transition');
set local role authenticated;
select pg_temp.login(10,1);
select is(pg_temp.propose(),(select proposal_id from review_fixture),'submission replay after decision');
update review_fixture set proposal_id=pg_temp.propose(901);
select pg_temp.login(15,1);
select throws_ok($$select pg_temp.decide('rejected',950)$$,'MQ409',null,'decision key cannot cross proposals');
select lives_ok($$select pg_temp.decide('rejected',951)$$,'reject next proposal');
select is((select revision from public.event_purchase_review_list where selected),1,'rejection preserves earlier selection');
select pg_temp.login(10,1);
update review_fixture set proposal_id=pg_temp.propose(902);
select pg_temp.login(15,1);
select lives_ok($$select pg_temp.decide('approved',952)$$,'later approval succeeds');
select is((select revision from public.event_purchase_review_list where selected),3,'latest approval selected');
select is((select count(*) from public.event_purchase_proposals where status='approved'),2::bigint,'earlier approval retained');
select pg_temp.login(10,1);
update review_fixture set proposal_id=pg_temp.propose(903);
update public.supplier_items set unit_price=2 where id=pg_temp.id(300);
select pg_temp.login(15,1);
select throws_ok($$select pg_temp.decide('approved',953)$$,'MQ409',null,'changed price blocks approval');
select lives_ok($$select pg_temp.decide('rejected',953)$$,'changed price does not block rejection');
select pg_temp.login(10,1);
select throws_ok($$select pg_temp.propose(904)$$,'MQ409',null,'changed price blocks submission');
update review_fixture set estimate_id=pg_temp.cost_save(801);
update review_fixture set proposal_id=pg_temp.propose(904);
reset role;
update public.memberships set role='viewer' where user_id=pg_temp.id(10) and organization_id=pg_temp.id(1);
set local role authenticated;
select lives_ok($$select pg_temp.decide('withdrawn',954)$$,'demoted author can withdraw');
select is((select revision from public.event_purchase_review_list where selected),3,'withdrawal preserves selection');
reset role;
update public.memberships set role='owner' where user_id=pg_temp.id(10) and organization_id=pg_temp.id(1);
select is((select quantity from public.event_purchase_review_list where selected),'4.5','selection is full adjusted quantity');
select is((select baseline_quantity from public.event_purchase_review_list where selected),'3','baseline stays comparison evidence');
select is((select event_name from public.event_purchase_review_list where selected),'Launch','event searchable evidence');
select is((select count(*) from public.purchase_proposals where organization_id=pg_temp.id(1)),0::bigint,'ordinary selections untouched');
select is((select count(*) from public.open_orders where organization_id=pg_temp.id(1)),4::bigint,'no inbound created');
select is((select count(*) from public.stock_snapshots where organization_id=pg_temp.id(1)),2::bigint,'stock unchanged');
-- Each saved timing signal fails closed, without blocking rejection/withdrawal.
create function pg_temp.flag_test(flag text,val jsonb,remove boolean default false) returns void language plpgsql as $$
declare r jsonb; delivery uuid; estimate uuid; proposal uuid;
begin
 select saved into delivery from delivery_capture;
 select report into r from public.event_delivery_scenarios where id=delivery;
 update public.event_delivery_scenarios set report=case when remove then report-flag else jsonb_set(report,array[flag],val) end where id=delivery;
 perform pg_temp.login(10,1);
 estimate:=public.event_purchase_cost_save(pg_temp.id(1),delivery,true,gen_random_uuid(),pg_temp.cost_preview()->>'fingerprint');
 proposal:=public.event_purchase_proposal_submit(pg_temp.id(1),estimate,gen_random_uuid(),'Timing concern');
 perform pg_temp.login(15,1);
 begin
   perform public.event_purchase_proposal_decide(pg_temp.id(1),proposal,gen_random_uuid(),'approved','Try approval');
   raise exception 'unexpected approval';
 exception when sqlstate 'MQ422' then null; end;
 perform public.event_purchase_proposal_decide(pg_temp.id(1),proposal,gen_random_uuid(),'rejected','Timing unresolved');
 update public.event_delivery_scenarios set report=r where id=delivery;
end $$;
select lives_ok($$select pg_temp.flag_test('policy_recalculation_required','true')$$,'policy flag blocks approval but allows rejection');
select lives_ok($$select pg_temp.flag_test('policy_recalculation_required','null')$$,'null policy evidence blocks');
select lives_ok($$select pg_temp.flag_test('policy_recalculation_required','null',true)$$,'missing policy evidence blocks');
select lives_ok($$select pg_temp.flag_test('event_before_receipt','[{"date":"2026-10-11","quantity":"1"}]')$$,'event additions before receipt block approval');
select lives_ok($$select pg_temp.flag_test('event_before_receipt','null')$$,'null event evidence blocks');
select lives_ok($$select pg_temp.flag_test('event_before_receipt','null',true)$$,'missing event evidence blocks');
select lives_ok($$select pg_temp.flag_test('event_before_receipt','{}')$$,'non-array event evidence blocks');
-- Current evidence changes block new submission; original estimate remains intact.
select pg_temp.login(10,1);
update review_fixture set estimate_id=pg_temp.cost_save(810);
update public.suppliers set is_active=false where id=pg_temp.id(200);
select throws_ok($$select pg_temp.propose(920)$$,'MQ409',null,'inactive supplier blocks submission');
update public.suppliers set is_active=true where id=pg_temp.id(200);
update review_fixture set estimate_id=pg_temp.cost_save(811);
update public.locations set is_active=false where id=pg_temp.id(20);
select throws_ok($$select pg_temp.propose(920)$$,'MQ409',null,'inactive receiver blocks submission');
update public.locations set is_active=true where id=pg_temp.id(20);
update public.supplier_items set unit_price=0 where id=pg_temp.id(300);
update review_fixture set estimate_id=pg_temp.cost_save(812),proposal_id=null;
set local role authenticated;
update review_fixture set proposal_id=pg_temp.propose(920);
select pg_temp.login(15,1);
select lives_ok($$select pg_temp.decide('approved',980)$$,'zero price is eligible with positive adjusted quantity');
reset role;
-- Corrupt source outcomes are privileged fixtures, never client writes.
update public.event_purchase_cost_estimates set report=jsonb_set(report,'{status}','"no_order_needed"') where id=(select estimate_id from review_fixture);
select pg_temp.login(10,1);set local role authenticated;
select throws_ok($$select pg_temp.propose(921)$$,'MQ422',null,'no-order comparisons cannot submit');
reset role;
update public.event_purchase_cost_estimates set report=jsonb_set(jsonb_set(report,'{status}','"available"'),'{adjusted,quantity}','"0"') where id=(select estimate_id from review_fixture);
set local role authenticated;
select throws_ok($$select pg_temp.propose(921)$$,'MQ422',null,'positive adjusted quantity required');
select pg_temp.login(10,2);
select is((select count(*) from public.event_purchase_proposals),0::bigint,'claim narrows reads');
select throws_ok($$select pg_temp.propose(921)$$,'MQ403',null,'claim narrows submission');
reset role;

select pg_temp.login(10,1);
update review_fixture set estimate_id=pg_temp.cost_save(820);
set local role authenticated;
update review_fixture set proposal_id=pg_temp.propose(930);
reset role;
-- A separate saved event draft remains independent even with identical source evidence.
create function pg_temp.other_estimate() returns uuid language plpgsql as $$
declare d uuid;s uuid;delivery uuid;r jsonb;
begin
 d:=pg_temp.save(230);
 r:=public.event_supplier_preview(pg_temp.id(1),d,'SUP',true);
 s:=public.event_supplier_save(pg_temp.id(1),d,'SUP',true,gen_random_uuid(),r->>'fingerprint');
 r:=public.event_delivery_preview(pg_temp.id(1),s,'2026-10-10',true);
 delivery:=public.event_delivery_save(pg_temp.id(1),s,'2026-10-10',true,gen_random_uuid(),r->>'fingerprint');
 r:=public.event_purchase_cost_preview(pg_temp.id(1),delivery,true);
 return public.event_purchase_cost_save(pg_temp.id(1),delivery,true,gen_random_uuid(),r->>'fingerprint');
end $$;
set local role authenticated;
select lives_ok($$select public.event_purchase_proposal_submit(pg_temp.id(1),pg_temp.other_estimate(),pg_temp.id(931),'Independent draft')$$,'independent draft can submit while original is pending');
select is((select count(*) from public.event_purchase_proposals where status='pending'),2::bigint,'pending uniqueness is per saved event draft');
select lives_ok($$select pg_temp.decide('withdrawn',990)$$,'author withdraws original');
select pg_temp.login(14,1);
select lives_ok($$select pg_temp.propose(932)$$,'planner can submit');
select throws_ok($$select pg_temp.decide('approved',991)$$,'MQ403',null,'planner cannot review');
reset role;
update review_fixture set proposal_id=(select id from public.event_purchase_proposals where request_id=pg_temp.id(932));
set local role authenticated;
select lives_ok($$select pg_temp.decide('withdrawn',991)$$,'planner author can withdraw');
select pg_temp.login(16,1);
update review_fixture set proposal_id=pg_temp.propose(933);
select pg_temp.login(10,1);
select lives_ok($$select pg_temp.decide('approved',992)$$,'owner independently approves admin submission');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
set local role authenticated;select pg_temp.login(12,1);
select ok((select count(*) from public.event_purchase_review_list)>0,'permitted branch reads review history');
select throws_ok($$select pg_temp.propose(934)$$,'MQ403',null,'branch cannot submit');
reset role;
set local role anon;
select throws_ok($$select * from public.event_purchase_proposals$$,'42501',null,'anon cannot read');
select throws_ok($$select pg_temp.propose(921)$$,'42501',null,'anon cannot execute');
reset role;
select * from finish();
rollback;
