begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('a8200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer default 1) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'transfer-dates-'||n||'@test.local' from generate_series(10,16) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'transfer-dates-a','Transfer Dates A'),(pg_temp.id(2),'transfer-dates-b','Transfer Dates B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),
 (pg_temp.id(1),pg_temp.id(12),'branch_user'),(pg_temp.id(2),pg_temp.id(13),'owner'),
 (pg_temp.id(1),pg_temp.id(14),'planner'),(pg_temp.id(1),pg_temp.id(15),'admin'),(pg_temp.id(1),pg_temp.id(16),'approver');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone)
 select pg_temp.id(20+n),pg_temp.id(case when n=3 then 2 else 1 end),'L'||n,'Location','branch','SA','Asia/Riyadh' from generate_series(0,3) n;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
 values(pg_temp.id(100),pg_temp.id(1),'ITEM','Item','Test','SET',99,'SAR'),(pg_temp.id(101),pg_temp.id(1),'OTHER','Other','Test','EA',1,'SAR');
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(20),'2026-10-10',12,2,1,'SAR','EA'),
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(21),'2026-10-10',35.125,2.250,1,'SAR','EA'),
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(21),'2026-10-11',999,0,1,'SAR','EA');
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 select pg_temp.id(30+n),pg_temp.id(case when n=3 then 2 else 1 end),pg_temp.id(20+n),pg_temp.id(40+n),
 '2026-01-01','2026-10-10','policy','succeeded','{}',now(),'{}' from generate_series(0,3) n;
insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
 select pg_temp.id(50+n),pg_temp.id(case when n=3 then 2 else 1 end),pg_temp.id(30+n),pg_temp.id(20+n),pg_temp.id(200+n),pg_temp.id(100),'SAVED','EA','available',
 '{"protection":{"target":"20.000"}}',
 '{"options":{"lead_time":10,"review_interval":4},"forecast":{"to_date":"2026-10-10","method":"baseline-v1","source":{"unit_provenance":{"method":"source-units-v1","status":"consistent","unit":"EA","rows":1,"unknown_rows":0,"units":["EA"]}}}}' from generate_series(0,3) n;
insert into public.policy_overrides(id,organization_id,policy_id,location_id,revision,request_id,submitted_by,reorder_point,order_up_to,reason,status,decided_by,decided_at,decision_reason,decision_request_id)
 select pg_temp.id(60+n),pg_temp.id(1),pg_temp.id(51),pg_temp.id(21),n,pg_temp.id(70+n),pg_temp.id(10),1,20+n,'Scenario',
 'approved',pg_temp.id(11),now(),'Approved scenario',pg_temp.id(80+n) from generate_series(1,2) n;
insert into public.network_links(id,organization_id,from_location_id,to_location_id,lead_time_days_p50,lead_time_days_p90,freight_basis)
 values(pg_temp.id(90),pg_temp.id(1),pg_temp.id(21),pg_temp.id(20),2,4,'none');
insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90)
values(pg_temp.id(110),pg_temp.id(1),'SUP','Supplier','SA','SAR',3,3);
insert into public.open_orders(organization_id,order_code,line_code,item_id,location_id,supplier_id,expected_date,quantity,unit_cost,currency,status,unit_of_measure) values
 (pg_temp.id(1),'OVERDUE','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-09',1.250,1,'SAR','open','EA'),
 (pg_temp.id(1),'LATE','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-18',0.750,1,'SAR','open','EA'),
 (pg_temp.id(1),'SOURCE','1',pg_temp.id(100),pg_temp.id(21),pg_temp.id(110),'2026-10-10',999,1,'SAR','open','EA');
create temporary table captured(draft_id uuid,report jsonb,id uuid);
grant all on captured to authenticated;
set local role authenticated;
select pg_temp.login(10);
insert into captured(draft_id) select public.replenishment_save(pg_temp.id(1),pg_temp.id(50),pg_temp.id(300),'calculated',null,'4',true,
  public.replenishment_preview(pg_temp.id(1),pg_temp.id(50),'calculated',null,'4',true)->>'fingerprint');
update captured set id=public.redistribution_save(pg_temp.id(1),draft_id,pg_temp.id(51),'calculated',null,'4.125',true,true,pg_temp.id(301),
  public.redistribution_preview(pg_temp.id(1),draft_id,pg_temp.id(51),'calculated',null,'4.125',true,true)->>'fingerprint');
reset role;
insert into public.work_calendars(id,organization_id,code,name_en,country_code,weekend_days,observe_public_holidays) values
 (pg_temp.id(500),pg_temp.id(1),'SOURCE','Synthetic source','SA',array[5,6]::smallint[],false),
 (pg_temp.id(501),pg_temp.id(1),'RECEIVER','Synthetic receiver','SA',array[5,6]::smallint[],false);
update public.locations set work_calendar_id=pg_temp.id(case when id=pg_temp.id(21) then 500 else 501 end) where organization_id=pg_temp.id(1);
insert into public.holiday_overrides(id,organization_id,work_calendar_id,starts_on,ends_on,kind,name_en) values
 (pg_temp.id(510),pg_temp.id(1),pg_temp.id(501),'2026-10-13','2026-10-13','closure','Receiving closure'),
 (pg_temp.id(511),pg_temp.id(1),pg_temp.id(501),'2026-10-15','2026-10-15','closure','Receiving closure');
create function pg_temp.preview(requested date default '2026-10-10',confirmed boolean default true)
returns jsonb language sql as $$select public.transfer_date_preview(pg_temp.id(1),(select id from captured),requested,confirmed)$$;
create function pg_temp.save(request integer default 600,fingerprint text default null,requested date default '2026-10-10',confirmed boolean default true)
returns uuid language sql as $$select public.transfer_date_save(pg_temp.id(1),(select id from captured),requested,confirmed,pg_temp.id(request),coalesce(fingerprint,pg_temp.preview(requested,confirmed)->>'fingerprint'))$$;
create temporary table saved_dates(id uuid,report jsonb);
grant all on saved_dates to authenticated;
set local role authenticated;
insert into saved_dates(id,report) select pg_temp.save(),pg_temp.preview();
reset role;
update public.network_links set freight_basis='per_unit',freight_cost=1.234,currency='SAR',freight_unit='EA',freight_valid_from='2026-10-11' where id=pg_temp.id(90);
create function pg_temp.fp(confirmed boolean default true) returns jsonb language sql as $$select public.transfer_freight_preview(pg_temp.id(1),(select id from saved_dates),confirmed)$$;
create function pg_temp.fs(request integer default 900,fingerprint text default null,confirmed boolean default true) returns uuid language sql as $$select public.transfer_freight_save(pg_temp.id(1),(select id from saved_dates),confirmed,pg_temp.id(request),coalesce(fingerprint,pg_temp.fp(confirmed)->>'fingerprint'))$$;
create temporary table saved_freight(id uuid,report jsonb);
grant all on saved_freight to authenticated;
set local role authenticated;
insert into saved_freight select pg_temp.fs(),pg_temp.fp();
create function pg_temp.submit(request integer default 1000,reason text default ' Transfer rationale ',estimate uuid default null)
returns uuid language sql as $$select public.transfer_proposal_submit(pg_temp.id(1),coalesce(estimate,(select id from saved_freight)),pg_temp.id(request),reason)$$;
create temporary table proposals(id uuid);
grant all on proposals to authenticated;
create function pg_temp.decide(decision text default 'approved',request integer default 1100,reason text default ' Independent review ',proposal uuid default null)
returns uuid language sql as $$select public.transfer_proposal_decide(pg_temp.id(1),coalesce(proposal,(select id from proposals limit 1)),pg_temp.id(request),decision,reason)$$;
select is(pg_temp.fp()#>>'{source,receipts,p90,timing_review_required}','false','fixture has no slow timing warning');
select throws_ok($$select pg_temp.submit(1000,'  ')$$,'MQ422',null,'blank reason rejected');
select throws_ok($$select pg_temp.submit(1000,repeat('x',2001))$$,'MQ422',null,'oversized reason rejected');
select throws_ok($$select pg_temp.submit(1000,null)$$,'MQ422',null,'null reason rejected');
select pg_temp.login(11);
select throws_ok($$select pg_temp.submit()$$,'MQ403',null,'viewer cannot submit');
select pg_temp.login(16);
select throws_ok($$select pg_temp.submit()$$,'MQ403',null,'approver cannot submit');
select pg_temp.login(14);
insert into proposals select pg_temp.submit();
select is((select reason from public.transfer_proposals where id=(select id from proposals)),'Transfer rationale','trimmed reason retained');
select is((select draft_id from public.transfer_proposals where id=(select id from proposals)),(select id from captured),'original redistribution lineage derived');
select is(pg_temp.submit(),(select id from proposals),'identical submission retries stable');
select throws_ok($$select pg_temp.submit(1000,'Changed')$$,'MQ409',null,'conflicting request rejected');
select throws_ok($$select pg_temp.submit(1001)$$,'MQ409',null,'one pending per original draft');
select throws_ok($$select pg_temp.submit(1001,'Alternate',pg_temp.fs(901))$$,'MQ409',null,'alternate estimate cannot bypass pending gate');
select throws_ok($$select pg_temp.decide()$$,'MQ403',null,'author cannot approve own proposal');
select throws_ok($$select pg_temp.decide('rejected')$$,'MQ403',null,'author cannot reject own proposal');
select throws_ok($$update public.transfer_proposals set status='approved'$$,'42501',null,'direct update denied');
select throws_ok($$delete from public.transfer_proposals$$,'42501',null,'direct delete denied');
select throws_ok($$insert into public.transfer_proposals default values$$,'42501',null,'direct insert denied');
select pg_temp.login(11);
select is((select count(*) from public.transfer_review_list),1::bigint,'viewer reads history');
select throws_ok($$select pg_temp.decide()$$,'MQ403',null,'viewer cannot approve');
select throws_ok($$select pg_temp.decide('withdrawn')$$,'MQ403',null,'another user cannot withdraw');
select pg_temp.login(12);
select is((select count(*) from public.transfer_review_list),0::bigint,'destination-only history hidden');
select throws_ok($$select pg_temp.decide('withdrawn')$$,'MQ404',null,'destination-only RPC hidden');
reset role;
update public.membership_locations set location_id=pg_temp.id(21) where user_id=pg_temp.id(12);
set local role authenticated;
select is((select count(*) from public.transfer_proposals),0::bigint,'source-only history hidden');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
set local role authenticated;
select is((select count(*) from public.transfer_review_list),1::bigint,'both endpoint grants expose history');
select pg_temp.login(13,2);
select is((select count(*) from public.transfer_proposals),0::bigint,'cross-tenant proposals hidden');
select throws_ok($$select public.transfer_proposal_submit(pg_temp.id(2),(select id from saved_freight),pg_temp.id(1001),'Other tenant')$$,'MQ404',null,'cross-tenant source unavailable');
select throws_ok($$select public.transfer_proposal_decide(pg_temp.id(2),(select id from proposals),pg_temp.id(1100),'approved','Other tenant')$$,'MQ404',null,'cross-tenant decision unavailable');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.submit(1001)$$,'MQ403',null,'active claim narrows submission');
select is((select count(*) from public.transfer_review_list),0::bigint,'active claim narrows list');
select pg_temp.login(16);
select throws_ok($$select pg_temp.decide('pending')$$,'MQ422',null,'invalid decision rejected');
select throws_ok($$select pg_temp.decide('approved',1100,' ')$$,'MQ422',null,'decision reason required');
select is(pg_temp.decide(),(select id from proposals),'independent approver approves');
select is(pg_temp.decide(),(select id from proposals),'identical decision retry stable');
select throws_ok($$select pg_temp.decide('rejected',1100)$$,'MQ409',null,'terminal decision immutable');
select is((select selected from public.transfer_review_list where id=(select id from proposals)),true,'first approval selected');
select is((select typical_receipt from public.transfer_review_list where id=(select id from proposals)),'2026-10-14','adjusted typical date exposed');
select is((select slow_receipt from public.transfer_review_list where id=(select id from proposals)),'2026-10-18','adjusted slow date exposed');
select pg_temp.login(10);
insert into proposals select pg_temp.submit(1002,'Later revision');
select pg_temp.login(15);
select lives_ok($$select pg_temp.decide('approved',1102,'Second review',(select id from proposals offset 1))$$,'independent admin approves later revision');
select is((select count(*) from public.transfer_review_list where selected),1::bigint,'one selected approval');
select is((select revision from public.transfer_review_list where selected),2,'later approval selected');
select is((select count(*) from public.transfer_review_list where status='approved'),2::bigint,'prior approval retained');
select pg_temp.login(10);
insert into proposals select pg_temp.submit(1003,'Stale evidence');
reset role;
update public.network_links set freight_cost=9 where id=pg_temp.id(90);
set local role authenticated;
select throws_ok($$select pg_temp.submit(1004)$$,'MQ409',null,'stale submission blocked');
select pg_temp.login(16);
select throws_ok($$select pg_temp.decide('approved',1103,'Review',(select id from proposals offset 2))$$,'MQ409',null,'stale approval blocked');
select lives_ok($$select pg_temp.decide('rejected',1103,'Changed terms',(select id from proposals offset 2))$$,'stale proposal can be rejected');
select is(pg_temp.decide(),(select id from proposals limit 1),'terminal retry preserves earlier approval after freight changes');
select pg_temp.login(14);
select is(pg_temp.submit(),(select id from proposals limit 1),'submission retry retains original after freight changes');
reset role;
-- Restore exact saved terms/timestamp so timing gates can be tested independently.
update public.network_links set freight_cost=1.234 where id=pg_temp.id(90);
set local role authenticated;
update saved_freight set id=pg_temp.fs(902),report=pg_temp.fp();
select pg_temp.login(10);
insert into proposals select pg_temp.submit(1004,'Timing review');
reset role;
update public.transfer_freight_estimates set report=jsonb_set(report,'{source,receipts,p90,timing_review_required}','true') where id=(select id from saved_freight);
set local role authenticated;
select pg_temp.login(16);
select throws_ok($$select pg_temp.decide('approved',1104,'Review',(select id from proposals offset 3))$$,'MQ422',null,'slow timing warning blocks approval');
reset role;
update public.transfer_freight_estimates set report=jsonb_set(jsonb_set(report,'{source,receipts,p90,timing_review_required}','false'),'{source,receipts,p50,timing_review_required}','null') where id=(select id from saved_freight);
set local role authenticated;
select throws_ok($$select pg_temp.decide('approved',1104,'Review',(select id from proposals offset 3))$$,'MQ422',null,'unknown typical timing blocks approval');
reset role;
update public.transfer_freight_estimates set report=report #- '{source,receipts,p50,timing_review_required}' where id=(select id from saved_freight);
set local role authenticated;
select throws_ok($$select pg_temp.decide('approved',1104,'Review',(select id from proposals offset 3))$$,'MQ422',null,'missing timing evidence blocks approval');
select pg_temp.login(10);
select lives_ok($$select pg_temp.decide('withdrawn',1104,'Withdraw for timing',(select id from proposals offset 3))$$,'author may withdraw flagged proposal');
reset role;
update public.transfer_freight_estimates set report=(select report from saved_freight) where id=(select id from saved_freight);
set local role authenticated;
select pg_temp.login(14);
insert into proposals select pg_temp.submit(1005,'Role change');
reset role;
update public.memberships set role='branch_user' where user_id=pg_temp.id(14);
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(14),pg_temp.id(20));
set local role authenticated;
select throws_ok($$select pg_temp.decide('withdrawn',1105,'Withdraw',(select id from proposals offset 4))$$,'MQ404',null,'author loses access without both endpoints');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(14),pg_temp.id(21));
set local role authenticated;
select lives_ok($$select pg_temp.decide('withdrawn',1105,'Withdraw',(select id from proposals offset 4))$$,'demoted author with both endpoints withdraws');
reset role;
select is((select count(*) from public.audit_log where table_name='transfer_proposals' and organization_id=pg_temp.id(1)),10::bigint,'one submission and decision audit per proposal despite retries');
select is((select count(*) from public.stock_snapshots where organization_id=pg_temp.id(1)),3::bigint,'review creates no stock');
select is((select count(*) from public.open_orders where organization_id=pg_temp.id(1)),3::bigint,'review creates no inbound');
select is((select count(*) from public.receipts where organization_id=pg_temp.id(1)),0::bigint,'review creates no receipts');
-- Trusted fixture mutation tests fail-closed legacy/zero evidence; API roles cannot mutate it.
update public.transfer_freight_estimates set report=jsonb_set(report,'{source,source,quantity}','"0"') where id=(select id from saved_freight);
set local role authenticated;
select pg_temp.login(10);
select throws_ok($$select pg_temp.submit(1006)$$,'MQ422',null,'zero quantity cannot be proposed');
reset role;
set local role anon;
select throws_ok($$select * from public.transfer_proposals$$,'42501',null,'anonymous table denied');
select throws_ok($$select pg_temp.submit()$$,'42501',null,'anonymous RPC denied');
reset role;
set local role service_role;
select throws_ok($$select * from public.transfer_proposals$$,'42501',null,'service table denied');
select throws_ok($$select pg_temp.submit()$$,'42501',null,'service RPC denied');
reset role;
select ok(not has_table_privilege('zeespare_worker','public.transfer_proposals','select'),'worker table denied');
select ok(not has_function_privilege('zeespare_worker','public.transfer_proposal_submit(uuid,uuid,uuid,text)','execute'),'worker submit denied');
select ok(not has_function_privilege('zeespare_worker','public.transfer_proposal_decide(uuid,uuid,uuid,text,text)','execute'),'worker decision denied');
select * from finish();
rollback;
