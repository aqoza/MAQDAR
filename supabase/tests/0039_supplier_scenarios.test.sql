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
create function pg_temp.preview(code text default 'SUP',confirmed boolean default true) returns jsonb language sql as $$select public.supplier_scenario_preview(pg_temp.id(1),(select draft_id from fixture),code,confirmed)$$;
create function pg_temp.save(request integer default 400,fingerprint text default null,code text default 'SUP',confirmed boolean default true) returns uuid language sql as $$select public.supplier_scenario_save(pg_temp.id(1),(select draft_id from fixture),code,confirmed,pg_temp.id(request),coalesce(fingerprint,pg_temp.preview(code,confirmed)->>'fingerprint'))$$;
set local role authenticated;
select is(pg_temp.preview()->>'status','available','matching supplier scenario available');
select is((pg_temp.preview()->>'quantity')::numeric,12::numeric,'8 gap, 10 MOQ, 6 pack rounds to 12');
select is((pg_temp.preview()->>'overage')::numeric,4::numeric,'overage is rounded quantity minus saved gap');
select is(pg_temp.preview()->'source'->>'lead_time','3','saved fixed policy lead time captured');
select is(pg_temp.preview('UNKNOWN')->>'status','supplier_missing','unknown supplier has no inferred terms');
select is(pg_temp.preview('SUP',false)->>'status','terms_unconfirmed','terms require explicit applicability confirmation');
select is(pg_temp.preview('SUP',false)->>'quantity',null,'unconfirmed terms never produce a quantity');
select throws_ok($$select pg_temp.preview('SUP',null)$$,'MQ422',null,'missing confirmation rejected');
select throws_ok($$select pg_temp.preview('SUP/01')$$,'MQ422',null,'invalid supplier code rejected');
update fixture set report=pg_temp.preview(),scenario_id=pg_temp.save();
select is(pg_temp.save(),(select scenario_id from fixture),'identical replay returns original scenario');
select is((select count(*) from public.supplier_scenarios where organization_id=pg_temp.id(1)),1::bigint,'one saved row');
select is((select count(*) from public.audit_log where table_name='supplier_scenarios' and record_id=(select scenario_id from fixture)),1::bigint,'one audit event');
select is((select quantity::numeric from public.supplier_scenario_list where id=(select scenario_id from fixture)),12::numeric,'narrow history preserves quantity');
select throws_ok($$select pg_temp.save(400,null,'SUP',false)$$,'MQ409',null,'request reuse binds confirmation');
select throws_ok($$update public.supplier_scenarios set report='{}'$$,'42501',null,'no direct scenario updates');
select throws_ok($$delete from public.supplier_scenarios$$,'42501',null,'no direct scenario deletes');
select throws_ok($$insert into public.supplier_scenarios default values$$,'42501',null,'no direct scenario inserts');
select pg_temp.login(11,1);
select is(pg_temp.preview()->>'status','available','viewer may preview');
select throws_ok($$select pg_temp.save(401)$$,'MQ403',null,'viewer cannot save');
select is((select count(*) from public.supplier_scenarios),1::bigint,'viewer can read scenarios');
select pg_temp.login(12,1);
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'branch-restricted preview denied');
select is((select count(*) from public.supplier_scenario_list),0::bigint,'branch-restricted history hidden');
select pg_temp.login(13,2);
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'foreign tenant preview denied');
select is((select count(*) from public.supplier_scenarios),0::bigint,'foreign tenant history hidden');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'active organization claim narrows preview');
select pg_temp.login(10,1);
update public.stock_snapshots set quantity=999 where organization_id=pg_temp.id(1);
update public.open_orders set quantity=100 where organization_id=pg_temp.id(1);
select is(pg_temp.preview()->>'fingerprint',(select report->>'fingerprint' from fixture),'later stock and orders never refresh the saved gap');
update public.supplier_items set pack_size=7 where id=pg_temp.id(130);
select throws_ok($$select pg_temp.save(401,(select report->>'fingerprint' from fixture))$$,'MQ409',null,'changed terms reject stale preview');
select is(pg_temp.save(400,(select report->>'fingerprint' from fixture)),(select scenario_id from fixture),'identical retry retains original evidence after terms change');
select is((select (report->>'quantity')::numeric from public.supplier_scenarios where id=(select scenario_id from fixture)),12::numeric,'saved quantity immutable');
update public.suppliers set is_active=false where id=pg_temp.id(110);
select is(pg_temp.preview()->>'status','supplier_inactive','inactive supplier unavailable');
update public.suppliers set is_active=true where id=pg_temp.id(110);
update public.supplier_items set unit_of_measure=null where id=pg_temp.id(130);
select is(pg_temp.preview()->>'status','unit_unknown','unknown units not repaired from catalog');
update public.supplier_items set unit_of_measure='KG' where id=pg_temp.id(130);
select is(pg_temp.preview()->>'status','unit_mismatch','unit mismatch unavailable');
update public.supplier_items set unit_of_measure='EA',lead_time_days=4 where id=pg_temp.id(130);
select is(pg_temp.preview()->>'status','lead_time_mismatch','longer lead time requires a new matching policy');
update public.supplier_items set lead_time_days=2 where id=pg_temp.id(130);
select is(pg_temp.preview()->>'status','lead_time_mismatch','shorter lead time also requires explicit matching policy');
update public.supplier_items set lead_time_days=3,pack_size=6 where id=pg_temp.id(130);
reset role;
-- Privileged fixture changes represent different immutable source drafts.
update public.replenishment_drafts set report=jsonb_set(report,'{gap}','"0"') where id=(select draft_id from fixture);
set local role authenticated;
select is((pg_temp.preview()->>'quantity')::numeric,0::numeric,'zero gap stays zero despite positive MOQ');
reset role;
update public.replenishment_drafts set report=jsonb_set(report,'{gap}','"1.125"') where id=(select draft_id from fixture);
update public.supplier_items set min_order_quantity=1.5,pack_size=0.25 where id=pg_temp.id(130);
set local role authenticated;
select is((pg_temp.preview()->>'quantity')::numeric,1.5::numeric,'fractional pack rounding exact');
select is((pg_temp.preview()->>'overage')::numeric,0.375::numeric,'fractional overage exact');
reset role;
update public.replenishment_drafts set report=jsonb_set(report,'{gap}','"500000000000000.001"') where id=(select draft_id from fixture);
update public.supplier_items set min_order_quantity=0,pack_size=500000000000000 where id=pg_temp.id(130);
set local role authenticated;
select is(pg_temp.preview()->>'status','quantity_out_of_range','tiny remainder beyond a huge pack boundary is not rounded away');
select is(pg_temp.preview()->>'quantity',null,'overflow reports no quantity');
reset role;
update public.replenishment_drafts set report=jsonb_set(report,'{gap}','"999999999999999.999"') where id=(select draft_id from fixture);
update public.supplier_items set pack_size=0.001 where id=pg_temp.id(130);
set local role authenticated;
select is((pg_temp.preview()->>'quantity')::numeric,999999999999999.999::numeric,'maximum supported exact quantity');
reset role;
update public.replenishment_drafts set report=jsonb_set(report,'{status}','"orders_unconfirmed"') where id=(select draft_id from fixture);
set local role authenticated;
select is(pg_temp.preview()->>'status','draft_unavailable','unavailable source cannot become available by supplier selection');
reset role;
update public.replenishment_drafts set report=jsonb_set(report,'{status}','"available"') where id=(select draft_id from fixture);
delete from public.supplier_items where id=pg_temp.id(130);
set local role authenticated;
select is(pg_temp.preview()->>'status','terms_missing','missing supplier-item terms unavailable');
select is((select (report->>'quantity')::numeric from public.supplier_scenarios where id=(select scenario_id from fixture)),12::numeric,'supplier term deletion retains saved evidence');
reset role;
select ok(not has_function_privilege('service_role','public.supplier_scenario_save(uuid,uuid,text,boolean,uuid,text)','EXECUTE'),'API cannot create scenarios');
select ok(not has_function_privilege('zeespare_worker','public.supplier_scenario_save(uuid,uuid,text,boolean,uuid,text)','EXECUTE'),'worker capability unchanged');

insert into public.api_keys(organization_id,name,display_prefix,last4,key_hash,scopes,created_by,expires_at)
values(pg_temp.id(1),'Terms','zeespare_sk_abcd','abcd',decode(repeat('ad',32),'hex'),array['master_data:read','master_data:write'],pg_temp.id(10),now()+interval '1 day');
create function pg_temp.upsert(record jsonb) returns jsonb language sql as $$select public.api_upsert(decode(repeat('ad',32),'hex'),'supplier_items',jsonb_build_object('records',jsonb_build_array(record)),gen_random_uuid())$$;
select set_config('request.jwt.claims','{}',true);
set local role service_role;
select is(pg_temp.upsert('{"supplier_code":"SUP","item_code":"ITEM","lead_time_days":3,"min_order_quantity":"10","pack_size":"6","unit_price":"2","currency":"SAR","unit_of_measure":"EA"}')->>'result','succeeded','API creates supplied units');
select is((select r->>'unit_of_measure' from json_array_elements(public.api_list(decode(repeat('ad',32),'hex'),'supplier_items')->'data') r where r->>'supplier_code'='SUP'),'EA','API lists supplied units');
select is(pg_temp.upsert('{"supplier_code":"SUP","item_code":"ITEM","min_order_quantity":"10","pack_size":"6","unit_of_measure":"EA"}')->>'recorded','false','identical term replay idempotent');
select is(pg_temp.upsert('{"supplier_code":"SUP","item_code":"ITEM","lead_time_days":4}')->>'result','succeeded','lead-time-only update accepted');
reset role;
select is((select unit_of_measure from public.supplier_items where organization_id=pg_temp.id(1)),'EA','lead-time-only update preserves unit');
set local role service_role;
select is(pg_temp.upsert('{"supplier_code":"SUP","item_code":"ITEM","pack_size":"7"}')->>'result','succeeded','legacy pack update accepted');
reset role;
select is((select unit_of_measure from public.supplier_items where organization_id=pg_temp.id(1)),null,'legacy pack replacement clears unit evidence');
set local role service_role;
select is(pg_temp.upsert('{"supplier_code":"SUP","item_code":"ITEM","unit_of_measure":"KG"}')->>'result','succeeded','explicit unit-only update accepted');
select is(pg_temp.upsert('{"supplier_code":"SUP","item_code":"ITEM","unit_of_measure":"BOX"}')->>'result','invalid','unknown unit refused');
select is(pg_temp.upsert('{"supplier_code":"SUP","item_code":"ITEM","unit_of_measure":null}')->>'result','succeeded','explicit null unit accepted');
reset role;
select is((select unit_of_measure from public.supplier_items where organization_id=pg_temp.id(1)),null,'explicit null unit persists');
select * from finish();
rollback;
