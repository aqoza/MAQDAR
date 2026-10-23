begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('a8700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer default 1) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'stock-locator-'||n||'@test.local' from generate_series(10,13) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'locator-a','Locator A'),(pg_temp.id(2),'locator-b','Locator B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),
 (pg_temp.id(1),pg_temp.id(12),'branch_user'),(pg_temp.id(2),pg_temp.id(13),'owner');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone,latitude,longitude,is_active)
select pg_temp.id(100+n),pg_temp.id(case when n=11 then 2 else 1 end),code,'Location '||code,'branch','SA','Asia/Riyadh',lat,lon,n<>10
from (values (0,'RECEIVER',0.0,0.0),(1,'NEAR',0.0,0.1),(2,'FAR',0.0,1.0),(3,'NOGEO',null,null),
 (4,'STALE',0.0,0.01),(5,'UNKNOWN',0.0,0.02),(6,'MISMATCH',0.0,0.03),(7,'ZERO',0.0,0.04),
 (8,'NEGATIVE',0.0,0.05),(9,'FUTURE',0.0,0.06),(10,'INACTIVE',0.0,0.07),(11,'OTHERORG',0.0,0.08),
 (12,'PARTIAL',0.0,null),(13,'ANTIPODE',0.0,180.0),(14,'DATELINE',0.0,-179.9),(15,'POLAR',90.0,0.0),
 (16,'MISSING',0.0,0.09),(17,'CHANGEDUNIT',0.0,0.08),(18,'LATESTZERO',0.0,0.09),(19,'REVERSE',0.0,1.0)) v(n,code,lat,lon);
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
 values(pg_temp.id(50),pg_temp.id(1),'PART/1','Locator item','Test','SET',1,'SAR'),
 (pg_temp.id(51),pg_temp.id(2),'PART/1','Other org item','Test','EA',1,'SAR'),
 (pg_temp.id(52),pg_temp.id(1),'OTHER','Other item','Test','EA',1,'SAR');
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
select pg_temp.id(case when n=11 then 2 else 1 end),pg_temp.id(case when n=11 then 51 else 50 end),pg_temp.id(100+n),
 case when n=4 then date '2026-10-09' when n=2 then date '2026-10-10' when n=9 then date '2026-10-18' else date '2026-10-17' end,
 case when n=1 then 900719925474099.125 when n in(7,8,18) then 0 else 12.250 end,
 case when n=1 then 0.124 when n=8 then 2.125 else 0 end,1,'SAR',
 case when n=5 then null when n in(6,17) then 'KG' else 'EA' end
from generate_series(0,19) n where n<>16;
-- Older favorable observations must never replace newer incompatible/zero evidence.
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
select pg_temp.id(1),pg_temp.id(50),pg_temp.id(100+n),'2026-10-16',500,0,1,'SAR','EA' from unnest(array[17,18]) n;
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
values(pg_temp.id(1),pg_temp.id(52),pg_temp.id(116),'2026-10-17',999,0,1,'SAR','EA');
insert into public.network_links(id,organization_id,from_location_id,to_location_id,lead_time_days_p50,lead_time_days_p90,freight_basis,is_active) values
 (pg_temp.id(200),pg_temp.id(1),pg_temp.id(101),pg_temp.id(100),0,3,'none',true),
 (pg_temp.id(201),pg_temp.id(1),pg_temp.id(102),pg_temp.id(100),2,4,'none',false),
 (pg_temp.id(202),pg_temp.id(1),pg_temp.id(100),pg_temp.id(119),5,7,'none',true);
insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90)
values(pg_temp.id(60),pg_temp.id(1),'SUP','Supplier','SA','SAR',3,5);
insert into public.open_orders(organization_id,order_code,line_code,item_id,location_id,supplier_id,expected_date,quantity,unit_cost,currency,status,unit_of_measure)
values(pg_temp.id(1),'INBOUND','1',pg_temp.id(50),pg_temp.id(108),pg_temp.id(60),'2026-10-17',1000,1,'SAR','open','EA');
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(100));
create function pg_temp.locator(filters jsonb default '{"view":"all"}',page integer default 1,size integer default 25,unit text default 'EA',day date default '2026-10-17')
returns jsonb language sql as $$select public.stock_locator(pg_temp.id(1),'PART/1','RECEIVER',unit,day,filters,page,size)$$;
create function pg_temp.row(code text) returns jsonb language sql as $$select value from jsonb_array_elements(pg_temp.locator()->'rows') where value->>'code'=code$$;
create temporary table before_reads as select
 (select jsonb_agg(to_jsonb(s) order by id) from public.stock_snapshots s) stock,
 (select jsonb_agg(to_jsonb(o) order by id) from public.open_orders o) orders,
 (select count(*) from public.receipts) receipts,(select count(*) from public.audit_log) audits,
 (select count(*) from public.redistribution_drafts) drafts,(select count(*) from public.transfer_proposals) proposals;
select pg_temp.login(10);
set local role authenticated;
select is(pg_temp.locator()->>'total','17','only other active same-tenant sources are returned');
select is(pg_temp.locator()#>>'{counts,matching}','8','matching count uses supplied units, not current SET catalog unit');
select is(pg_temp.locator()#>>'{counts,other}','9','other evidence remains separate');
select is(pg_temp.locator('{}')->>'total','8','default view is matching stock');
select is(pg_temp.locator('{"view":"other"}')->>'total','9','other view includes unavailable and nonpositive evidence');
select is(pg_temp.locator('{}')#>>'{rows,0,code}','NEAR','fresh positive stock ranks before closer incompatible evidence');
select is(pg_temp.row('NEAR')#>>'{snapshot,net}','900719925474099.001','large net stock remains an exact decimal string');
select is(pg_temp.row('NEAR')->>'distance_km','11.1','equatorial one tenth degree distance');
select is(pg_temp.row('NEAR')#>>'{lane,p50}','0','zero-day lane is preserved');
select is(pg_temp.row('NEAR')#>>'{lane,p90}','3','slow lane evidence is independent of distance');
select is(pg_temp.row('FAR')->>'distance_km','111.2','equatorial one degree distance');
select is(pg_temp.row('FAR')->>'status','matching','exactly seven-day-old observation is eligible');
select is(pg_temp.row('FAR')->'lane','null'::jsonb,'inactive lane is not current active evidence');
select is(pg_temp.row('REVERSE')->'lane','null'::jsonb,'reverse direction does not imply a source-to-receiver lane');
select is(pg_temp.locator('{}')#>>'{rows,1,code}','FAR','exact distance tie is broken by source code');
select is(pg_temp.locator('{}')#>>'{rows,2,code}','REVERSE','equal-distance second code is deterministic');
select is(pg_temp.locator('{}')#>>'{rows,6,code}','NOGEO','unknown distance follows all known matching distances');
select is(pg_temp.locator('{}')#>>'{rows,7,code}','PARTIAL','partial coordinate pair remains unknown');
select is(pg_temp.row('NOGEO')->'distance_km','null'::jsonb,'unknown is not zero distance');
select is(pg_temp.row('STALE')->>'status','stale','eight-day-old observation is stale');
select is(pg_temp.row('UNKNOWN')->>'status','unit_unknown','unknown unit cannot inherit current catalog unit');
select is(pg_temp.row('MISMATCH')->>'status','unit_mismatch','different source-supplied unit is not converted');
select is(pg_temp.row('CHANGEDUNIT')->>'status','unit_mismatch','latest incompatible observation does not fall back');
select is(pg_temp.row('LATESTZERO')->>'status','no_stock','latest zero observation does not fall back');
select is(pg_temp.row('ZERO')->>'status','no_stock','explicit zero is observed, not missing');
select is(pg_temp.row('NEGATIVE')#>>'{snapshot,net}','-2.125','allocations can exceed on-hand; inbound never offsets negative net stock');
select is(pg_temp.row('FUTURE')->>'status','missing','future-only snapshot is absent at cutoff');
select is(pg_temp.row('MISSING')->>'status','missing','another item snapshot cannot fill missing evidence');
select is(pg_temp.row('ANTIPODE')->>'distance_km','20015.1','antipodal distance remains finite');
select is(pg_temp.locator('{"view":"all","q":"near"}')->>'total','1','normalized source search filters rows');
select is(pg_temp.locator('{"view":"all","q":"otherorg"}')->>'total','0','search cannot disclose other tenants');
select is(pg_temp.locator('{}',1,25,'KG')#>>'{counts,matching}','2','explicit requested unit changes matching evidence');
select is(pg_temp.locator('{"view":"all"}',1,25,'EA','2026-10-16')#>>'{counts,matching}','4','historical date selects eligible dated observations only');
select is(pg_temp.locator('{}',999)->>'page','1','out-of-range page clamps');
select is(pg_temp.locator('{"q":"absent"}',999)->>'page','1','empty result has page one');
select throws_ok($$select pg_temp.locator('{"q":null}')$$,'MQ422',null,'null filter rejected');
select throws_ok($$select pg_temp.locator('{"view":"surplus"}')$$,'MQ422',null,'unapproved view rejected');
select throws_ok($$select pg_temp.locator('{"column":"secret"}')$$,'MQ422',null,'unknown filter rejected');
select throws_ok($$select pg_temp.locator(jsonb_build_object('q',repeat('x',101)))$$,'MQ422',null,'query bounded');
select throws_ok($$select pg_temp.locator(jsonb_build_object('q',chr(10)))$$,'MQ422',null,'control characters rejected');
select throws_ok($$select pg_temp.locator('[]')$$,'MQ422',null,'array filters rejected');
select throws_ok($$select pg_temp.locator('{}',0)$$,'MQ422',null,'positive page required');
select throws_ok($$select pg_temp.locator('{}',1,101)$$,'MQ422',null,'page size bounded');
select throws_ok($$select pg_temp.locator('{}',1,25,'BOX')$$,'MQ422',null,'known requested unit required');
select throws_ok($$select pg_temp.locator('{}',1,25,'EA','infinity')$$,'MQ422',null,'finite date required');
select throws_ok($$select public.stock_locator(pg_temp.id(1),'PART/1','INACTIVE','EA','2026-10-17')$$,'MQ404',null,'inactive receiver refused');
select throws_ok($$select public.stock_locator(pg_temp.id(1),'PART/1','OTHERORG','EA','2026-10-17')$$,'MQ404',null,'foreign receiver refused');
select throws_ok($$select public.stock_locator(pg_temp.id(1),'part/1','RECEIVER','EA','2026-10-17')$$,'MQ404',null,'item lookup is exact and case-sensitive');
select throws_ok($$select public.stock_locator(pg_temp.id(1),'%','RECEIVER','EA','2026-10-17')$$,'MQ422',null,'item wildcard refused');
select pg_temp.login(11);
select is(pg_temp.locator()->>'total','17','viewer may inspect stock');
select pg_temp.login(12);
select is(pg_temp.locator()->>'total','0','receiver-only branch access exposes no sources or counts');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(101));
set local role authenticated;
select is(pg_temp.locator()->>'total','1','both endpoints authorize the one permitted source');
select is(pg_temp.locator()#>>'{counts,matching}','1','matching count obeys location scope');
reset role;
delete from public.membership_locations where user_id=pg_temp.id(12) and location_id=pg_temp.id(100);
set local role authenticated;
select throws_ok($$select pg_temp.locator()$$,'MQ404',null,'source-only access cannot inspect a receiver');
select pg_temp.login(13,2);
select throws_ok($$select pg_temp.locator()$$,'MQ404',null,'cross-tenant request refused');
reset role;
insert into public.memberships values(pg_temp.id(2),pg_temp.id(10),'viewer',now());
select pg_temp.login(10,2);
set local role authenticated;
select throws_ok($$select pg_temp.locator()$$,'MQ404',null,'active claim narrows multi-org membership');
reset role;
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
select throws_ok($$select pg_temp.locator()$$,'MQ401',null,'missing user claim refused');
reset role;
set local role anon;
select throws_ok($$select pg_temp.locator()$$,'42501',null,'anonymous execute denied');
reset role;
set local role service_role;
select throws_ok($$select pg_temp.locator()$$,'42501',null,'API service execute denied');
reset role;
select ok(not has_function_privilege('zeespare_worker','public.stock_locator(uuid,text,text,text,date,jsonb,integer,integer)','EXECUTE'),'worker execute denied');
select is((select jsonb_agg(to_jsonb(s) order by id) from public.stock_snapshots s),(select stock from before_reads),'reads preserve all stock evidence');
select is((select jsonb_agg(to_jsonb(o) order by id) from public.open_orders o),(select orders from before_reads),'reads preserve inbound');
select is((select count(*) from public.receipts),(select receipts from before_reads),'reads add no receipts');
select is((select count(*) from public.audit_log),(select audits from before_reads),'reads add no business audits');
select is((select count(*) from public.redistribution_drafts),(select drafts from before_reads),'reads create no drafts');
select is((select count(*) from public.transfer_proposals),(select proposals from before_reads),'reads create no proposals');
-- Coordinate boundaries use current master data and do not claim historical routing.
update public.locations set longitude=179.9 where id=pg_temp.id(100);
select pg_temp.login(10);
set local role authenticated;
select is(pg_temp.row('DATELINE')->>'distance_km','22.2','distance crosses the antimeridian by the short arc');
reset role;
update public.locations set latitude=90,longitude=180 where id=pg_temp.id(100);
set local role authenticated;
select is(pg_temp.row('POLAR')->>'distance_km','0.0','coincident polar positions stay finite and round to zero');
reset role;
update public.locations set longitude=null where id=pg_temp.id(100);
set local role authenticated;
select is((select count(*) from jsonb_array_elements(pg_temp.locator()->'rows') r where r->'distance_km'<>'null'::jsonb),0::bigint,'missing receiver coordinate makes all distances unknown');
reset role;
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone)
select pg_temp.id(300+n),pg_temp.id(1),'PAGE-'||lpad(n::text,2,'0'),'Paging source','branch','SA','Asia/Riyadh' from generate_series(1,60) n;
set local role authenticated;
select is(pg_temp.locator('{"view":"all","q":"PAGE"}')->>'total','60','paging counts permitted source locations');
select is(jsonb_array_length(pg_temp.locator('{"view":"all","q":"PAGE"}')->'rows'),25,'default page returns 25 rows');
select is(jsonb_array_length(pg_temp.locator('{"view":"all","q":"PAGE"}',1,50)->'rows'),50,'50-row page supported');
select is(jsonb_array_length(pg_temp.locator('{"view":"all","q":"PAGE"}',1,100)->'rows'),60,'100-row page supported');
select is(pg_temp.locator('{"view":"all","q":"PAGE"}',999)->>'page','3','deep page clamps to final page');
select is((select count(*) from (select value->>'id' from jsonb_array_elements(pg_temp.locator('{"view":"all","q":"PAGE"}')->'rows') intersect select value->>'id' from jsonb_array_elements(pg_temp.locator('{"view":"all","q":"PAGE"}',2)->'rows')) repeated),0::bigint,'stable paging has no duplicate sources');
reset role;
delete from public.memberships where organization_id=pg_temp.id(1) and user_id=pg_temp.id(11);
select pg_temp.login(11);
set local role authenticated;
select throws_ok($$select pg_temp.locator()$$,'MQ404',null,'membership removal takes effect despite stale claims');
reset role;
select * from finish();
rollback;
