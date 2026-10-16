begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('98000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
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
select throws_ok($$select pg_temp.propose(900,'  ')$$,'MQ422',null,'blank reason rejected');
select throws_ok($$select pg_temp.propose(900,repeat('x',2001))$$,'MQ422',null,'long reason rejected');
update fixture set proposal_id=pg_temp.propose();
select is(pg_temp.propose(),(select proposal_id from fixture),'submission retry returns original');
select throws_ok($$select pg_temp.propose(900,'Different')$$,'MQ409',null,'request binds reason');
select throws_ok($$select pg_temp.propose(901)$$,'MQ409',null,'one pending per draft');
select throws_ok($$select pg_temp.decide('approved')$$,'MQ403',null,'owner cannot approve own proposal');
select throws_ok($$select pg_temp.decide('rejected')$$,'MQ403',null,'owner cannot reject own proposal');
select throws_ok($$insert into public.purchase_proposals(organization_id,estimate_id,draft_id,location_id,revision,request_id,submitted_by,reason) select pg_temp.id(1),estimate_id,draft_id,pg_temp.id(20),2,pg_temp.id(901),pg_temp.id(10),'Direct' from fixture$$,'42501',null,'direct insertion denied');
select throws_ok($$update public.purchase_proposals set reason='Changed'$$,'42501',null,'direct update denied');
select throws_ok($$delete from public.purchase_proposals$$,'42501',null,'direct delete denied');
select pg_temp.login(11,1);
select is((select count(*) from public.purchase_review_list),1::bigint,'viewer can inspect');
select throws_ok($$select pg_temp.propose(901)$$,'MQ403',null,'viewer cannot submit');
select throws_ok($$select pg_temp.decide('approved')$$,'MQ403',null,'viewer cannot approve');
select throws_ok($$select pg_temp.decide('withdrawn')$$,'MQ403',null,'non-author cannot withdraw');
select pg_temp.login(12,1);
select is((select count(*) from public.purchase_proposals),0::bigint,'branch cannot read outside location');
select is((select count(*) from public.purchase_review_list),0::bigint,'branch list hides outside location');
select throws_ok($$select pg_temp.decide('withdrawn')$$,'MQ404',null,'out of branch decision unavailable');
select pg_temp.login(13,2);
select is((select count(*) from public.purchase_proposals),0::bigint,'other tenant cannot read');
select is((select count(*) from public.purchase_review_list),0::bigint,'other tenant list empty');
select throws_ok($$select pg_temp.propose(901)$$,'MQ403',null,'other tenant cannot submit');
select throws_ok($$select pg_temp.decide('approved')$$,'MQ403',null,'other tenant cannot decide');
select pg_temp.login(14,1);
select throws_ok($$select pg_temp.propose(901)$$,'MQ403',null,'approver cannot submit');
select is(pg_temp.decide('approved'),(select proposal_id from fixture),'independent approval');
select is(pg_temp.decide('approved'),(select proposal_id from fixture),'approval retry');
select throws_ok($$select pg_temp.decide('rejected')$$,'MQ409',null,'terminal decision immutable');
select ok((select selected from public.purchase_review_list where id=(select proposal_id from fixture)),'approval selected');
reset role;
select is((select count(*) from public.audit_log where record_id=(select proposal_id from fixture)),2::bigint,'one audit per transition');
set local role authenticated;
select pg_temp.login(10,1);
select is(pg_temp.propose(),(select proposal_id from fixture),'submission replay after decision');
update fixture set proposal_id=pg_temp.propose(901);
select pg_temp.login(14,1);
select throws_ok($$select pg_temp.decide('rejected',950)$$,'MQ409',null,'decision key cannot cross proposals');
select lives_ok($$select pg_temp.decide('rejected',951)$$,'reject next proposal');
select is((select revision from public.purchase_review_list where selected),1,'rejection preserves earlier selection');
select pg_temp.login(10,1);
update fixture set proposal_id=pg_temp.propose(902);
select pg_temp.login(14,1);
select lives_ok($$select pg_temp.decide('approved',952)$$,'later approval succeeds');
select is((select revision from public.purchase_review_list where selected),3,'latest approval selected');
select is((select count(*) from public.purchase_proposals where status='approved'),2::bigint,'earlier approval retained');
select pg_temp.login(10,1);
update fixture set proposal_id=pg_temp.propose(903);
update public.supplier_items set unit_price=2 where id=pg_temp.id(130);
select pg_temp.login(14,1);
select throws_ok($$select pg_temp.decide('approved',953)$$,'MQ409',null,'changed price blocks approval');
select lives_ok($$select pg_temp.decide('rejected',953)$$,'changed price does not block rejection');
select pg_temp.login(10,1);
select throws_ok($$select pg_temp.propose(904)$$,'MQ409',null,'changed price blocks submission');
update fixture set estimate_id=pg_temp.save(801);
update fixture set proposal_id=pg_temp.propose(904);
reset role;
update public.memberships set role='viewer' where user_id=pg_temp.id(10) and organization_id=pg_temp.id(1);
set local role authenticated;
select lives_ok($$select pg_temp.decide('withdrawn',954)$$,'demoted author can withdraw');
select is((select revision from public.purchase_review_list where selected),3,'withdrawal preserves selection');
reset role;
update public.memberships set role='owner' where user_id=pg_temp.id(10) and organization_id=pg_temp.id(1);
set local role authenticated;
update fixture set delivery_id=public.delivery_scenario_save(pg_temp.id(1),scenario_id,'2026-10-11',true,pg_temp.id(601),public.delivery_scenario_preview(pg_temp.id(1),scenario_id,'2026-10-11',true)->>'fingerprint');
update fixture set estimate_id=pg_temp.save(802);
update fixture set proposal_id=pg_temp.propose(905);
select pg_temp.login(14,1);
select throws_ok($$select pg_temp.decide('approved',955)$$,'MQ422',null,'late saved delivery blocks approval');
select lives_ok($$select pg_temp.decide('rejected',955)$$,'flagged proposal can be rejected');
select is((select count(*) from public.open_orders),5::bigint,'review creates no inbound');
select is((select report from public.purchase_cost_estimates where request_id=pg_temp.id(800)),(select report from fixture),'original estimate unchanged');
select is((select count(*) from public.stock_snapshots),2::bigint,'stock unchanged');
reset role;
-- Privileged corrupt/missing evidence fixture exercises fail-closed approval.
update public.purchase_cost_estimates set report=report#-'{source,policy_recalculation_required}' where id=(select estimate_id from fixture);
insert into public.purchase_proposals(organization_id,estimate_id,draft_id,location_id,revision,request_id,submitted_by,reason)
select pg_temp.id(1),estimate_id,draft_id,pg_temp.id(20),7,pg_temp.id(906),pg_temp.id(10),'Missing flag fixture' from fixture;
update fixture set proposal_id=(select id from public.purchase_proposals where request_id=pg_temp.id(906));
set local role authenticated;
select throws_ok($$select pg_temp.decide('approved',956)$$,'MQ422',null,'missing policy flag blocks approval');
reset role;
-- Unavailable/zero sources stay readable but cannot enter the review queue.
update public.purchase_cost_estimates set report=jsonb_set(report,'{status}','"no_order_needed"') where id=(select estimate_id from fixture);
select pg_temp.login(10,1);
set local role authenticated;
select throws_ok($$select pg_temp.propose(907)$$,'MQ422',null,'zero-order estimate cannot be proposed');
reset role;
update public.purchase_cost_estimates set report=jsonb_set(report,'{status}','"price_unconfirmed"') where id=(select estimate_id from fixture);
set local role authenticated;
select throws_ok($$select pg_temp.propose(907)$$,'MQ422',null,'unavailable estimate cannot be proposed');
reset role;
update public.purchase_cost_estimates set report=jsonb_set(jsonb_set(report,'{status}','"available"'),'{source,quantity}','"0"') where id=(select estimate_id from fixture);
set local role authenticated;
select throws_ok($$select pg_temp.propose(907)$$,'MQ422',null,'positive quantity independently required');
reset role;
select * from finish();
rollback;
