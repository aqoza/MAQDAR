begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer, org integer) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void;
$$;
insert into auth.users(id,email) values(pg_temp.id(10),'step6-owner@test.local'),(pg_temp.id(11),'step6-branch@test.local'),(pg_temp.id(12),'step6-viewer@test.local');
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'step6-a','Step 6 A'),(pg_temp.id(2),'step6-b','Step 6 B');
insert into public.memberships(organization_id,user_id,role) values(pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'branch_user'),(pg_temp.id(2),pg_temp.id(12),'viewer');
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values
 (pg_temp.id(100),pg_temp.id(1),'I-1','Item 1','test','EA',1,'SAR'),(pg_temp.id(101),pg_temp.id(1),'I-2','Item 2','test','EA',1,'KWD'),(pg_temp.id(102),pg_temp.id(2),'OTHER','Other tenant','test','EA',1,'SAR');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values
 (pg_temp.id(200),pg_temp.id(1),'L-1','Branch 1','branch','SA','Asia/Riyadh'),(pg_temp.id(201),pg_temp.id(1),'L-2','Branch 2','branch','SA','Asia/Riyadh'),(pg_temp.id(202),pg_temp.id(2),'OTHER','Other branch','branch','SA','Asia/Riyadh');
insert into public.membership_locations(organization_id,user_id,location_id) values(pg_temp.id(1),pg_temp.id(11),pg_temp.id(200));
insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90) values(pg_temp.id(250),pg_temp.id(1),'S-1','Supplier','SA','SAR',1,2);
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency) values
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(200),'2026-10-01',100,0,1,'SAR'),
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(200),'2026-10-15',2,0,1.125,'SAR'),
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(201),'2026-10-15',0,0,1.125,'SAR'),
 (pg_temp.id(1),pg_temp.id(101),pg_temp.id(200),'2026-10-01',3,5,0.123,'KWD'),
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(200),'2026-10-16',999,0,1,'SAR'),
 (pg_temp.id(2),pg_temp.id(102),pg_temp.id(202),'2026-10-15',900,0,1,'SAR');
insert into public.demand_history(organization_id,item_id,location_id,demand_date,quantity,lost_sales_quantity) values
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(200),'2026-10-15',2,1),
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(201),'2026-10-15',5,0),
 (pg_temp.id(2),pg_temp.id(102),pg_temp.id(202),'2026-10-15',999,0);

set local role authenticated;
select pg_temp.login(10,1);
select is(public.dashboard_summary(pg_temp.id(1),'2026-10-15')->>'observed_pairs','3','latest snapshots count pairs once, excluding future snapshots');
select is(public.dashboard_summary(pg_temp.id(1),'2026-10-15')->>'stock_outs','2','zero and fully allocated pairs are stock-outs');
select is(public.dashboard_summary(pg_temp.id(1),'2026-10-15')->>'unobserved_pairs','1','missing pair is unknown, not a stock-out');
select is(public.dashboard_summary(pg_temp.id(1),'2026-10-15')->>'stale_pairs','1','stale observations are visible');
select is((public.dashboard_summary(pg_temp.id(1),'2026-10-15')->'inventory_value'->0->>'value')::numeric,0.369::numeric,'three-decimal KWD cost remains exact');
select is((public.dashboard_summary(pg_temp.id(1),'2026-10-15')->'inventory_value'->1->>'value')::numeric,2.250::numeric,'old and future stock are excluded from SAR valuation');
select is(jsonb_array_length(public.dashboard_summary(pg_temp.id(1),'2026-10-15')->'demand'),30,'trend always has 30 days');
select is(public.dashboard_summary(pg_temp.id(1),'2026-10-15')->'demand'->29->>'quantity','7.000','tenant total includes both visible locations');
select throws_ok($$select public.dashboard_summary(pg_temp.id(2),'2026-10-15')$$,'MQ404',null,'dashboard refuses another organization');
select throws_ok($$insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,unit_cost,currency) values(pg_temp.id(2),pg_temp.id(102),pg_temp.id(202),'2026-10-14',1,1,'SAR')$$,'42501',null,'cannot write another tenant');
select throws_ok($$insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,unit_cost,currency) values(pg_temp.id(1),pg_temp.id(102),pg_temp.id(200),'2026-10-14',1,1,'SAR')$$,'23503',null,'composite FK refuses cross-tenant items');
select cmp_ok((select count(*) from public.audit_log),'>',0::bigint,'admin sees own audit trail');
select throws_ok($$delete from public.audit_log$$,'42501',null,'even administrators cannot erase audit history');

select pg_temp.login(11,1);
select is((select count(*) from public.stock_snapshots),4::bigint,'branch user sees only assigned location snapshots');
select is(public.dashboard_summary(pg_temp.id(1),'2026-10-15')->>'observed_pairs','2','dashboard preserves branch scoping');
select is(public.dashboard_summary(pg_temp.id(1),'2026-10-15')->>'stock_outs','1','other branch stock-out is hidden');
select is(public.dashboard_summary(pg_temp.id(1),'2026-10-15')->'demand'->29->>'quantity','2.000','demand trend preserves branch scoping');
select is((select count(*) from public.audit_log),0::bigint,'branch users cannot inspect organization-wide audit values');
select throws_ok($$insert into public.receipts(organization_id,receipt_code,line_code,item_id,location_id,supplier_id,receipt_date,quantity,unit_cost,currency) values(pg_temp.id(1),'R','1',pg_temp.id(100),pg_temp.id(200),pg_temp.id(250),'2026-10-15',1,1,'SAR')$$,'42501',null,'branch user cannot write receipts');
select pg_temp.login(12,2);
select is((select count(*) from public.stock_snapshots),1::bigint,'other tenant sees only its own stock');
reset role;
select set_config('request.jwt.claims','{}',true);

insert into public.api_keys(organization_id,name,display_prefix,last4,key_hash,scopes,created_by,expires_at) values
 (pg_temp.id(1),'Step 6','maqdar_sk_abcd','abcd',decode(repeat('ab',32),'hex'),array['transactions:read','transactions:write'],pg_temp.id(10),now()+interval '1 day'),
 (pg_temp.id(1),'Master only','maqdar_sk_efgh','efgh',decode(repeat('cd',32),'hex'),array['master_data:read','master_data:write'],pg_temp.id(10),now()+interval '1 day');
set local role service_role;
select is(public.api_upsert(decode(repeat('ab',32),'hex'),'stock_snapshots','{"records":[{"item_code":"I-2","location_code":"L-2","snapshot_date":"2026-10-15","quantity":"4","unit_cost":"0.123","currency":"KWD"}]}',gen_random_uuid())->>'result','succeeded','transaction-scoped key imports stock with default allocation');
select is(public.api_upsert(decode(repeat('ab',32),'hex'),'stock_snapshots','{"records":[{"item_code":"I-2","location_code":"L-2","snapshot_date":"2026-10-15","quantity":"4","unit_cost":"0.123","currency":"KWD"}]}',gen_random_uuid())->>'recorded','false','replay changes nothing');
select is(public.api_upsert(decode(repeat('ab',32),'hex'),'stock_snapshots','{"records":[{"item_code":"I-2","location_code":"L-2","snapshot_date":"2026-10-15","quantity":"5"}]}',gen_random_uuid())->>'result','succeeded','partial update preserves omitted cost and currency');
select is(public.api_upsert(decode(repeat('ab',32),'hex'),'stock_snapshots','{"records":[{"item_code":"I-1","location_code":"L-2","snapshot_date":"2026-10-14","quantity":"3","unit_cost":"1","currency":"SAR"},{"item_code":"OTHER","location_code":"L-2","snapshot_date":"2026-10-14","quantity":"3","unit_cost":"1","currency":"SAR"}]}',gen_random_uuid())->>'result','invalid','cross-tenant natural key makes entire request invalid');
select is(public.api_upsert(decode(repeat('ab',32),'hex'),'open_orders','{"records":[{"order_code":"PO-1","line_code":"1","item_code":"I-1","location_code":"L-2","supplier_code":"S-1","expected_date":"2026-10-20","quantity":"5","unit_cost":"1","currency":"SAR"}]}',gen_random_uuid())->>'result','succeeded','open orders import');
select is(public.api_upsert(decode(repeat('ab',32),'hex'),'receipts','{"records":[{"receipt_code":"R-1","line_code":"1","item_code":"I-1","location_code":"L-2","supplier_code":"S-1","receipt_date":"2026-10-15","quantity":"2","unit_cost":"1","currency":"SAR"}]}',gen_random_uuid())->>'result','succeeded','receipts import');
select is(public.api_list(decode(repeat('ab',32),'hex'),'open_orders')->'data'->0->>'quantity','5.000','receipt never decrements authoritative order');
select is(public.api_list(decode(repeat('ab',32),'hex'),'receipts')->'data'->0->>'receipt_date','2026-10-15','transaction lists expose contract dates');
select throws_ok($$select public.api_list(decode(repeat('cd',32),'hex'),'receipts')$$,'MQ403',null,'master-only key cannot read transactions');
select throws_ok($$select public.api_upsert(decode(repeat('cd',32),'hex'),'stock_snapshots','{"records":[]}',gen_random_uuid())$$,'MQ403',null,'master-only key cannot write transactions');
select throws_ok($$select * from public.audit_log$$,'42501',null,'service key has no raw audit access');
reset role;
select is((select count(*) from public.stock_snapshots where organization_id=pg_temp.id(1) and snapshot_date='2026-10-14'),0::bigint,'invalid bulk write left no good row behind');
select is((select quantity from public.stock_snapshots where organization_id=pg_temp.id(1) and item_id=pg_temp.id(100) and location_id=pg_temp.id(201) and snapshot_date='2026-10-15'),0.000::numeric,'receipt never increments stock');
select cmp_ok((select count(*) from public.audit_log where organization_id=pg_temp.id(1) and table_name='receipts'),'>',0::bigint,'receipt write is audited');
select is((select count(*) from public.audit_log where organization_id=pg_temp.id(1) and table_name='demand_history'),1::bigint,'bulk demand is summarized once per tenant and statement');
select is(app.api_record_type_drift(),null,'all response types match the additive import contract');
set local role authenticated;
select pg_temp.login(11,1);
select is((select count(*) from public.open_orders),0::bigint,'branch user cannot read another branch order');
select is((select count(*) from public.receipts),0::bigint,'branch user cannot read another branch receipt');
select pg_temp.login(12,2);
select is((select count(*) from public.open_orders),0::bigint,'another tenant cannot read orders');
select is((select count(*) from public.receipts),0::bigint,'another tenant cannot read receipts');
select is((select count(*) from public.audit_log),0::bigint,'another tenant cannot read audit values');
select throws_ok($$insert into public.open_orders(organization_id,order_code,line_code,item_id,location_id,supplier_id,expected_date,quantity,unit_cost,currency) values(pg_temp.id(1),'OTHER','1',pg_temp.id(100),pg_temp.id(200),pg_temp.id(250),'2026-10-15',1,1,'SAR')$$,'42501',null,'cannot insert another tenant order');
select throws_ok($$insert into public.receipts(organization_id,receipt_code,line_code,item_id,location_id,supplier_id,receipt_date,quantity,unit_cost,currency) values(pg_temp.id(1),'OTHER','1',pg_temp.id(100),pg_temp.id(200),pg_temp.id(250),'2026-10-15',1,1,'SAR')$$,'42501',null,'cannot insert another tenant receipt');
select pg_temp.login(10,1);
select throws_ok($$update public.stock_snapshots set quantity='NaN' where organization_id=pg_temp.id(1)$$,'23514',null,'non-finite stock cannot poison dashboard totals');
reset role;
-- Retention keeps the summaries, and never acknowledges a live Storage object.
create temp table retention_file as select f.batch_id,f.file_no,f.storage_path,f.organization_id from public.import_files f where f.organization_id=pg_temp.id(1) limit 1;
update public.import_files set source_stored=true where (batch_id,file_no) in(select batch_id,file_no from retention_file);
select is((select count(*) from public.import_retention_candidates() where batch_id in(select batch_id from retention_file)),0::bigint,'recent original is not eligible');
update public.import_batches set finished_at=now()-interval '31 days' where id in(select batch_id from retention_file);
select is((select count(*) from public.import_retention_candidates() where batch_id in(select batch_id from retention_file)),1::bigint,'original is eligible after 30 days');
insert into storage.objects(bucket_id,name) select 'imports',storage_path from retention_file;
select is(public.import_retention_complete((select batch_id from retention_file),(select file_no from retention_file)),false,'live Storage object cannot be acknowledged as purged');
-- A distinct eligible file with no object represents a successful Storage API deletion.
create temp table absent_file as select f.batch_id,f.file_no from public.import_files f where f.organization_id=pg_temp.id(1) and f.batch_id not in(select batch_id from retention_file) limit 1;
update public.import_batches set finished_at=now()-interval '31 days' where id in(select batch_id from absent_file);
update public.import_files set source_stored=true where (batch_id,file_no) in(select batch_id,file_no from absent_file);
select is(public.import_retention_complete((select batch_id from absent_file),(select file_no from absent_file)),true,'missing object can be acknowledged');
select ok((select source_purged_at is not null and not source_stored from public.import_files where (batch_id,file_no) in(select batch_id,file_no from absent_file)),'purge timestamp is retained on the summary');
insert into public.import_errors(organization_id,batch_id,file_no,row_no,code,level,value)
select organization_id,batch_id,file_no,1,'required','error','retained value' from retention_file;
select lives_ok($$select app.import_housekeeping()$$,'housekeeping runs with bounded work');
select is((select count(*) from public.import_errors where batch_id in(select batch_id from retention_file)),0::bigint,'row-level error details expire after 30 days');
select is((select count(*) from public.import_batches where id in(select batch_id from retention_file)),1::bigint,'import summary survives retention');
select lives_ok($$select app.maintain_demand_partitions()$$,'partition maintenance is idempotent');
select is((select count(*) from cron.job where jobname in ('maqdar-demand-partitions','maqdar-import-housekeeping')),2::bigint,'both database maintenance jobs are scheduled');
select throws_ok($$set local role authenticated; select app.import_housekeeping()$$,'42501',null,'members cannot run maintenance');
reset role;
select * from finish();
rollback;
