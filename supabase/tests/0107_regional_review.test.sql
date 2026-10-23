begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('bc256000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer default 1) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'regional-review-'||n||'@test.local' from generate_series(10,16) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'regional-review-a','Redistribution A'),(pg_temp.id(2),'regional-review-b','Redistribution B');
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
reset role;

insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
values(pg_temp.id(1),pg_temp.id(100),pg_temp.id(22),'2026-10-10',37,0,1,'SAR','EA');
insert into public.network_links(organization_id,from_location_id,to_location_id,lead_time_days_p50,lead_time_days_p90,freight_basis)
values(pg_temp.id(1),pg_temp.id(22),pg_temp.id(20),2,4,'none');
create temporary table sourcing(input jsonb,report jsonb,id uuid);
grant all on sourcing to authenticated;
select pg_temp.login(10);set local role authenticated;
insert into sourcing(input) select jsonb_build_object(
 'region_id',public.stock_region_save(pg_temp.id(1),'{"name_en":"Sourcing region","location_codes":["L0","L1","L2"],"confirmed":true}',pg_temp.id(500),
 public.stock_region_preview(pg_temp.id(1),'{"name_en":"Sourcing region","location_codes":["L0","L1","L2"],"confirmed":true}')->>'fingerprint'),
 'draft_id',draft_id,'commitments_confirmed',true,'lanes_confirmed',true,
 'sources',jsonb_build_array(jsonb_build_object('location_id',pg_temp.id(22),'policy_id',pg_temp.id(52),'maximum','calculated','backorders','0'),
 jsonb_build_object('location_id',pg_temp.id(21),'policy_id',pg_temp.id(51),'maximum','calculated','backorders','4.125'))) from captured;
create function pg_temp.preview(overrides jsonb default '{}') returns jsonb language sql as $$select public.regional_sourcing_preview(pg_temp.id(1),input||overrides) from sourcing$$;
create function pg_temp.save(n integer default 600,overrides jsonb default '{}',fingerprint text default null) returns uuid language sql as $$select public.regional_sourcing_save(pg_temp.id(1),input||overrides,pg_temp.id(n),coalesce(fingerprint,report->>'fingerprint')) from sourcing$$;
update sourcing set report=pg_temp.preview();
update sourcing set id=pg_temp.save();
reset role;
insert into public.work_calendars(id,organization_id,code,name_en,country_code,weekend_days,observe_public_holidays)
values(pg_temp.id(700),pg_temp.id(1),'DATES','Dates','SA',array[6,7],false);
update public.locations set work_calendar_id=pg_temp.id(700) where organization_id=pg_temp.id(1);
create temporary table dates(report jsonb,id uuid);
grant all on dates to authenticated;
create function pg_temp.date_preview(requested date default '2026-10-10',confirmed boolean default true) returns jsonb language sql as $$select public.regional_date_preview(pg_temp.id(1),id,requested,confirmed) from sourcing$$;
create function pg_temp.date_save(n integer default 800,fingerprint text default null) returns uuid language sql as $$select public.regional_date_save(pg_temp.id(1),s.id,'2026-10-10',true,pg_temp.id(n),coalesce(fingerprint,d.report->>'fingerprint')) from sourcing s cross join dates d$$;
set local role authenticated;
insert into dates(report) select pg_temp.date_preview();
update dates set id=pg_temp.date_save();
reset role;
update public.network_links set freight_basis='per_shipment',freight_cost=1.005,currency='SAR',freight_valid_from='2026-10-12' where organization_id=pg_temp.id(1);
create temporary table freight(report jsonb,id uuid);
grant all on freight to authenticated;
create function pg_temp.freight_preview(confirmed boolean default true) returns jsonb language sql as $$select public.regional_freight_preview(pg_temp.id(1),id,confirmed) from dates$$;
create function pg_temp.freight_save(n integer default 900,fingerprint text default null) returns uuid language sql as $$select public.regional_freight_save(pg_temp.id(1),d.id,true,pg_temp.id(n),coalesce(fingerprint,f.report->>'fingerprint')) from dates d cross join freight f$$;
set local role authenticated;
insert into freight(report) select pg_temp.freight_preview();
update freight set id=pg_temp.freight_save();
create temporary table proposals(id uuid);
grant all on proposals to authenticated;
create function pg_temp.submit(n integer default 950) returns uuid language sql as $$select public.regional_transfer_submit(pg_temp.id(1),id,pg_temp.id(n),'Whole regional proposal') from freight$$;
insert into proposals select pg_temp.submit();
select is(pg_temp.submit(),(select id from proposals),'identical submit retry');
select throws_ok($$select pg_temp.submit(951)$$,'MQ409',null,'one pending per original sourcing');
select is((select source_count from public.regional_review_list),2,'both sources in workbench');
select ok((select search_text like '%sourcing region%' from public.regional_review_list),'copied region searchable');
select throws_ok($$insert into public.regional_transfer_proposals default values$$,'42501',null,'direct INSERT denied');
select throws_ok($$update public.regional_transfer_proposals set reason='changed'$$,'42501',null,'direct UPDATE denied');
select throws_ok($$delete from public.regional_transfer_proposals$$,'42501',null,'direct DELETE denied');
select throws_ok($$select public.regional_transfer_decide(pg_temp.id(1),(select id from proposals),pg_temp.id(960),'approved','Self review')$$,'MQ403',null,'independent review');
select pg_temp.login(11);
select is((select count(*)::int from public.regional_review_list),1,'viewer reads');
select throws_ok($$select pg_temp.submit(952)$$,'MQ403',null,'viewer cannot submit');
select pg_temp.login(13,2);
select is((select count(*)::int from public.regional_review_list),0,'foreign tenant hidden');
select throws_ok($$select public.regional_transfer_decide(pg_temp.id(2),(select id from proposals),pg_temp.id(961),'approved','Foreign')$$,'MQ404',null,'foreign proposal hidden');
select pg_temp.login(12);
select is((select count(*)::int from public.regional_review_list),0,'partial scope hidden');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21)),(pg_temp.id(1),pg_temp.id(12),pg_temp.id(22));
set local role authenticated;
select is((select count(*)::int from public.regional_review_list),1,'all-member access');
select throws_ok($$select public.regional_transfer_decide(pg_temp.id(1),(select id from proposals),pg_temp.id(962),'approved','Reader')$$,'MQ403',null,'scoped reader cannot approve');
select pg_temp.login(16);
select lives_ok($$select public.regional_transfer_decide(pg_temp.id(1),(select id from proposals),pg_temp.id(963),'approved','Independent review')$$,'complete approval');
select ok((select selected from public.regional_review_list),'approved proposal selected');
select pg_temp.login(10);
select public.stock_region_archive(pg_temp.id(1),(select (input->>'region_id')::uuid from sourcing));
select is(pg_temp.submit(),(select id from proposals),'submit retry survives archive');
select throws_ok($$select pg_temp.submit(954)$$,'MQ404',null,'new submit blocked after archive');
select pg_temp.login(16);
select is(public.regional_transfer_decide(pg_temp.id(1),(select id from proposals),pg_temp.id(963),'approved','Independent review'),(select id from proposals),'terminal retry survives archive');
reset role;
select ok((select relrowsecurity from pg_class where oid='public.regional_transfer_proposals'::regclass),'RLS');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.regional_review_list'::regclass),'invoker history');
select ok(not has_table_privilege(role,'public.regional_transfer_proposals','INSERT,UPDATE,DELETE'),role||' cannot write') from unnest(array['anon','authenticated','service_role','zeespare_worker','zeespare_simulation_worker']) role;
select ok(not has_function_privilege(role,'public.regional_transfer_submit(uuid,uuid,uuid,text)','execute'),role||' cannot submit') from unnest(array['anon','service_role','zeespare_worker','zeespare_simulation_worker']) role;
select is((select count(*)::int from public.audit_log where record_id=(select id from proposals)),2,'one submission and decision audit');
delete from public.regional_freight_estimates where id=(select id from freight);
select is((select count(*)::int from public.regional_transfer_proposals where organization_id=pg_temp.id(1)),0,'actual parent cascades');
select is((select count(*)::int from public.audit_log where record_id=(select id from proposals)),3,'cascade retains audit');
select * from finish();
rollback;
