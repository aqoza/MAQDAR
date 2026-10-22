begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('bc252000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer default 1) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'regional-dates-'||n||'@test.local' from generate_series(10,16) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'regional-dates-a','Redistribution A'),(pg_temp.id(2),'regional-dates-b','Redistribution B');
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
 '{"options":{"lead_time":3,"review_interval":4},"forecast":{"to_date":"2026-10-10","method":"baseline-v1","source":{"unit_provenance":{"method":"source-units-v1","status":"consistent","unit":"EA","rows":1,"unknown_rows":0,"units":["EA"]}}}}' from generate_series(0,3) n;
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
select is((select report->>'status' from dates),'available','complete schedule');
select is((select report#>>'{lines,0,dispatch,date}' from dates),'2026-10-12','source weekend shifts dispatch');
select is((select report#>>'{lines,0,receipts,p50,search,date}' from dates),'2026-10-14','typical receipt adds calendar lead');
select is((select report#>>'{lines,0,receipts,p90,search,date}' from dates),'2026-10-16','slow receipt adds calendar lead');
select is((select report#>>'{lines,0,quantity}' from dates),(select report#>>'{lines,0,quantity}' from sourcing),'allocated quantity unchanged');
select is((select report#>>'{lines,1,quantity}' from dates),(select report#>>'{lines,1,quantity}' from sourcing),'second allocated quantity unchanged');
select is((select report->'source' from dates),(select report from sourcing),'complete source evidence copied');
select is((select report#>>'{source,destination,orders,0,overdue}' from dates),'true','overdue warning retained');
select is((select report#>>'{source,destination,orders,1,late}' from dates),'true','late inbound warning retained');
select is((select report->>'timing_reference_date' from dates),'2026-10-13','reference uses original policy lead');
select is((select report#>>'{lines,0,receipts,p50,timing_review_required}' from dates),'true','flags late typical arrival');
select is((select report#>>'{lines,1,receipts,p90,timing_review_required}' from dates),'true','flags late slow arrival');
select is(pg_temp.date_preview('2026-10-10',false)->>'status','calendars_unconfirmed','confirmation required for positive transfers');
select throws_ok($$select pg_temp.date_preview('2026-10-09')$$,'MQ422',null,'date cannot precede cutoff');
select throws_ok($$select pg_temp.date_preview('infinity')$$,'MQ422',null,'finite date required');
select throws_ok($$select pg_temp.date_preview(null)$$,'MQ422',null,'date required');
select throws_ok($$select pg_temp.date_preview('2026-10-10',null)$$,'MQ422',null,'confirmation explicit');
select throws_ok($$select pg_temp.date_save(801,'bad')$$,'MQ422',null,'fingerprint validated');
update dates set id=pg_temp.date_save();
select is(pg_temp.date_save(),(select id from dates),'stable retry');
select throws_ok($$select pg_temp.date_save(800,repeat('f',64))$$,'MQ409',null,'conflicting retry rejected');
select is((select count(*)::int from public.regional_date_list),1,'invoker view sees own record');
select throws_ok($$insert into public.regional_date_scenarios default values$$,'42501',null,'direct insert forbidden');
select throws_ok($$update public.regional_date_scenarios set report='{}'$$,'42501',null,'direct update forbidden');
select throws_ok($$delete from public.regional_date_scenarios$$,'42501',null,'direct delete forbidden');
select pg_temp.login(11);
select is((select count(*)::int from public.regional_date_list),1,'viewer can inspect');
select throws_ok($$select pg_temp.date_save()$$,'MQ403',null,'viewer cannot retry');
select pg_temp.login(16);
select throws_ok($$select pg_temp.date_save()$$,'MQ403',null,'approver cannot save');
select pg_temp.login(12);
select is((select count(*)::int from public.regional_date_list),0,'partial membership hides history');
select throws_ok($$select pg_temp.date_preview()$$,'MQ404',null,'partial membership hides private calendar preview');
select pg_temp.login(13,2);
select is((select count(*)::int from public.regional_date_scenarios),0,'foreign tenant cannot inspect');
select throws_ok($$select pg_temp.date_preview()$$,'MQ404',null,'foreign tenant cannot preview');
select throws_ok($$select pg_temp.date_save()$$,'MQ403',null,'foreign tenant cannot save');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21)),(pg_temp.id(1),pg_temp.id(12),pg_temp.id(22));
select pg_temp.login(12);set local role authenticated;
select is((select count(*)::int from public.regional_date_list),1,'all members required for visibility');
select is(pg_temp.date_preview(),(select report from dates),'all-location member may inspect preview');
reset role;
update public.locations set name_en='Changed source' where id=pg_temp.id(21);
select pg_temp.login(10);set local role authenticated;
select throws_ok($$select pg_temp.date_save(801)$$,'MQ409',null,'changed labels require refreshed preview');
select is(pg_temp.date_save(),(select id from dates),'saved retry ignores later evidence changes');
select public.stock_region_archive(pg_temp.id(1),(select (input->>'region_id')::uuid from sourcing));
select throws_ok($$select pg_temp.date_preview()$$,'MQ404',null,'archive blocks new scheduling');
select throws_ok($$select pg_temp.date_save(801)$$,'MQ404',null,'archive blocks first save');
select is(pg_temp.date_save(),(select id from dates),'archive retains stable retry');
reset role;
delete from public.stock_regions where organization_id=pg_temp.id(1);
delete from public.inventory_policies where organization_id=pg_temp.id(1);
select pg_temp.login(10);set local role authenticated;
select is(pg_temp.date_save(),(select id from dates),'source region and policy deletion retain saved retry');
select is((select r.report from public.regional_date_scenarios r),(select report from dates),'copied evidence unchanged');
reset role;
select is((select count(*)::int from public.audit_log where organization_id=pg_temp.id(1) and table_name='regional_date_scenarios' and operation='INSERT'),1,'one insert audit');
delete from public.stock_snapshots where location_id=pg_temp.id(22);
delete from public.network_links where from_location_id=pg_temp.id(22);
delete from public.planning_runs where location_id=pg_temp.id(22);
delete from public.locations where id=pg_temp.id(22);
select is((select count(*)::int from public.regional_date_scenarios where organization_id=pg_temp.id(1)),0,'included location deletion cascades through sourcing');
select is((select count(*)::int from public.audit_log where organization_id=pg_temp.id(1) and table_name='regional_date_scenarios' and operation='DELETE'),1,'parent deletion audited');
select * from finish();
rollback;
