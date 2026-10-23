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
insert into saved_dates(id,report) select pg_temp.save(),pg_temp.preview();
reset role;
update public.network_links set freight_basis='per_unit',freight_cost=1.234,currency='SAR',freight_unit='EA',freight_valid_from='2026-10-11' where id=pg_temp.id(90);
create function pg_temp.fp(confirmed boolean default true) returns jsonb language sql as $$select public.transfer_freight_preview(pg_temp.id(1),(select id from saved_dates),confirmed)$$;
create function pg_temp.fs(request integer default 900,fingerprint text default null,confirmed boolean default true) returns uuid language sql as $$select public.transfer_freight_save(pg_temp.id(1),(select id from saved_dates),confirmed,pg_temp.id(request),coalesce(fingerprint,pg_temp.fp(confirmed)->>'fingerprint'))$$;
create temporary table saved_freight(id uuid,report jsonb);
grant all on saved_freight to authenticated;
set local role authenticated;
select is(pg_temp.fp()->>'status','available','priced lane available at adjusted dispatch');
select is((pg_temp.fp()->>'exact_product')::numeric,10.7975::numeric,'fractional quantity times three-decimal rate is exact');
select is((pg_temp.fp()->>'subtotal')::numeric,10.80::numeric,'SAR rounds once to two digits');
select is(pg_temp.fp()->'source'->'receipts'->'p90'->>'timing_review_required','true','timing warning retained');
select is(pg_temp.fp()->'source'->'source'->'destination'->'orders'->0->>'overdue','true','inbound concern retained');
select is(pg_temp.fp(false)->>'status','terms_unconfirmed','explicit terms confirmation');
select throws_ok($$select pg_temp.fs(901,null,false)$$,'MQ422',null,'unconfirmed cannot save');
select throws_ok($$select pg_temp.fp(null)$$,'MQ422',null,'null confirmation rejected');
insert into saved_freight select pg_temp.fs(),pg_temp.fp();
select is(pg_temp.fs(),(select id from saved_freight),'identical retry stable');
select is((select report from public.transfer_freight_estimates where id=(select id from saved_freight)),(select report from saved_freight),'exact immutable report retained');
select throws_ok($$select pg_temp.fs(900,null,false)$$,'MQ409',null,'changed confirmation conflicts');
select throws_ok($$update public.transfer_freight_estimates set report='{}'$$,'42501',null,'direct update denied');
select throws_ok($$delete from public.transfer_freight_estimates$$,'42501',null,'direct delete denied');
select throws_ok($$insert into public.transfer_freight_estimates default values$$,'42501',null,'direct insert denied');
select pg_temp.login(11);
select is(pg_temp.fp()->>'status','available','viewer previews');
select is((select count(*) from public.transfer_freight_list),1::bigint,'viewer reads saved history');
select throws_ok($$select pg_temp.fs(901)$$,'MQ403',null,'viewer cannot save');
select pg_temp.login(16);
select throws_ok($$select pg_temp.fs(901)$$,'MQ403',null,'approver cannot save');
select pg_temp.login(15);
select throws_ok($$select pg_temp.fs()$$,'MQ409',null,'retry author bound');
select pg_temp.login(12);
select throws_ok($$select pg_temp.fp()$$,'MQ404',null,'destination-only branch denied preview');
select is((select count(*) from public.transfer_freight_list),0::bigint,'destination-only history hidden');
reset role;
update public.membership_locations set location_id=pg_temp.id(21) where user_id=pg_temp.id(12);
set local role authenticated;
select throws_ok($$select pg_temp.fp()$$,'MQ404',null,'source-only branch denied preview');
select is((select count(*) from public.transfer_freight_estimates),0::bigint,'source-only history hidden');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
set local role authenticated;
select is(pg_temp.fp()->>'status','available','both endpoints allow branch preview');
select is((select count(*) from public.transfer_freight_list),1::bigint,'both endpoints allow history');
select pg_temp.login(13,2);
select throws_ok($$select pg_temp.fp()$$,'MQ404',null,'cross-tenant preview denied');
select is((select count(*) from public.transfer_freight_list),0::bigint,'cross-tenant list hidden');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.fp()$$,'MQ404',null,'active organization claim narrows preview');
select is((select count(*) from public.transfer_freight_list),0::bigint,'active claim narrows list');
select pg_temp.login(10);
reset role;
select is((select count(*) from public.audit_log where table_name='transfer_freight_estimates' and organization_id=pg_temp.id(1)),1::bigint,'one audit on retry');
update public.network_links set currency='KWD' where id=pg_temp.id(90);
select is((pg_temp.fp()->>'subtotal')::numeric,10.798::numeric,'three-decimal currency rounds once');
select throws_ok($$select pg_temp.fs(901,(select report->>'fingerprint' from saved_freight))$$,'MQ409',null,'changed price requires fresh preview');
select is(pg_temp.fs(900,(select report->>'fingerprint' from saved_freight)),(select id from saved_freight),'retry retains original price after edits');
update public.network_links set freight_basis='per_shipment',freight_unit=null,freight_cost=3.085,currency='SAR' where id=pg_temp.id(90);
select is((pg_temp.fp()->>'subtotal')::numeric,3.09::numeric,'one shipment fee, positive half-up tie');
select is(pg_temp.fp()->>'shipment_count','1','shipment assumption explicit');
select is(pg_temp.fp()->>'status','available','per-shipment rate needs no quantity unit');
update public.network_links set freight_cost=0 where id=pg_temp.id(90);
select is((pg_temp.fp()->>'subtotal')::numeric,0::numeric,'explicit zero rate allowed');
select is(pg_temp.fp(false)->>'status','terms_unconfirmed','zero rate still requires confirmation');
update public.network_links set freight_basis='none',freight_cost=null,currency=null where id=pg_temp.id(90);
select is(pg_temp.fp()->>'status','freight_unconfigured','unconfigured is unknown, not free');
update public.network_links set freight_basis='per_unit',freight_cost=1.234,currency='SAR' where id=pg_temp.id(90);
select is(pg_temp.fp()->>'status','unit_unknown','missing unit never inferred from catalog');
update public.network_links set freight_unit='KG' where id=pg_temp.id(90);
select is(pg_temp.fp()->>'status','unit_mismatch','different unit unavailable');
update public.network_links set freight_unit='EA',freight_valid_from=null where id=pg_temp.id(90);
select is(pg_temp.fp()->>'status','rate_date_unknown','missing effective date unknown');
update public.network_links set freight_valid_from='2026-10-12' where id=pg_temp.id(90);
select is(pg_temp.fp()->>'status','rate_not_effective','date after adjusted dispatch rejected');
update public.network_links set freight_valid_from='2026-10-11',freight_cost='NaN' where id=pg_temp.id(90);
select is(pg_temp.fp()->>'status','rate_invalid','nonfinite rate blocked');
update public.network_links set freight_cost=999999999999999.999 where id=pg_temp.id(90);
select is(pg_temp.fp()->>'status','amount_out_of_range','large exact product cannot overflow supported total');
select is(pg_temp.fp()->>'subtotal',null,'overflow never displays a total');
update public.network_links set freight_cost=1.234,lead_time_days_p90=5 where id=pg_temp.id(90);
select is(pg_temp.fp()->>'status','lane_changed','changed lead never changes saved dates');
update public.network_links set lead_time_days_p90=4,is_active=false where id=pg_temp.id(90);
select is(pg_temp.fp()->>'status','lane_unavailable','inactive lane unavailable');
update public.network_links set is_active=true where id=pg_temp.id(90);
update public.locations set is_active=false where id=pg_temp.id(21);
select is(pg_temp.fp()->>'status','source_location_unavailable','inactive source unavailable');
update public.locations set is_active=true where id=pg_temp.id(21);
update public.locations set is_active=false where id=pg_temp.id(20);
select is(pg_temp.fp()->>'status','destination_location_unavailable','inactive receiver unavailable');
update public.locations set is_active=true where id=pg_temp.id(20);
update public.work_calendars set is_active=false where organization_id=pg_temp.id(1);
select is(pg_temp.fp()->>'status','available','current calendar edit does not recalculate saved dates');
select is(pg_temp.fp()->'source'->'dispatch'->>'date','2026-10-11','saved dispatch fixed');
select is((select report from public.transfer_freight_estimates where id=(select id from saved_freight)),(select report from saved_freight),'saved estimate unchanged by later inputs');
update public.network_links set from_location_id=pg_temp.id(20),to_location_id=pg_temp.id(21) where id=pg_temp.id(90);
select is(pg_temp.fp()->>'status','lane_unavailable','reversed lane not substituted');
delete from public.network_links where id=pg_temp.id(90);
select is(pg_temp.fp()->>'status','lane_unavailable','deleted lane unavailable');
select is(pg_temp.fs(900,(select report->>'fingerprint' from saved_freight)),(select id from saved_freight),'saved retry survives deleted lane');
update public.transfer_date_scenarios set report=jsonb_set(jsonb_set(report,'{status}','"no_transfer_needed"'),'{source,quantity}','"0"') where id=(select id from saved_dates);
select is(pg_temp.fp(false)->>'status','no_transfer_needed','zero needs neither rate nor confirmation');
select is(pg_temp.fp(false)->>'subtotal',null,'zero transfer does not invent a currency subtotal');
select lives_ok($$select pg_temp.fs(901,null,false)$$,'no-transfer result can be saved');
select is((select sum(quantity) from public.open_orders where organization_id=pg_temp.id(1)),1001::numeric,'no inbound created');
select is((select count(*) from public.receipts where organization_id=pg_temp.id(1)),0::bigint,'no receipt created');
set local role anon;
select throws_ok($$select pg_temp.fp()$$,'42501',null,'anonymous cannot preview');
set local role service_role;
select throws_ok($$select pg_temp.fp()$$,'42501',null,'API cannot preview estimates');
reset role;
select ok(not has_function_privilege('zeespare_worker','public.transfer_freight_save(uuid,uuid,boolean,uuid,text)','EXECUTE'),'worker capability unchanged');
insert into public.api_keys(organization_id,name,display_prefix,last4,key_hash,scopes,created_by,expires_at)
values(pg_temp.id(1),'Freight','zeespare_sk_abcd','abcd',decode(repeat('ae',32),'hex'),array['master_data:read','master_data:write'],pg_temp.id(10),now()+interval '1 day');
create function pg_temp.upsert(record jsonb) returns jsonb language sql as $$select public.api_upsert(decode(repeat('ae',32),'hex'),'network_links',jsonb_build_object('records',jsonb_build_array(record)),gen_random_uuid())$$;
select set_config('request.jwt.claims','{}',true);
set local role service_role;
select is(pg_temp.upsert('{"from_location_code":"L1","to_location_code":"L0","lead_time_days_p50":2,"lead_time_days_p90":4,"freight_basis":"per_unit","freight_cost":"1.234","currency":"SAR","freight_unit":"EA","freight_valid_from":"2026-10-11"}')->>'result','succeeded','API creates rate provenance through import merge');
select is((public.api_list(decode(repeat('ae',32),'hex'),'network_links')->'data'->0->>'freight_unit'),'EA','API returns supplied unit');
select is((public.api_list(decode(repeat('ae',32),'hex'),'network_links')->'data'->0->>'freight_valid_from'),'2026-10-11','API returns effective date');
select is(pg_temp.upsert('{"from_location_code":"L1","to_location_code":"L0","is_active":false}')->>'result','succeeded','unrelated update accepted');
reset role;
select is((select freight_unit from public.network_links where organization_id=pg_temp.id(1)),'EA','unrelated update preserves unit');
select is((select freight_valid_from from public.network_links where organization_id=pg_temp.id(1)),date '2026-10-11','unrelated update preserves date');
set local role service_role;
select is(pg_temp.upsert('{"from_location_code":"L1","to_location_code":"L0","freight_basis":"per_unit","freight_cost":"2","currency":"SAR"}')->>'result','succeeded','legacy rate replacement accepted');
reset role;
select is((select freight_unit from public.network_links where organization_id=pg_temp.id(1)),null,'legacy rate replacement clears unit');
select is((select freight_valid_from from public.network_links where organization_id=pg_temp.id(1)),null,'legacy rate replacement clears date');
set local role service_role;
select is(pg_temp.upsert('{"from_location_code":"L1","to_location_code":"L0","freight_unit":"EA","freight_valid_from":"2026-10-01"}')->>'result','succeeded','explicit evidence-only update accepted');
select is(pg_temp.upsert('{"from_location_code":"L1","to_location_code":"L0","freight_unit":"BOX"}')->>'result','invalid','unsupported unit refused');
select is(pg_temp.upsert('{"from_location_code":"L1","to_location_code":"L0","freight_valid_from":"infinity"}')->>'result','invalid','nonfinite date refused');
select is(pg_temp.upsert('{"from_location_code":"L1","to_location_code":"L0","freight_unit":null,"freight_valid_from":null}')->>'result','succeeded','explicit unknown evidence accepted');
reset role;
select is((select freight_unit from public.network_links where organization_id=pg_temp.id(1)),null,'explicit null persists');
select ok(not has_function_privilege('authenticated','app.import_rows_network_links_freight(uuid,uuid,smallint,integer,integer)','EXECUTE'),'new staging reader private');
select * from finish();
rollback;
