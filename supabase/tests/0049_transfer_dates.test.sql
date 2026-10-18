begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('a8100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
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
select is(pg_temp.preview()->>'status','available','both receipt scenarios resolve');
select is(pg_temp.preview()->'dispatch'->>'date','2026-10-11','source weekend moves dispatch to Sunday');
select is(pg_temp.preview()->'receipts'->'p50'->>'nominal_date','2026-10-13','p50 uses calendar days');
select is(pg_temp.preview()->'receipts'->'p50'->'search'->>'date','2026-10-14','receiving closure shifts typical receipt');
select is(pg_temp.preview()->'receipts'->'p90'->>'nominal_date','2026-10-15','p90 uses its separate saved lead');
select is(pg_temp.preview()->'receipts'->'p90'->'search'->>'date','2026-10-18','slow receipt crosses closure and weekend');
select is(pg_temp.preview()->>'timing_reference_date','2026-10-13','timing reference uses destination policy lead, not review interval');
select is(pg_temp.preview()->'receipts'->'p50'->>'timing_review_required','true','typical timing concern explicit');
select is(pg_temp.preview()->'receipts'->'p90'->>'timing_review_required','true','slow timing concern explicit');
select is((pg_temp.preview()->'source'->>'quantity')::numeric,8.750::numeric,'saved transfer quantity unchanged');
select is(pg_temp.preview()->'source'->'destination'->'orders'->0->>'overdue','true','original destination warning retained');
select is(pg_temp.preview('2026-10-10',false)->>'status','calendars_unconfirmed','calendar confirmation is explicit');
select throws_ok($$select pg_temp.save(601,null,'2026-10-10',false)$$,'MQ422',null,'unconfirmed positive scenario cannot save');
select throws_ok($$select pg_temp.preview('2026-10-09')$$,'MQ422',null,'date before cutoff rejected');
select throws_ok($$select pg_temp.preview('infinity')$$,'MQ422',null,'infinite date rejected');
select throws_ok($$select pg_temp.preview('2101-01-01')$$,'MQ422',null,'out-of-range date rejected');
select throws_ok($$select pg_temp.preview(null)$$,'MQ422',null,'missing date rejected');
select throws_ok($$select pg_temp.preview('2026-10-10',null)$$,'MQ422',null,'null confirmation rejected');
select pg_temp.login(11);
select is(pg_temp.preview()->>'status','available','viewer previews');
select throws_ok($$select pg_temp.save()$$,'MQ403',null,'viewer cannot save');
select pg_temp.login(16);
select throws_ok($$select pg_temp.save()$$,'MQ403',null,'approver cannot save');
select pg_temp.login(12);
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'destination-only branch cannot preview');
reset role;
delete from public.membership_locations where user_id=pg_temp.id(12);
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));
set local role authenticated;
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'source-only branch cannot preview');
select pg_temp.login(13,2);
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'tenant denied before source lookup');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'active claim narrows preview');
select pg_temp.login(14);
insert into saved_dates values(pg_temp.save(),pg_temp.preview());
select is(pg_temp.save(),(select id from saved_dates),'identical retry returns original id');
select is((select report from public.transfer_date_scenarios where id=(select id from saved_dates)),(select report from saved_dates),'immutable report exactly matches preview');
select throws_ok($$select pg_temp.save(600,null,'2026-10-11')$$,'MQ409',null,'conflicting request date rejected');
select throws_ok($$update public.transfer_date_scenarios set report='{}'$$,'42501',null,'direct update denied');
select throws_ok($$delete from public.transfer_date_scenarios$$,'42501',null,'direct delete denied');
select throws_ok($$insert into public.transfer_date_scenarios default values$$,'42501',null,'direct insert denied');
select pg_temp.login(10);
select throws_ok($$select pg_temp.save()$$,'MQ409',null,'author is part of retry identity');
select pg_temp.login(11);
select is((select count(*) from public.transfer_date_scenario_list),1::bigint,'viewer can inspect history');
select pg_temp.login(12);
select is((select count(*) from public.transfer_date_scenario_list),0::bigint,'source-only branch cannot count dates');
reset role;
delete from public.membership_locations where user_id=pg_temp.id(12);
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
set local role authenticated;
select is((select count(*) from public.transfer_date_scenarios),0::bigint,'destination-only branch cannot read dates');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));
set local role authenticated;
select is((select count(*) from public.transfer_date_scenario_list),1::bigint,'both endpoint assignments permit history');
select is(pg_temp.preview()->>'status','available','both endpoint assignments permit preview');
select throws_ok($$select pg_temp.save(601)$$,'MQ403',null,'branch user still cannot save');
select pg_temp.login(13,2);
select is((select count(*) from public.transfer_date_scenarios),0::bigint,'cross-tenant history hidden');
select pg_temp.login(10,2);
select is((select count(*) from public.transfer_date_scenarios),0::bigint,'active claim hides saved history');
reset role;
select pg_temp.login(14);
select is((select count(*) from public.audit_log where organization_id=pg_temp.id(1) and table_name='transfer_date_scenarios'),1::bigint,'one audit for identical retries');
update public.work_calendars set weekend_days='{}' where organization_id=pg_temp.id(1);
delete from public.holiday_overrides where organization_id=pg_temp.id(1);
select is(pg_temp.preview()->'dispatch'->>'date','2026-10-10','new preview uses current confirmed calendar');
select is(pg_temp.preview()->'receipts'->'p50'->>'timing_review_required','false','receipt within reference not flagged');
select is(pg_temp.preview()->'receipts'->'p90'->>'timing_review_required','true','slow receipt independently flagged');
select throws_ok($$select pg_temp.save(601,(select report->>'fingerprint' from saved_dates))$$,'MQ409',null,'calendar change requires refresh');
select is(pg_temp.save(600,(select report->>'fingerprint' from saved_dates)),(select id from saved_dates),'retry keeps captured calendars');
update public.work_calendars set observe_public_holidays=true where id=pg_temp.id(500);
select is(pg_temp.preview()->>'status','dispatch_unavailable','unknown source coverage blocks dispatch');
select is(jsonb_array_length(pg_temp.preview()->'dispatch'->'days'),1,'stop on first unknown date');
select throws_ok($$select pg_temp.save(601)$$,'MQ422',null,'unknown dates cannot save');
insert into public.holiday_overrides(organization_id,work_calendar_id,starts_on,ends_on,kind,name_en)
 values(pg_temp.id(1),pg_temp.id(500),'2026-10-10','2026-10-10','working_day','Explicit synthetic working day');
select is(pg_temp.preview()->>'status','available','explicit override resolves uncovered source date');
update public.work_calendars set observe_public_holidays=true where id=pg_temp.id(501);
insert into public.holiday_overrides(organization_id,work_calendar_id,starts_on,ends_on,kind,name_en)
 values(pg_temp.id(1),pg_temp.id(501),'2026-10-12','2026-10-12','working_day','Known typical receipt');
select is(pg_temp.preview()->>'status','receipt_unavailable','unresolved slow receipt keeps overall preview unavailable');
select is(pg_temp.preview()->'receipts'->'p50'->'search'->>'date','2026-10-12','known typical receipt remains inspectable');
select is(pg_temp.preview()->'receipts'->'p90'->'search'->>'status','calendar_unknown','slow unknown remains explicit');
select is(pg_temp.preview()->'receipts'->'p90'->>'timing_review_required',null,'unknown receipt is not an on-time claim');
select throws_ok($$select pg_temp.save(601)$$,'MQ422',null,'partial dates cannot save');
update public.work_calendars set observe_public_holidays=false,is_active=false where id=pg_temp.id(501);
select is(pg_temp.preview()->'receipts'->'p50'->'search'->>'status','calendar_inactive','inactive receiving calendar explained');
update public.work_calendars set is_active=true where id=pg_temp.id(501);
delete from public.holiday_overrides where organization_id=pg_temp.id(1);
update public.work_calendars set observe_public_holidays=false,weekend_days='{}' where id=pg_temp.id(500);
insert into public.holiday_overrides(id,organization_id,work_calendar_id,starts_on,ends_on,kind,name_en)
 values(pg_temp.id(512),pg_temp.id(1),pg_temp.id(500),'2026-10-10',date '2026-10-10'+89,'closure','Synthetic 90-day closure');
select is(pg_temp.preview()->'dispatch'->>'status','search_exhausted','all-closed source calendar bounded');
select is(jsonb_array_length(pg_temp.preview()->'dispatch'->'days'),90,'source search limited to 90 dates');
delete from public.holiday_overrides where id=pg_temp.id(512);
update public.locations set is_active=false where id=pg_temp.id(21);
select is(pg_temp.preview()->>'status','source_location_unavailable','inactive source blocked');
update public.locations set is_active=true where id=pg_temp.id(21);
update public.locations set is_active=false where id=pg_temp.id(20);
select is(pg_temp.preview()->>'status','destination_location_unavailable','inactive receiver blocked');
update public.locations set is_active=true where id=pg_temp.id(20);
update public.network_links set is_active=false where id=pg_temp.id(90);
select is(pg_temp.preview()->>'status','lane_unavailable','inactive current lane blocked');
update public.network_links set is_active=true,lead_time_days_p90=5 where id=pg_temp.id(90);
select is(pg_temp.preview()->>'status','lane_changed','changed lead does not silently replace saved lead');
select throws_ok($$select pg_temp.save(601)$$,'MQ422',null,'changed lane cannot save');
update public.network_links set lead_time_days_p90=4,from_location_id=pg_temp.id(20),to_location_id=pg_temp.id(21) where id=pg_temp.id(90);
select is(pg_temp.preview()->>'status','lane_unavailable','reversed lane not accepted');
delete from public.network_links where id=pg_temp.id(90);
select is(pg_temp.preview()->>'status','lane_unavailable','deleted lane not accepted');
select is(pg_temp.save(600,(select report->>'fingerprint' from saved_dates)),(select id from saved_dates),'saved retry survives deleted lane');
update public.stock_snapshots set quantity=0 where organization_id=pg_temp.id(1);
select is((select report from public.transfer_date_scenarios where id=(select id from saved_dates)),(select report from saved_dates),'stock and lane changes leave saved report intact');
update public.redistribution_drafts set report=jsonb_set(report,'{quantity}','"0"') where id=(select id from captured);
select is(pg_temp.preview('2026-10-10',false)->>'status','no_transfer_needed','zero quantity needs no scheduling or confirmation');
select is(pg_temp.preview('2026-10-10',false)->'dispatch','null'::jsonb,'zero has no dispatch');
select lives_ok($$select pg_temp.save(601,null,'2026-10-10',false)$$,'zero scenario can retain no-transfer evidence');
select is((select sum(quantity) from public.open_orders where organization_id=pg_temp.id(1)),1001::numeric,'no inbound created');
select is((select count(*) from public.receipts where organization_id=pg_temp.id(1)),0::bigint,'no receipts created');
select is((select count(*) from public.transfer_date_scenarios where organization_id=pg_temp.id(1)),2::bigint,'only available and zero scenarios saved');
set local role anon;
select throws_ok($$select pg_temp.preview()$$,'42501',null,'anonymous has no capability');
set local role service_role;
select throws_ok($$select pg_temp.preview()$$,'42501',null,'integration service has no capability');
reset role;
select ok(not has_function_privilege('maqdar_worker','public.transfer_date_preview(uuid,uuid,date,boolean)','EXECUTE'),'worker cannot preview');
select ok(not has_function_privilege('maqdar_worker','public.transfer_date_save(uuid,uuid,date,boolean,uuid,text)','EXECUTE'),'worker cannot save');
select * from finish();
rollback;
