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
create function pg_temp.preview(backorders text default '4',confirmed boolean default true,basis text default 'calculated',override_id uuid default null)
returns jsonb language sql as $$select public.replenishment_preview(pg_temp.id(1),pg_temp.id(50),basis,override_id,backorders,confirmed)$$;
create function pg_temp.save(request integer default 300,fingerprint text default null,backorders text default '4')
returns uuid language sql as $$select public.replenishment_save(pg_temp.id(1),pg_temp.id(50),pg_temp.id(request),'calculated',null,backorders,true,coalesce(fingerprint,pg_temp.preview(backorders)->>'fingerprint'))$$;
create temporary table captured(report jsonb,id uuid);
grant all on captured to authenticated;
set local role authenticated;
select pg_temp.login(11,1);
select is(pg_temp.preview()->>'status','available','viewer can inspect');
select is(pg_temp.preview()->>'inbound_quantity','6.000','only positive remaining open lines count; receipts not subtracted');
select is(pg_temp.preview()->>'inventory_position','12.000','hand-calculated stock less allocations plus inbound less additional backorders');
select is(pg_temp.preview()->>'gap','8.000','unrounded gap is exact');
select is(pg_temp.preview()->'orders'->0->>'overdue','true','overdue arrival counted and flagged');
select is(pg_temp.preview()->'orders'->1->>'late','true','after-protection arrival counted and flagged');
select is(pg_temp.preview()->>'protection_end','2026-10-17','protection period uses saved lead plus review');
select is(pg_temp.preview('4',true,'approved',pg_temp.id(61))->>'gap','9.000','exact chosen approved revision');
select is(pg_temp.preview('4',true,'approved',pg_temp.id(62))->>'gap','10.000','newer revision only when explicitly selected');
select is(pg_temp.preview('4',false)->>'gap',null,'no gap without synchronization confirmation');
select is(pg_temp.preview('4',false)->>'status','orders_unconfirmed','unconfirmed diagnosis');
select throws_ok($$select pg_temp.save()$$,'MQ403',null,'viewer cannot save');
select throws_ok($$select pg_temp.preview('-1')$$,'MQ422',null,'negative backorders rejected');
select throws_ok($$select pg_temp.preview('1.0001')$$,'MQ422',null,'fraction precision rejected');
select throws_ok($$select pg_temp.preview('NaN')$$,'MQ422',null,'nonfinite backorders rejected');
select throws_ok($$select pg_temp.preview(null)$$,'MQ422',null,'missing backorders never zero');
select throws_ok($$select pg_temp.preview('0',null)$$,'MQ422',null,'missing confirmation rejected');
select throws_ok($$select pg_temp.preview('0',true,'approved',null)$$,'MQ422',null,'approved maximum must be explicit');
select pg_temp.login(12,1);
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'branch isolation on preview');
select pg_temp.login(13,2);
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'tenant isolation on preview');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'active claim isolation');
select pg_temp.login(10,1);
insert into captured values(pg_temp.preview(),pg_temp.save());
select is(pg_temp.save(),(select id from captured),'identical retry replays saved record');
select is((select count(*) from public.replenishment_drafts where organization_id=pg_temp.id(1)),1::bigint,'retry creates one record');
select is((select report->>'gap' from public.replenishment_drafts where id=(select id from captured)),'8.000','saved evidence matches preview');
select is((select gap from public.replenishment_draft_list where id=(select id from captured)),'8.000','list preserves decimal strings');
select throws_ok($$select pg_temp.save(300,null,'5')$$,'MQ409',null,'request reuse with changed inputs conflicts');
select throws_ok($$update public.replenishment_drafts set report='{}'$$,'42501',null,'direct updates denied');
select throws_ok($$delete from public.replenishment_drafts$$,'42501',null,'direct deletes denied');
select throws_ok($$insert into public.replenishment_drafts default values$$,'42501',null,'direct inserts denied');
select pg_temp.login(11,1);
select is((select count(*) from public.replenishment_drafts where organization_id=pg_temp.id(1)),1::bigint,'viewer can read saved evidence');
select pg_temp.login(12,1);
select is((select count(*) from public.replenishment_draft_list where organization_id=pg_temp.id(1)),0::bigint,'saved list preserves branch scope');
select pg_temp.login(13,2);
select is((select count(*) from public.replenishment_drafts where organization_id=pg_temp.id(1)),0::bigint,'saved evidence preserves tenant scope');
reset role;
select pg_temp.login(10,1);
select is((select count(*) from public.audit_log where table_name='replenishment_drafts' and record_id=(select id from captured)),1::bigint,'save audited once');
update public.open_orders set quantity=4 where id=pg_temp.id(120);
select throws_ok($$select pg_temp.save(301,(select report->>'fingerprint' from captured))$$,'MQ409',null,'changed inbound invalidates preview');
select is(pg_temp.save(300,(select report->>'fingerprint' from captured)),(select id from captured),'retry after feed change returns original evidence');
select is((select report->>'gap' from public.replenishment_drafts where id=(select id from captured)),'8.000','feed change never mutates saved draft');
update public.open_orders set quantity=3.250,unit_of_measure=null where id=pg_temp.id(120);
select is(pg_temp.preview()->>'status','inbound_unit_unknown','legacy positive inbound cannot be treated as known units');
select is(pg_temp.preview()->>'inbound_quantity',null,'unknown units never partially summed');
update public.open_orders set unit_of_measure='KG' where id=pg_temp.id(120);
select is(pg_temp.preview()->>'status','inbound_unit_mismatch','incompatible inbound not converted');
update public.open_orders set unit_of_measure='EA' where id=pg_temp.id(120);
update public.stock_snapshots set snapshot_date='2026-10-09' where organization_id=pg_temp.id(1) and snapshot_date='2026-10-10';
select is(pg_temp.preview()->>'status','stock_date_mismatch','even one-day-old stock is unavailable');
update public.stock_snapshots set snapshot_date='2026-10-10',unit_of_measure=null where organization_id=pg_temp.id(1) and snapshot_date='2026-10-09';
select is(pg_temp.preview()->>'status','stock_unit_unknown','unknown stock units unavailable');
update public.stock_snapshots set unit_of_measure='EA',quantity=1,allocated_quantity=20 where organization_id=pg_temp.id(1) and snapshot_date='2026-10-10';
select is(pg_temp.preview()->>'gap','37.000','negative stock position remains in gap');
select is(pg_temp.preview('999999999999999.999')->>'status','quantity_out_of_range','oversized gap unavailable instead of numeric overflow');
update public.stock_snapshots set quantity=100,allocated_quantity=0 where organization_id=pg_temp.id(1) and snapshot_date='2026-10-10';
select is(pg_temp.preview()->>'gap','0','surplus clamps gap to zero');
update public.open_orders set status='closed' where organization_id=pg_temp.id(1);
select is(pg_temp.preview()->>'inbound_quantity','0','confirmed complete empty order book contributes zero');
select is(pg_temp.preview('0',false)->>'inbound_quantity',null,'empty unconfirmed book stays unknown');
update public.inventory_policies set evidence=jsonb_set(evidence,'{forecast,method}','"regional-v1"') where id=pg_temp.id(50);
select is(pg_temp.preview()->>'status','prepared_group','prepared group procurement excluded');
select is(pg_temp.preview()->>'inbound_quantity',null,'representative item inbound is not group evidence');
select is(jsonb_array_length(pg_temp.preview()->'orders'),0,'no partial prepared-group line evidence');
update public.inventory_policies set evidence=jsonb_set(evidence,'{forecast,method}','"baseline-v1"') where id=pg_temp.id(50);
insert into public.open_orders(organization_id,order_code,line_code,item_id,location_id,supplier_id,expected_date,quantity,unit_cost,currency,unit_of_measure)
select pg_temp.id(1),'MANY'||n,'1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-10',1,1,'SAR','EA' from generate_series(1,1001) n;
select is(pg_temp.preview()->>'status','inbound_limit','bounded capture rejects overflow');
select is(pg_temp.preview()->>'inbound_quantity',null,'no truncated total');
select is(jsonb_array_length(pg_temp.preview()->'orders'),0,'no misleading partial evidence');
select is(pg_temp.preview()->>'orders_truncated','true','overflow explicit');
select ok(not has_function_privilege('service_role','public.replenishment_save(uuid,uuid,uuid,text,uuid,text,boolean,text)','EXECUTE'),'API service cannot save drafts');
select ok(not has_function_privilege('maqdar_worker','public.replenishment_save(uuid,uuid,uuid,text,uuid,text,boolean,text)','EXECUTE'),'no worker capability added');
select ok((select indisvalid from pg_index where indexrelid='public.open_orders_replenishment_idx'::regclass),'concurrent lookup index valid');
delete from public.open_orders where organization_id=pg_temp.id(1) and order_code like 'MANY%';

-- Canonical importer/API: explicit evidence, replay, legacy updates and clears.
select set_config('request.jwt.claims','{}',true);
insert into public.api_keys(organization_id,name,display_prefix,last4,key_hash,scopes,created_by,expires_at)
values(pg_temp.id(1),'Orders','maqdar_sk_abcd','abcd',decode(repeat('ac',32),'hex'),array['transactions:read','transactions:write'],pg_temp.id(10),now()+interval '1 day');
create function pg_temp.upsert(record jsonb) returns jsonb language sql as $$select public.api_upsert(decode(repeat('ac',32),'hex'),'open_orders',jsonb_build_object('records',jsonb_build_array(record)),gen_random_uuid())$$;
set local role service_role;
select is(pg_temp.upsert('{"order_code":"API","line_code":"1","item_code":"ITEM","location_code":"L0","supplier_code":"SUP","expected_date":"2026-10-11","quantity":"1.125","unit_cost":"2","currency":"KWD","unit_of_measure":"EA"}')->>'result','succeeded','unit-aware open order API create');
select is(pg_temp.upsert('{"order_code":"API","line_code":"1","quantity":"1.125","unit_of_measure":"EA"}')->>'recorded','false','identical quantities and units idempotent');
select is((select r->>'unit_of_measure' from json_array_elements(public.api_list(decode(repeat('ac',32),'hex'),'open_orders')->'data') r where r->>'order_code'='API'),'EA','API lists supplied order units');
select is(pg_temp.upsert('{"order_code":"API","line_code":"1","expected_date":"2026-10-12"}')->>'result','succeeded','arrival update accepted');
reset role;
select is((select unit_of_measure from public.open_orders where organization_id=pg_temp.id(1) and order_code='API'),'EA','arrival update preserves units');
set local role service_role;
select is(pg_temp.upsert('{"order_code":"API","line_code":"1","quantity":"2"}')->>'result','succeeded','legacy quantity update accepted');
select is(pg_temp.upsert('{"order_code":"API","line_code":"1","unit_of_measure":"BOX"}')->>'result','invalid','unknown enum rejected');
reset role;
select is((select unit_of_measure from public.open_orders where organization_id=pg_temp.id(1) and order_code='API'),null,'legacy quantity update clears unit evidence');
select * from finish();
rollback;
