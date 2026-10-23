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
update fixture set proposal_id=pg_temp.propose();
create function pg_temp.handoff() returns uuid language sql as $$select public.purchase_handoff_create(pg_temp.id(1),(select proposal_id from fixture))$$;
select throws_ok($$select pg_temp.handoff()$$,'MQ409',null,'pending proposal cannot export');
select pg_temp.login(14,1);
select lives_ok($$select pg_temp.decide('approved')$$,'approve fixture independently');
select throws_ok($$select pg_temp.handoff()$$,'MQ403',null,'approver cannot create');
select pg_temp.login(10,1);
select throws_ok($$select public.purchase_handoff_create(pg_temp.id(1),null)$$,'MQ422',null,'source required');
select throws_ok($$select public.purchase_handoff_create(pg_temp.id(1),pg_temp.id(999))$$,'MQ404',null,'unknown source hidden');
reset role;
alter table fixture add handoff_id uuid;
alter table fixture add payload jsonb;
set local role authenticated;
update fixture set handoff_id=pg_temp.handoff();
update fixture set payload=(select payload from public.purchase_handoffs where id=fixture.handoff_id);
select is(pg_temp.handoff(),(select handoff_id from fixture),'repeated creation returns same identity');
select is((select payload#>>'{purpose}' from fixture),'planning_only','clearly planning only');
select is((select payload#>'{estimate}' from fixture),(select report from fixture),'exact saved estimate copied');
select is((select payload#>>'{proposal,approved_by}' from fixture),pg_temp.id(14)::text,'independent approval copied');
select is((select payload#>>'{evidence,policy_id}' from fixture),pg_temp.id(50)::text,'policy lineage captured');
select is((select payload#>>'{evidence,forecast_id}' from fixture),pg_temp.id(200)::text,'forecast lineage captured');
select ok((select selected from public.purchase_handoff_list),'new handoff selected');
select throws_ok($$insert into public.purchase_handoffs select * from public.purchase_handoffs$$,'42501',null,'direct insert denied');
select throws_ok($$update public.purchase_handoffs set payload='{}'$$,'42501',null,'direct mutation denied');
select throws_ok($$delete from public.purchase_handoffs$$,'42501',null,'direct deletion denied');
select pg_temp.login(11,1);
select is((select count(*) from public.purchase_handoffs),1::bigint,'viewer reads evidence');
select throws_ok($$select pg_temp.handoff()$$,'MQ403',null,'viewer cannot create/replay');
select pg_temp.login(12,1);
select is((select count(*) from public.purchase_handoffs),0::bigint,'branch hides other location');
select is((select count(*) from public.purchase_handoff_list),0::bigint,'branch list scoped');
select pg_temp.login(13,2);
select is((select count(*) from public.purchase_handoffs),0::bigint,'tenant hides other exports');
select is((select count(*) from public.purchase_handoff_list),0::bigint,'tenant list scoped');
select throws_ok($$select pg_temp.handoff()$$,'MQ403',null,'tenant cannot create');
select throws_ok($$select public.purchase_handoff_create(pg_temp.id(2),(select proposal_id from fixture))$$,'MQ404',null,'foreign identity hidden in active tenant');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
select pg_temp.login(12,1);
set local role authenticated;
select is((select count(*) from public.purchase_handoffs),1::bigint,'assigned branch can read');
reset role;
select is((select count(*) from public.audit_log where table_name='purchase_handoffs' and organization_id=pg_temp.id(1)),1::bigint,'one audit record for repeat creation');
set local role authenticated;
select pg_temp.login(10,1);
update fixture set proposal_id=pg_temp.propose(901);
select pg_temp.login(14,1);
select lives_ok($$select pg_temp.decide('approved',951)$$,'replacement approved');
select ok(not (select selected from public.purchase_handoff_list),'older handoff now historical');
select pg_temp.login(10,1);
update public.supplier_items set unit_price=2 where id=pg_temp.id(130);
select throws_ok($$select pg_temp.handoff()$$,'MQ409',null,'stale price blocks new handoff');
select is(public.purchase_handoff_create(pg_temp.id(1),(select (payload#>>'{proposal,id}')::uuid from fixture)),(select handoff_id from fixture),'historical retry ignores new price');
select is((select payload from public.purchase_handoffs),(select payload from fixture),'later changes preserve original bytes evidence');
reset role;
-- Privileged fixtures probe fail-closed gates, without changing the earlier exported payload.
update public.purchase_cost_estimates set report=jsonb_set(report,'{source,policy_recalculation_required}','true') where id=(select estimate_id from fixture);
set local role authenticated;
select throws_ok($$select pg_temp.handoff()$$,'MQ422',null,'policy recalculation blocks export');
reset role;
update public.purchase_cost_estimates set report=report#-'{source,policy_recalculation_required}' where id=(select estimate_id from fixture);
set local role authenticated;
select throws_ok($$select pg_temp.handoff()$$,'MQ422',null,'missing policy flag blocks export');
reset role;
select is((select count(*) from public.open_orders where organization_id=pg_temp.id(1)),5::bigint,'no inbound created');
select is((select count(*) from public.stock_snapshots where organization_id=pg_temp.id(1)),2::bigint,'stock unchanged');
select is((select count(*) from public.receipts where organization_id=pg_temp.id(1)),1::bigint,'receipts unchanged');
set local role anon;
select throws_ok($$select * from public.purchase_handoffs$$,'42501',null,'anon cannot read');
select throws_ok($$select public.purchase_handoff_create(null,null)$$,'42501',null,'anon cannot create');
reset role;
set local role service_role;
select throws_ok($$select * from public.purchase_handoffs$$,'42501',null,'service role cannot read');
select throws_ok($$select public.purchase_handoff_create(null,null)$$,'42501',null,'service role cannot create');
reset role;
select ok(not has_table_privilege('zeespare_worker','public.purchase_handoffs','SELECT'),'worker cannot read');
select ok(not has_function_privilege('zeespare_worker','public.purchase_handoff_create(uuid,uuid)','EXECUTE'),'worker cannot create');
select * from finish();
rollback;
