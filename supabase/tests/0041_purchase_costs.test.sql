begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('97000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
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

set local role authenticated;
update fixture set delivery_id=public.delivery_scenario_save(pg_temp.id(1),scenario_id,'2026-10-10',true,pg_temp.id(600),
 public.delivery_scenario_preview(pg_temp.id(1),scenario_id,'2026-10-10',true)->>'fingerprint');
reset role;
alter table fixture add estimate_id uuid;
create function pg_temp.preview(confirmed boolean default true) returns jsonb language sql as $$select public.purchase_cost_preview(pg_temp.id(1),(select delivery_id from fixture),confirmed)$$;
create function pg_temp.save(request integer default 800,fingerprint text default null,confirmed boolean default true) returns uuid language sql as $$select public.purchase_cost_save(pg_temp.id(1),(select delivery_id from fixture),confirmed,pg_temp.id(request),coalesce(fingerprint,pg_temp.preview(confirmed)->>'fingerprint'))$$;
set local role authenticated;
select is(pg_temp.preview()->>'status','price_date_unknown','legacy price without date is unavailable');
update public.supplier_items set valid_from='2026-10-11',unit_price=1.005 where id=pg_temp.id(130);
select is(pg_temp.preview(false)->>'status','price_unconfirmed','price applicability requires confirmation');
select is(pg_temp.preview()->>'status','available','effective after cutoff but before adjusted order date is allowed');
select is(pg_temp.preview()->'source'->>'order_date','2026-10-12','uses saved adjusted order date');
select is(pg_temp.preview()->'source'->>'receipt_date','2026-10-17','saved receipt retained');
select is(pg_temp.preview()->'source'->>'policy_recalculation_required','true','recalculation warning retained');
select is((pg_temp.preview()->>'exact_product')::numeric,12.06::numeric,'does not round unit price before multiplication');
select is(pg_temp.preview()->>'subtotal','12.06','SAR subtotal uses two decimals');
select is(pg_temp.preview()->'price'->>'unit','EA','source supplied unit not catalog SET');
select throws_ok($$select pg_temp.preview(null)$$,'MQ422',null,'null confirmation rejected');
update fixture set report=pg_temp.preview(),estimate_id=pg_temp.save();
select is(pg_temp.save(),(select estimate_id from fixture),'identical request returns same estimate');
select is((select count(*) from public.audit_log where table_name='purchase_cost_estimates' and record_id=(select estimate_id from fixture)),1::bigint,'single audit insertion');
select is((select subtotal from public.purchase_cost_list where id=(select estimate_id from fixture)),'12.06','history reads saved subtotal');
select throws_ok($$select pg_temp.save(800,null,false)$$,'MQ409',null,'retry binds confirmation');
select throws_ok($$select pg_temp.save(800,repeat('b',64))$$,'MQ409',null,'retry binds fingerprint');
select throws_ok($$select public.purchase_cost_save(pg_temp.id(1),pg_temp.id(999),true,pg_temp.id(800),(select report->>'fingerprint' from fixture))$$,'MQ409',null,'retry binds delivery identity');
select throws_ok($$select pg_temp.save(801,'bad')$$,'MQ422',null,'fingerprint shape checked');
select throws_ok($$select public.purchase_cost_save(pg_temp.id(1),(select delivery_id from fixture),true,null,repeat('a',64))$$,'MQ422',null,'request identity required');
select throws_ok($$insert into public.purchase_cost_estimates(organization_id,delivery_id,location_id,request_id,submitted_by,report) values(pg_temp.id(1),(select delivery_id from fixture),pg_temp.id(20),pg_temp.id(999),pg_temp.id(10),'{}')$$,'42501',null,'direct insert denied');
select throws_ok($$update public.purchase_cost_estimates set report='{}'$$,'42501',null,'direct update denied');
select throws_ok($$delete from public.purchase_cost_estimates$$,'42501',null,'direct delete denied');
update public.supplier_items set unit_price=2 where id=pg_temp.id(130);
select throws_ok($$select pg_temp.save(801,(select report->>'fingerprint' from fixture))$$,'MQ409',null,'changed price invalidates preview');
select is(pg_temp.save(800,(select report->>'fingerprint' from fixture)),(select estimate_id from fixture),'retry preserves original after price change');
select is((select report from public.purchase_cost_estimates where id=(select estimate_id from fixture)),(select report from fixture),'saved evidence immutable');
update public.supplier_items set valid_from='2026-10-13' where id=pg_temp.id(130);
select is(pg_temp.preview()->>'status','price_not_effective','future price unavailable');
update public.supplier_items set valid_from='infinity' where id=pg_temp.id(130);
select is(pg_temp.preview()->>'status','price_date_unknown','infinite effective date unavailable');
update public.supplier_items set valid_from='-infinity' where id=pg_temp.id(130);
select is(pg_temp.preview()->>'status','price_date_unknown','negative infinite effective date unavailable');
update public.supplier_items set valid_from='2026-10-12',unit_of_measure=null where id=pg_temp.id(130);
select is(pg_temp.preview()->>'status','unit_unknown','missing price unit is not inferred');
update public.supplier_items set unit_of_measure='SET' where id=pg_temp.id(130);
select is(pg_temp.preview()->>'status','unit_mismatch','incompatible price unit unavailable');
update public.supplier_items set unit_of_measure='EA',unit_price='NaN' where id=pg_temp.id(130);
select is(pg_temp.preview()->>'status','price_invalid','numeric NaN diagnosed');
select is(pg_temp.preview()->'price'->>'unit_price',null,'NaN not exposed as a decimal');
update public.supplier_items set unit_price=0 where id=pg_temp.id(130);
select is(pg_temp.preview(false)->>'status','price_unconfirmed','zero price still needs confirmation');
select is(pg_temp.preview()->>'subtotal','0.00','explicit supplied zero price supported');
update public.suppliers set is_active=false where id=pg_temp.id(110);
select is(pg_temp.preview()->>'status','supplier_unavailable','inactive supplier blocks priced estimate');
update public.suppliers set is_active=true where id=pg_temp.id(110);
select lives_ok($$select pg_temp.save(802,null,false)$$,'unavailable diagnosis can be saved');
reset role;
-- Privileged fixture changes exercise decimal boundaries independently of upstream rounding.
update public.delivery_scenarios set report=jsonb_set(report,'{source,quantity}','"2.500"') where id=(select delivery_id from fixture);
update public.supplier_items set unit_price=1.234 where id=pg_temp.id(130);
set local role authenticated;
select is(pg_temp.preview()->>'exact_product','3.085000','fractional quantity product kept exact');
select is(pg_temp.preview()->>'subtotal','3.09','half-cent tie rounds up once');
update public.supplier_items set currency='KWD' where id=pg_temp.id(130);
select is(pg_temp.preview()->>'subtotal','3.085','three-decimal currency retains mills');
update fixture set report=pg_temp.preview();
reset role;
update public.currencies set minor_units=0 where code='KWD';
set local role authenticated;
select throws_ok($$select pg_temp.save(803,(select report->>'fingerprint' from fixture))$$,'MQ409',null,'currency precision change invalidates preview');
select is(pg_temp.preview()->>'subtotal','3','zero-decimal currency precision comes from reference data');
reset role;
update public.currencies set minor_units=3 where code='KWD';
update public.delivery_scenarios set report=jsonb_set(report,'{source,quantity}','"0.005"') where id=(select delivery_id from fixture);
update public.supplier_items set unit_price=1,currency='SAR' where id=pg_temp.id(130);
set local role authenticated;
select is(pg_temp.preview()->>'subtotal','0.01','small half-up tie');
reset role;
update public.delivery_scenarios set report=jsonb_set(report,'{source,quantity}','"999999999999999.999"') where id=(select delivery_id from fixture);
update public.supplier_items set currency='KWD' where id=pg_temp.id(130);
set local role authenticated;
select is(pg_temp.preview()->>'subtotal','999999999999999.999','full numeric18,3 precision retained');
update public.supplier_items set currency='SAR' where id=pg_temp.id(130);
select is(pg_temp.preview()->>'status','amount_out_of_range','rounding across maximum is unavailable');
select is(pg_temp.preview()->>'subtotal',null,'overflow has no misleading subtotal');
update public.supplier_items set unit_price=999999999999999.999 where id=pg_temp.id(130);
select is(pg_temp.preview()->>'status','amount_out_of_range','large product diagnosed without numeric exception');
reset role;
update public.delivery_scenarios set report=jsonb_set(report,'{source,quantity}','"12"') where id=(select delivery_id from fixture);
update public.supplier_items set unit_price=1,currency='SAR' where id=pg_temp.id(130);
-- No replacement row may silently inherit the saved terms identity.
delete from public.supplier_items where id=pg_temp.id(130);
insert into public.supplier_items(id,organization_id,supplier_id,item_id,lead_time_days,min_order_quantity,pack_size,unit_price,currency,unit_of_measure,valid_from)
 values(pg_temp.id(131),pg_temp.id(1),pg_temp.id(110),pg_temp.id(100),3,10,6,1,'SAR','EA','2026-10-10');
set local role authenticated;
select is(pg_temp.preview()->>'status','terms_missing','same pair recreated with new identity is unavailable');
reset role;
update public.delivery_scenarios set report=jsonb_set(report,'{status}','"calendar_unknown"') where id=(select delivery_id from fixture);
set local role authenticated;
select is(pg_temp.preview()->>'status','source_unavailable','unavailable delivery blocks costing');
reset role;
update public.delivery_scenarios set report=jsonb_set(jsonb_set(jsonb_set(report,'{source,quantity}','"0"'),'{status}','"no_order_needed"'),'{order_date}','null') where id=(select delivery_id from fixture);
update public.suppliers set is_active=false where id=pg_temp.id(110);
set local role authenticated;
select is(pg_temp.preview(false)->>'status','no_order_needed','zero needs no price, terms, active supplier or confirmation');
select is(pg_temp.preview()->>'subtotal',null,'no order does not invent a priced subtotal');
-- Scope tests read existing saved immutable estimates.
select pg_temp.login(11,1);
select is((select count(*) from public.purchase_cost_estimates),2::bigint,'viewer can inspect saved estimates');
select lives_ok($$select pg_temp.preview()$$,'viewer may preview');
select throws_ok($$select pg_temp.save(804)$$,'MQ403',null,'viewer cannot save');
select pg_temp.login(12,1);
select is((select count(*) from public.purchase_cost_estimates),0::bigint,'branch scope hides saved report');
select is((select count(*) from public.purchase_cost_list),0::bigint,'branch scope hides narrow view');
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'out-of-branch preview denied');
reset role;
update public.memberships set role='planner' where user_id=pg_temp.id(12);
set local role authenticated;
select throws_ok($$select pg_temp.save(800,(select report->>'fingerprint' from public.purchase_cost_estimates limit 1))$$,'MQ409',null,'request cannot be replayed by another author');
select pg_temp.login(13,2);
select is((select count(*) from public.purchase_cost_estimates),0::bigint,'other tenant cannot read estimates');
select is((select count(*) from public.purchase_cost_list),0::bigint,'other tenant cannot read history');
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'other tenant preview denied');
select throws_ok($$select pg_temp.save(804,repeat('a',64))$$,'MQ403',null,'other tenant save denied');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'active claim narrows membership');
select throws_ok($$select pg_temp.save(804,repeat('a',64))$$,'MQ403',null,'active claim narrows editor rights');
reset role;
select * from finish();
rollback;
