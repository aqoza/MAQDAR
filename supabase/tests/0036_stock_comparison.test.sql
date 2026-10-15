begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('96000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
create function pg_temp.compare(day date default '2026-10-10',basis text default 'calculated',override_id uuid default null) returns jsonb language sql as $$select public.policy_stock_comparison(pg_temp.id(1),pg_temp.id(50),day,basis,override_id)$$;
insert into auth.users(id,email) select pg_temp.id(n),'stock-'||n||'@test.local' from generate_series(10,13) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'stock-a','Stock A'),(pg_temp.id(2),'stock-b','Stock B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),
 (pg_temp.id(1),pg_temp.id(12),'branch_user'),(pg_temp.id(2),pg_temp.id(13),'owner');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone)
 select pg_temp.id(20+n),pg_temp.id(case when n=2 then 2 else 1 end),'L'||n,'Location','branch','SA','Asia/Riyadh' from generate_series(0,2) n;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
 values(pg_temp.id(100),pg_temp.id(1),'ITEM','Item','Test','SET',99,'SAR');
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(20),'2026-10-03',12,2,1.125,'KWD','EA'),
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(20),'2026-10-11',999,0,1,'SAR','EA');
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 select pg_temp.id(30+n),pg_temp.id(case when n=2 then 2 else 1 end),pg_temp.id(20+n),pg_temp.id(40+n),
 '2026-01-01','2026-10-10','policy','succeeded','{}',now(),'{}' from generate_series(0,2) n;
insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
 select pg_temp.id(50+n),pg_temp.id(case when n=2 then 2 else 1 end),pg_temp.id(30+n),pg_temp.id(20+n),pg_temp.id(200+n),pg_temp.id(100),'SAVED','EA','available',
 '{"protection":{"target":"7.000"}}',
 '{"forecast":{"to_date":"2026-10-10","method":"baseline-v1","source":{"unit_provenance":{"method":"source-units-v1","status":"consistent","unit":"EA","rows":1,"unknown_rows":0,"units":["EA"]}}}}' from generate_series(0,2) n;
insert into public.policy_overrides(id,organization_id,policy_id,location_id,revision,request_id,submitted_by,reorder_point,order_up_to,reason,status,decided_by,decided_at,decision_reason,decision_request_id)
 select pg_temp.id(60+n),pg_temp.id(1),pg_temp.id(50),pg_temp.id(20),n,pg_temp.id(70+n),pg_temp.id(10),1,7+n,'Scenario',
 'approved',pg_temp.id(11),now(),'Approved scenario',pg_temp.id(80+n) from generate_series(1,2) n;
set local role authenticated;
select pg_temp.login(11,1);
select is(pg_temp.compare()->>'status','available','known units accepted independently of live catalog');
select is(pg_temp.compare()->>'quantity_above','3.000','hand-calculated excess; future snapshot excluded');
select is(pg_temp.compare()->>'value_above','3.375000','exact KWD value from supplied snapshot cost');
select is(pg_temp.compare()->'snapshot'->>'age','7','exactly seven days is accepted');
select is(pg_temp.compare()->'snapshot'->>'currency','KWD','snapshot currency, not catalog currency');
select is(pg_temp.compare('2026-10-09')->>'status','date_mismatch','cutoff must match');
select is(pg_temp.compare('2026-10-10','approved',pg_temp.id(61))->>'quantity_above','2.000','chosen approved revision, not newer revision');
select is(pg_temp.compare('2026-10-10','approved',pg_temp.id(62))->>'quantity_above','1.000','different explicit revision');
select throws_ok($$select pg_temp.compare('2026-10-10','approved',pg_temp.id(999))$$,'MQ404',null,'unknown revision rejected');
select throws_ok($$select public.policy_stock_comparison(pg_temp.id(1),pg_temp.id(51),'2026-10-10','approved',pg_temp.id(61))$$,'MQ404',null,'approved revision must belong to selected policy');
select throws_ok($$select public.policy_stock_comparison(pg_temp.id(1),pg_temp.id(52),'2026-10-10','calculated')$$,'MQ404',null,'foreign policy identifier cannot be smuggled into tenant request');
select throws_ok($$select pg_temp.compare('2026-10-10','calculated',pg_temp.id(61))$$,'MQ422',null,'contradictory basis rejected');
select throws_ok($$select pg_temp.compare(null)$$,'MQ422',null,'null date rejected');
select throws_ok($$select pg_temp.compare('infinity')$$,'MQ422',null,'infinite date rejected');
select pg_temp.login(12,1);
select throws_ok($$select pg_temp.compare()$$,'MQ404',null,'branch cannot compare another location');
select pg_temp.login(13,2);
select throws_ok($$select pg_temp.compare()$$,'MQ404',null,'foreign organization denied');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.compare()$$,'MQ404',null,'stale active claim denied');
reset role;
select pg_temp.login(10,1);
delete from public.stock_snapshots where organization_id=pg_temp.id(1) and snapshot_date='2026-10-03';
select is(pg_temp.compare()->>'status','stock_missing','future-only stock is missing at cutoff');
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
 values(pg_temp.id(1),pg_temp.id(100),pg_temp.id(20),'2026-10-03',12,2,1.125,'KWD','EA');
insert into public.policy_overrides(id,organization_id,policy_id,location_id,revision,request_id,submitted_by,reorder_point,order_up_to,reason)
 values(pg_temp.id(63),pg_temp.id(1),pg_temp.id(50),pg_temp.id(20),3,pg_temp.id(73),pg_temp.id(10),1,10,'Pending scenario');
select throws_ok($$select pg_temp.compare('2026-10-10','approved',pg_temp.id(63))$$,'MQ404',null,'pending threshold cannot be compared');
update public.stock_snapshots set snapshot_date='2026-10-02' where snapshot_date='2026-10-03' and organization_id=pg_temp.id(1);
select is(pg_temp.compare()->>'status','stock_stale','eight days is unavailable');
select is(pg_temp.compare()->>'quantity_above',null,'unavailable is not zero');
update public.stock_snapshots set snapshot_date='2026-10-10',unit_of_measure=null where snapshot_date='2026-10-02' and organization_id=pg_temp.id(1);
select is(pg_temp.compare()->>'status','stock_unit_unknown','unlabelled stock unavailable');
update public.stock_snapshots set unit_of_measure='SET' where organization_id=pg_temp.id(1);
select is(pg_temp.compare()->>'status','unit_mismatch','different units never converted implicitly');
update public.stock_snapshots set unit_of_measure='EA',quantity=1,allocated_quantity=2 where organization_id=pg_temp.id(1);
select is(pg_temp.compare()->>'quantity_above','0','overallocated stock is a valid zero comparison');
update public.stock_snapshots set quantity=123456789012.123,allocated_quantity=2,unit_cost=1.125 where organization_id=pg_temp.id(1);
select is(pg_temp.compare()->>'value_above','138888887628.513375','valuation preserves precision beyond a binary Number');
update public.inventory_policies set evidence=jsonb_set(evidence,'{forecast,method}','"regional-v1"') where id=pg_temp.id(50);
select is(pg_temp.compare()->>'status','prepared_group','prepared groups excluded');
update public.inventory_policies set evidence=jsonb_set(evidence,'{forecast,method}','"baseline-v1"') #- '{forecast,source,unit_provenance}' where id=pg_temp.id(50);
select is(pg_temp.compare()->>'status','policy_unit_unknown','legacy policies never infer provenance from a label');
update public.inventory_policies set status='calibration_failed',summary='{}' where id=pg_temp.id(50);
select is(pg_temp.compare()->>'status','policy_unavailable','unavailable policy diagnostic');
select ok((select not prosecdef from pg_proc where oid='public.policy_stock_comparison(uuid,uuid,date,text,uuid)'::regprocedure),'invoker RLS retained');
select ok(not has_function_privilege('anon','public.policy_stock_comparison(uuid,uuid,date,text,uuid)','EXECUTE'),'anonymous comparison denied');
select ok(not has_function_privilege('service_role','public.policy_stock_comparison(uuid,uuid,date,text,uuid)','EXECUTE'),'service API cannot call comparison');

-- Imports/API use the same merge path; omission on quantity replacement clears provenance.
select set_config('request.jwt.claims','{}',true);
insert into public.api_keys(organization_id,name,display_prefix,last4,key_hash,scopes,created_by,expires_at) values
 (pg_temp.id(1),'Units','maqdar_sk_abcd','abcd',decode(repeat('ab',32),'hex'),array['transactions:read','transactions:write'],pg_temp.id(10),now()+interval '1 day');
create function pg_temp.upsert(entity text, record jsonb) returns jsonb language sql as $$select public.api_upsert(decode(repeat('ab',32),'hex'),entity,jsonb_build_object('records',jsonb_build_array(record)),gen_random_uuid())$$;
set local role service_role;
select is(pg_temp.upsert('demand_history','{"item_code":"ITEM","location_code":"L0","demand_date":"2026-10-01","quantity":"5","unit_of_measure":"EA"}')->>'result','succeeded','demand unit import succeeds');
select is(public.api_list_demand(decode(repeat('ab',32),'hex'),'2026-10-01','2026-10-01')->'data'->0->>'unit_of_measure','EA','API demand unit round-trip');
select is(pg_temp.upsert('demand_history','{"item_code":"ITEM","location_code":"L0","demand_date":"2026-10-01","quantity":"5","unit_of_measure":"EA"}')->>'recorded','false','explicit unit replay is unchanged');
select is(pg_temp.upsert('demand_history','{"item_code":"ITEM","location_code":"L0","demand_date":"2026-10-01","quantity":"5"}')->>'result','succeeded','legacy quantity replacement accepted');
select is(public.api_list_demand(decode(repeat('ab',32),'hex'),'2026-10-01','2026-10-01')->'data'->0->>'unit_of_measure',null,'legacy replacement clears demand unit');
select is(pg_temp.upsert('demand_history','{"item_code":"ITEM","location_code":"L0","demand_date":"2026-10-01","quantity":"5","lost_sales_quantity":"0","unit_of_measure":null}')->>'recorded','false','unknown unit round-trip is unchanged');
select is(pg_temp.upsert('stock_snapshots','{"item_code":"ITEM","location_code":"L0","snapshot_date":"2026-10-10","quantity":"12","allocated_quantity":"2","unit_cost":"1.125","currency":"KWD","unit_of_measure":"EA"}')->>'result','succeeded','stock source unit import succeeds');
select is(pg_temp.upsert('stock_snapshots','{"item_code":"ITEM","location_code":"L0","snapshot_date":"2026-10-10","quantity":"12"}')->>'result','succeeded','legacy stock replacement accepted');
select is(pg_temp.upsert('stock_snapshots','{"item_code":"ITEM","location_code":"L0","snapshot_date":"2026-10-10","unit_of_measure":"BOX"}')->>'result','invalid','invalid supplied unit rejected');
reset role;
select is((select unit_of_measure from public.stock_snapshots where organization_id=pg_temp.id(1) and snapshot_date='2026-10-10'),null,'quantity replacement clears stock unit');
select * from finish();
rollback;
