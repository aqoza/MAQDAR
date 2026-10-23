begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('98100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
create function pg_temp.compare(day date default '2026-10-10',basis text default 'calculated',override_id uuid default null) returns jsonb language sql as $$select public.policy_stock_comparison(pg_temp.id(1),pg_temp.id(50),day,basis,override_id)$$;
insert into auth.users(id,email) select pg_temp.id(n),'draft-'||n||'@test.local' from generate_series(10,14) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'draft-a','Draft A'),(pg_temp.id(2),'draft-b','Draft B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),
 (pg_temp.id(1),pg_temp.id(12),'branch_user'),(pg_temp.id(2),pg_temp.id(13),'owner');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone)
 select pg_temp.id(20+n),pg_temp.id(case when n=2 then 2 else 1 end),'L'||n,'Location','branch','SA','Asia/Riyadh' from generate_series(0,2) n;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
 values(pg_temp.id(100),pg_temp.id(1),'ITEM','Item','Test','SET',99,'SAR');
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(20),'2026-10-10',12,2,1.125,'KWD','EA'),
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(20),'2026-10-11',999,0,1,'SAR','EA');
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 select pg_temp.id(30+n),pg_temp.id(case when n=2 then 2 else 1 end),pg_temp.id(20+n),pg_temp.id(40+n),
 '2026-01-01','2026-10-10','policy','succeeded','{}',now(),'{}' from generate_series(0,2) n;
insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
 select pg_temp.id(50+n),pg_temp.id(case when n=2 then 2 else 1 end),pg_temp.id(30+n),pg_temp.id(20+n),pg_temp.id(200+n),pg_temp.id(100),'SAVED','EA','available',
 '{"protection":{"target":"20.000"}}',
 '{"options":{"lead_time":3,"review_interval":4},"forecast":{"to_date":"2026-10-10","method":"baseline-v1","source":{"unit_provenance":{"method":"source-units-v1","status":"consistent","unit":"EA","rows":1,"unknown_rows":0,"units":["EA"]}}}}' from generate_series(0,2) n;
insert into public.policy_overrides(id,organization_id,policy_id,location_id,revision,request_id,submitted_by,reorder_point,order_up_to,reason,status,decided_by,decided_at,decision_reason,decision_request_id)
 select pg_temp.id(60+n),pg_temp.id(1),pg_temp.id(50),pg_temp.id(20),n,pg_temp.id(70+n),pg_temp.id(10),1,20+n,'Scenario',
 'approved',pg_temp.id(11),now(),'Approved scenario',pg_temp.id(80+n) from generate_series(1,2) n;
insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90)
values(pg_temp.id(110),pg_temp.id(1),'SUP','Supplier','SA','SAR',3,3);
insert into public.open_orders(id,organization_id,order_code,line_code,item_id,location_id,supplier_id,expected_date,quantity,unit_cost,currency,status,unit_of_measure) values
 (pg_temp.id(120),pg_temp.id(1),'O1','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-09',3.250,1,'SAR','open','EA'),
 (pg_temp.id(121),pg_temp.id(1),'O2','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-18',2.750,1,'SAR','open','EA'),
 (pg_temp.id(122),pg_temp.id(1),'CLOSED','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-12',999,1,'SAR','closed',null),
 (pg_temp.id(123),pg_temp.id(1),'ZERO','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-12',0,1,'SAR','open',null),
 (pg_temp.id(124),pg_temp.id(1),'CANCELED','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-12',999,1,'SAR','canceled','KG');
insert into public.receipts(organization_id,receipt_code,line_code,item_id,location_id,supplier_id,receipt_date,quantity,unit_cost,currency)
values(pg_temp.id(1),'REC','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-10',100,1,'SAR');
create temporary table fixture(draft_id uuid,report jsonb,scenario_id uuid);
grant all on fixture to authenticated;
select pg_temp.login(10,1);
set local role authenticated;
insert into fixture(draft_id) select public.replenishment_save(pg_temp.id(1),pg_temp.id(50),pg_temp.id(300),'calculated',null,'4',true,
  public.replenishment_preview(pg_temp.id(1),pg_temp.id(50),'calculated',null,'4',true)->>'fingerprint');
insert into public.supplier_items(id,organization_id,supplier_id,item_id,lead_time_days,min_order_quantity,pack_size,unit_price,currency,unit_of_measure)
values(pg_temp.id(130),pg_temp.id(1),pg_temp.id(110),pg_temp.id(100),3,10,6,1,'SAR','EA');
reset role;

set local role authenticated;
update fixture set scenario_id=public.supplier_scenario_save(pg_temp.id(1),draft_id,'SUP',true,pg_temp.id(400),
 public.supplier_scenario_preview(pg_temp.id(1),draft_id,'SUP',true)->>'fingerprint');
reset role;
insert into public.work_calendars(id,organization_id,code,name_en,country_code,weekend_days,observe_public_holidays)
values(pg_temp.id(500),pg_temp.id(1),'SEND','Sending','SA','{}'::smallint[],false),
 (pg_temp.id(501),pg_temp.id(1),'RECEIVE','Receiving','SA','{}'::smallint[],false);
update public.suppliers set work_calendar_id=pg_temp.id(500) where id=pg_temp.id(110);
update public.locations set work_calendar_id=pg_temp.id(501) where id=pg_temp.id(20);
alter table fixture add delivery_id uuid;

set local role authenticated;
update fixture set delivery_id=public.delivery_scenario_save(pg_temp.id(1),scenario_id,'2026-10-10',true,pg_temp.id(600),
 public.delivery_scenario_preview(pg_temp.id(1),scenario_id,'2026-10-10',true)->>'fingerprint');
reset role;
alter table fixture add estimate_id uuid;
create function pg_temp.preview(confirmed boolean default true) returns jsonb language sql as $$select public.purchase_cost_preview(pg_temp.id(1),(select delivery_id from fixture),confirmed)$$;
create function pg_temp.save(request integer default 800,fingerprint text default null,confirmed boolean default true) returns uuid language sql as $$select public.purchase_cost_save(pg_temp.id(1),(select delivery_id from fixture),confirmed,pg_temp.id(request),coalesce(fingerprint,pg_temp.preview(confirmed)->>'fingerprint'))$$;
set local role authenticated;

update public.supplier_items set valid_from='2026-10-10',unit_price=1.005 where id=pg_temp.id(130);
update fixture set estimate_id=pg_temp.save(),report=pg_temp.preview();
reset role;
insert into public.memberships(organization_id,user_id,role) values(pg_temp.id(1),pg_temp.id(14),'approver');
alter table fixture add proposal_id uuid;
create function pg_temp.propose(request integer default 900,why text default 'Plan purchase') returns uuid language sql as $$select public.purchase_proposal_submit(pg_temp.id(1),(select estimate_id from fixture),pg_temp.id(request),why)$$;
create function pg_temp.decide(decision text,request integer default 950,why text default 'Reviewed') returns uuid language sql as $$select public.purchase_proposal_decide(pg_temp.id(1),(select proposal_id from fixture),pg_temp.id(request),decision,why)$$;
set local role authenticated;
update fixture set proposal_id=pg_temp.propose();
create function pg_temp.handoff() returns uuid language sql as $$select public.purchase_handoff_create(pg_temp.id(1),(select proposal_id from fixture))$$;

select pg_temp.login(14,1);
select pg_temp.decide('approved');
select pg_temp.login(10,1);
reset role;
alter table fixture add handoff_id uuid;
set local role authenticated;
update fixture set handoff_id=pg_temp.handoff();
reset role;


alter table fixture add batch_id uuid, add publication_id uuid, add batch_publication_id uuid, add response_id uuid;
select pg_temp.login(10,1);
set local role authenticated;
update fixture set batch_id=public.purchase_handoff_batch_create(pg_temp.id(1),array[handoff_id]);
update fixture set publication_id=public.supplier_publication_publish(pg_temp.id(1),handoff_id,true,public.supplier_publication_preview(pg_temp.id(1),handoff_id)->>'fingerprint');
update fixture set batch_publication_id=public.supplier_batch_publication_publish(pg_temp.id(1),batch_id,true,public.supplier_batch_publication_preview(pg_temp.id(1),batch_id)->>'fingerprint');
reset role;
insert into auth.users(id,email,email_confirmed_at) select pg_temp.id(n),'supplier-'||n||'@test.local',now() from generate_series(2000,2003) n;
insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90) values(pg_temp.id(111),pg_temp.id(1),'OTHER','Other','SA','SAR',3,3);
insert into public.supplier_portal_grants(id,organization_id,supplier_id,email,user_id,created_by,accepted_at) values
 (pg_temp.id(2100),pg_temp.id(1),pg_temp.id(110),'supplier-2000@test.local',pg_temp.id(2000),pg_temp.id(10),now()),
 (pg_temp.id(2101),pg_temp.id(1),pg_temp.id(110),'supplier-2001@test.local',pg_temp.id(2001),pg_temp.id(10),now()),
 (pg_temp.id(2102),pg_temp.id(1),pg_temp.id(111),'supplier-2002@test.local',pg_temp.id(2002),pg_temp.id(10),now()),
 (pg_temp.id(2103),pg_temp.id(1),pg_temp.id(110),'supplier-2003@test.local',null,pg_temp.id(10),null);
create function pg_temp.report(request integer default 3000,state text default 'received',why text default '',kind text default 'batch',grantn integer default 2100,ref text default '') returns uuid language sql as $$
 select public.supplier_response_submit(pg_temp.id(grantn),kind,(select case when kind='batch' then batch_publication_id else publication_id end from fixture),pg_temp.id(request),state,ref,why) $$;
create function pg_temp.history(kind text default 'batch',grantn integer default 2100,page integer default 1) returns jsonb language sql as $$
 select public.supplier_response_history(pg_temp.id(grantn),kind,(select case when kind='batch' then batch_publication_id else publication_id end from fixture),page) $$;
create function pg_temp.internal(kind text default 'batch') returns jsonb language sql as $$
 select public.supplier_response_history_internal(pg_temp.id(1),kind,(select case when kind='batch' then batch_publication_id else publication_id end from fixture)) $$;
create temporary table unchanged as select (select jsonb_agg(to_jsonb(o) order by id) from public.open_orders o) orders,(select jsonb_agg(to_jsonb(s) order by id) from public.stock_snapshots s) stock,(select jsonb_agg(to_jsonb(p) order by id) from public.purchase_proposals p) proposals;
select pg_temp.login(2000,2); -- Forged/stale staff tenant claim must not widen or deny the separate supplier grant.
set local role authenticated;
select is(pg_temp.history()->>'total','0','no response is absence');
select is(pg_temp.history()->'latest','null'::jsonb,'no inferred acceptance');
select throws_ok($$select pg_temp.report(3000,'declined')$$,'MQ422',null,'decline needs reason');
select throws_ok($$select pg_temp.report(3000,'declined',E'\n\t')$$,'MQ422',null,'whitespace is not a reason');
select throws_ok($$select pg_temp.report(3000,'accepted')$$,'MQ422',null,'acceptance is not a response status');
select throws_ok($$select pg_temp.report(3000,'received',repeat('x',2001))$$,'MQ422',null,'bounded reason');
select throws_ok($$select pg_temp.report(3000,'received','','batch',2100,E'bad\nref')$$,'MQ422',null,'control reference rejected');
update fixture set response_id=pg_temp.report();
select is(pg_temp.report(),(select response_id from fixture),'identical retries return original event');
select throws_ok($$select pg_temp.report(3000,'declined','Unavailable')$$,'MQ409',null,'conflicting retry rejected');
select throws_ok($$select pg_temp.report(3000,'received','','handoff')$$,'MQ409',null,'request identity spans package kinds');
select is(pg_temp.history('handoff')->>'total','0','batch report does not report its member');
select is(pg_temp.history()->>'total','1','retry creates one event');
select is((select array_agg(key order by key) from jsonb_object_keys(pg_temp.history()#>'{rows,0}') key),array['author','created_at','id','reason','reference','revision','status'],'supplier history has exact allowlist');
select is(pg_temp.history()#>>'{latest,author}','supplier-2000@test.local','responding account is captured');
select is((select count(*) from public.supplier_responses),0::bigint,'supplier has no direct table access');
select throws_ok($$delete from public.supplier_responses$$,'42501',null,'direct delete denied');
select throws_ok($$update public.supplier_responses set status='received'$$,'42501',null,'direct update denied');
select throws_ok($$select app.supplier_response_page(pg_temp.id(1),'batch',(select batch_publication_id from fixture),1)$$,'42501',null,'private history bypass denied');
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
select is((select count(*) from public.supplier_responses),0::bigint,'foreign tenant sees no reports');
select throws_ok($$select pg_temp.internal()$$,'MQ403',null,'foreign tenant history denied');
select pg_temp.login(12,1);
select is((select count(*) from public.supplier_responses),0::bigint,'wrong branch sees no reports');
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
update public.suppliers set is_active=false where id=pg_temp.id(110);
set local role authenticated;
select throws_ok($$select pg_temp.report()$$,'MQ404',null,'retry rechecks supplier activity');
reset role;
update public.suppliers set is_active=true where id=pg_temp.id(110);
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
select public.supplier_batch_publication_withdraw(pg_temp.id(1),(select batch_publication_id from fixture));
select pg_temp.login(2001,1);
select throws_ok($$select pg_temp.report(3000,'declined','Capacity unavailable','batch',2101,'SUP-REF')$$,'MQ404',null,'withdrawn retries fail');
select throws_ok($$select pg_temp.history('batch',2101)$$,'MQ404',null,'withdrawn history hidden from supplier');
select pg_temp.login(11,1);
select is(pg_temp.internal()->>'total','28','staff history retained after withdrawal');
reset role;
select is((select jsonb_agg(to_jsonb(o) order by id) from public.open_orders o),(select orders from unchanged),'responses do not create or update orders');
select is((select jsonb_agg(to_jsonb(s) order by id) from public.stock_snapshots s),(select stock from unchanged),'responses do not move stock');
select is((select jsonb_agg(to_jsonb(p) order by id) from public.purchase_proposals p),(select proposals from unchanged),'responses do not change approvals');
select is((select count(*) from public.audit_log where table_name='supplier_responses'),29::bigint,'one audit event per response');
delete from auth.users where id=pg_temp.id(2001);
select is((select count(*) from public.supplier_responses),29::bigint,'actor/grant deletion retains responses');
delete from public.purchase_handoffs where id=(select handoff_id from fixture);
select is((select count(*) from public.supplier_responses where publication_id is not null),0::bigint,'single responses follow actual parent deletion');
select is((select count(*) from public.supplier_responses where batch_publication_id is not null),28::bigint,'copied batch responses survive member deletion');
delete from public.open_orders where organization_id=pg_temp.id(1);
delete from public.receipts where organization_id=pg_temp.id(1);
delete from public.suppliers where id=pg_temp.id(110);
select is((select count(*) from public.supplier_responses),28::bigint,'copied batch history survives supplier and grant deletion');
delete from public.purchase_handoff_batches where id=(select batch_id from fixture);
select is((select count(*) from public.supplier_responses),0::bigint,'batch response deletion follows actual batch');
select * from finish();
rollback;
