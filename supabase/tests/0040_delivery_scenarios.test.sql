begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('98000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
create function pg_temp.compare(day date default '2026-10-10',basis text default 'calculated',override_id uuid default null) returns jsonb language sql as $$select public.policy_stock_comparison(pg_temp.id(1),pg_temp.id(50),day,basis,override_id)$$;
insert into auth.users(id,email) select pg_temp.id(n),'draft-'||n||'@test.local' from generate_series(10,13) n;
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
values(pg_temp.id(500),pg_temp.id(1),'SEND','Sending','SA',array[6,7]::smallint[],false),
 (pg_temp.id(501),pg_temp.id(1),'RECEIVE','Receiving','SA',array[4,5]::smallint[],false);
update public.suppliers set work_calendar_id=pg_temp.id(500) where id=pg_temp.id(110);
update public.locations set work_calendar_id=pg_temp.id(501) where id=pg_temp.id(20);
alter table fixture add delivery_id uuid;
create function pg_temp.preview(day date default '2026-10-10',confirmed boolean default true) returns jsonb language sql as $$select public.delivery_scenario_preview(pg_temp.id(1),(select scenario_id from fixture),day,confirmed)$$;
create function pg_temp.save(request integer default 600,fingerprint text default null,day date default '2026-10-10',confirmed boolean default true) returns uuid language sql as $$select public.delivery_scenario_save(pg_temp.id(1),(select scenario_id from fixture),day,confirmed,pg_temp.id(request),coalesce(fingerprint,pg_temp.preview(day,confirmed)->>'fingerprint'))$$;
set local role authenticated;
select is(pg_temp.preview()->>'status','available','explicit weekly calendars resolve outside reference coverage');
select is(pg_temp.preview()->>'order_date','2026-10-12','Saturday order moves to Monday');
select is(pg_temp.preview()->>'nominal_receipt','2026-10-15','three calendar days added without business-day conversion');
select is(pg_temp.preview()->>'receipt_date','2026-10-17','Thursday receipt moves past receiving weekend');
select is(pg_temp.preview()->>'expected_receipt','2026-10-13','policy reference remains cutoff plus saved lead');
select is(pg_temp.preview()->>'elapsed_days','7','elapsed protection includes both calendar movements');
select is(pg_temp.preview()->>'policy_recalculation_required','true','delayed receipt flags recalculation');
select is((pg_temp.preview()->'source'->>'quantity')::numeric,12::numeric,'saved rounded quantity unchanged');
select is(pg_temp.preview('2026-10-10',false)->>'status','calendars_unconfirmed','calendar applicability explicit');
select throws_ok($$select pg_temp.preview('2026-10-09')$$,'MQ422',null,'date before cutoff rejected');
select throws_ok($$select pg_temp.preview('infinity')$$,'MQ422',null,'infinite date rejected');
select throws_ok($$select pg_temp.preview('2101-01-01')$$,'MQ422',null,'date bound enforced');
select throws_ok($$select pg_temp.preview(null)$$,'MQ422',null,'missing date rejected');
select throws_ok($$select pg_temp.preview('2026-10-10',null)$$,'MQ422',null,'missing confirmation rejected');
update fixture set report=pg_temp.preview(),delivery_id=pg_temp.save();
select is(pg_temp.save(),(select delivery_id from fixture),'identical retry returns same row');
select is((select count(*) from public.audit_log where table_name='delivery_scenarios' and record_id=(select delivery_id from fixture)),1::bigint,'one audit record');
select is((select receipt_date from public.delivery_scenario_list where id=(select delivery_id from fixture)),'2026-10-17','narrow history matches saved dates');
select throws_ok($$select pg_temp.save(600,null,'2026-10-11')$$,'MQ409',null,'request binds requested date');
select throws_ok($$select pg_temp.save(600,null,'2026-10-10',false)$$,'MQ409',null,'request binds confirmation');
select throws_ok($$insert into public.delivery_scenarios default values$$,'42501',null,'direct inserts forbidden');
select throws_ok($$update public.delivery_scenarios set report='{}'$$,'42501',null,'direct updates forbidden');
select throws_ok($$delete from public.delivery_scenarios$$,'42501',null,'direct deletes forbidden');
select pg_temp.login(11,1);
select is(pg_temp.preview()->>'status','available','viewer previews');
select is((select count(*) from public.delivery_scenarios),1::bigint,'viewer reads evidence');
select throws_ok($$select pg_temp.save(601)$$,'MQ403',null,'viewer cannot save');
select pg_temp.login(12,1);
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'definer preview enforces branch scope');
select is((select count(*) from public.delivery_scenario_list),0::bigint,'branch history scoped');
select pg_temp.login(13,2);
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'cross tenant preview forbidden');
select is((select count(*) from public.delivery_scenarios),0::bigint,'cross tenant evidence hidden');
select throws_ok($$select public.delivery_scenario_save(pg_temp.id(1),(select scenario_id from fixture),'2026-10-10',true,pg_temp.id(601),repeat('a',64))$$,'MQ403',null,'cross tenant writes forbidden');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'active claim narrows definer preview');
select pg_temp.login(10,1);
update public.work_calendars set weekend_days=array[7]::smallint[] where id=pg_temp.id(500);
select throws_ok($$select pg_temp.save(601,(select report->>'fingerprint' from fixture))$$,'MQ409',null,'changed weekly calendar invalidates preview');
select is(pg_temp.save(600,(select report->>'fingerprint' from fixture)),(select delivery_id from fixture),'retry returns original after calendar edits');
select is((select report from public.delivery_scenarios where id=(select delivery_id from fixture)),(select report from fixture),'saved evidence immutable');
update public.work_calendars set weekend_days=array[6,7]::smallint[],observe_public_holidays=true where id=pg_temp.id(500);
select is(pg_temp.preview()->>'status','calendar_unknown','expired coverage stays unknown');
select is(pg_temp.preview()->'order_search'->'days'->2->>'date','2026-10-12','search stops at first unknown Monday');
insert into public.holiday_overrides(id,organization_id,work_calendar_id,starts_on,ends_on,kind,name_en)
 values(pg_temp.id(700),pg_temp.id(1),pg_temp.id(500),'2026-10-13','2026-10-13','working_day','Tuesday known');
select is(pg_temp.preview()->>'status','calendar_unknown','known later date cannot skip unknown Monday');
insert into public.holiday_overrides(id,organization_id,country_code,starts_on,ends_on,kind,name_en)
 values(pg_temp.id(701),pg_temp.id(1),'SA','2026-10-10','2026-10-12','closure','Country closed');
select is(pg_temp.preview()->>'order_date','2026-10-13','explicit country closure resolves earlier unknown');
update public.holiday_overrides set starts_on='2026-10-10',ends_on='2026-10-10' where id=pg_temp.id(700);
select is(pg_temp.preview()->>'order_date','2026-10-10','calendar working override wins country closure and weekend');
select is(pg_temp.preview()->'order_search'->'days'->0->>'reason','calendar_override','precedence evidence inspectable');
update public.work_calendars set is_active=false where id=pg_temp.id(500);
select is(pg_temp.preview()->>'status','calendar_inactive','inactive calendar cannot use overrides');
update public.work_calendars set is_active=true,observe_public_holidays=false where id=pg_temp.id(500);
delete from public.holiday_overrides where organization_id=pg_temp.id(1);
update public.work_calendars set observe_public_holidays=true where id=pg_temp.id(501);
select is(pg_temp.preview()->>'blocked_stage','receiver','receiving unknown identified separately');
update public.work_calendars set observe_public_holidays=false where id=pg_temp.id(501);
update public.suppliers set country_code='DE',work_calendar_id=null where id=pg_temp.id(110);
select is(pg_temp.preview()->>'status','calendar_unknown','foreign supplier without defaults is unknown, not an error');
update public.suppliers set work_calendar_id=pg_temp.id(500) where id=pg_temp.id(110);
select is(pg_temp.preview()->>'status','available','explicit calendar resolves foreign supplier');
update public.suppliers set is_active=false where id=pg_temp.id(110);
select is(pg_temp.preview()->>'status','supplier_unavailable','inactive supplier diagnosed');
update public.suppliers set is_active=true where id=pg_temp.id(110);
update public.locations set is_active=false where id=pg_temp.id(20);
select is(pg_temp.preview()->>'status','location_unavailable','inactive receiver diagnosed');
update public.locations set is_active=true where id=pg_temp.id(20);
-- Save diagnoses too, then keep the source and policy quantities untouched.
select lives_ok($$select pg_temp.save(602,null,'2026-10-10',false)$$,'unavailable diagnosis can be saved');
select is((select (report->>'quantity')::numeric from public.supplier_scenarios where id=(select scenario_id from fixture)),12::numeric,'source rounded quantity never mutated');
reset role;
-- Private helper boundaries use deterministic captured evidence independent of regional seeds.
create temporary table calendars(c jsonb);
insert into calendars values('{"active":true,"weekend_days":[],"observe_public_holidays":true,"coverage_from":"2026-01-01","coverage_to":"2026-12-31","holidays":[{"date":"2026-10-10","sector":"all"},{"date":"2026-10-11","sector":"banks"}],"overrides":[]}');
select is(app.delivery_calendar_day(c,'2026-10-10')->>'reason','public_holiday','verified all-sector holiday closes') from calendars;
select is(app.delivery_calendar_day(c,'2026-10-11')->>'working','true','sector-specific holiday does not close general calendar') from calendars;
update calendars set c=jsonb_set(c,'{overrides}','[{"id":"98000000-0000-4000-8000-000000000700","calendar_id":null,"starts_on":"2026-10-10","ends_on":"2027-01-06","kind":"closure"}]');
select is(app.delivery_next_working_day(c,'2026-10-10')->>'date','2027-01-07','90th search date is considered when weekly calendar ignores holidays') from (select jsonb_set(c,'{observe_public_holidays}','false') c from calendars) q;
update calendars set c=jsonb_set(c,'{overrides,0,ends_on}','"2027-01-07"');
select is(app.delivery_next_working_day(c,'2026-10-10')->>'status','search_exhausted','90 known closed dates exhaust bounded search') from calendars;
select is(jsonb_array_length(app.delivery_next_working_day(c,'2026-10-10')->'days'),90,'search evidence capped at 90') from calendars;
update public.supplier_scenarios set report=jsonb_set(jsonb_set(report,'{quantity}','"0"'),'{source,lead_time}','0') where id=(select scenario_id from fixture);
set local role authenticated;
select is(pg_temp.preview('2026-10-10',false)->>'status','no_order_needed','zero quantity needs neither order nor confirmation');
select is(pg_temp.preview()->>'receipt_date',null,'zero quantity has no delivery date');
reset role;
update public.supplier_scenarios set report=jsonb_set(report,'{quantity}','"12"') where id=(select scenario_id from fixture);
update public.work_calendars set weekend_days='{}' where organization_id=pg_temp.id(1);
set local role authenticated;
select is(pg_temp.preview()->>'receipt_date','2026-10-10','zero calendar lead resolves same-day when both open');
select is(pg_temp.preview()->>'policy_recalculation_required','false','same-day arrival meets original lead');
reset role;
update public.supplier_scenarios set report=jsonb_set(report,'{status}','"unit_unknown"') where id=(select scenario_id from fixture);
set local role authenticated;
select is(pg_temp.preview()->>'status','source_unavailable','unavailable source cannot schedule');
reset role;
select * from finish();
rollback;
