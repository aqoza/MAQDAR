begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('a8900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer default 1) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'direct-locator-'||n||'@test.local' from generate_series(10,13) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'direct-locator-a','A'),(pg_temp.id(2),'direct-locator-b','B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),
 (pg_temp.id(1),pg_temp.id(12),'branch_user'),(pg_temp.id(2),pg_temp.id(13),'owner');
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency,status)
select pg_temp.id(50+n),pg_temp.id(case when n=11 then 2 else 1 end),code,'Item '||code,'Test',unit,1,'SAR',status
from (values (0,'A','EA','active'),(1,'B','EA','phase_out'),(2,'C','EA','discontinued'),(3,'D','EA','new'),
 (4,'KG','KG','active'),(5,'CHAIN','EA','active'),(6,'INCOMING','EA','active'),
 (7,'TWO-WAY','EA','active'),(8,'BRIDGED','EA','active'),(9,'SUCCESSOR','EA','active'),
 (10,'BEHIND-KG','EA','active'),(11,'A','EA','active')) v(n,code,unit,status);
insert into public.item_interchanges(id,organization_id,item_id,alternate_item_id,direction,priority,note)
select pg_temp.id(200+n),pg_temp.id(1),pg_temp.id(50+a),pg_temp.id(50+b),direction,priority,note
from (values (0,0,1,'one_way',99,'Check the recorded application before issue.'),
 (1,0,2,'one_way',1,null),(2,0,3,'one_way',2,null),(3,1,5,'one_way',1,null),
 (4,6,0,'one_way',1,null),(5,0,7,'two_way',1,null),(6,7,8,'one_way',1,null),
 (7,0,4,'one_way',1,null),(8,4,10,'one_way',1,null),(9,3,5,'two_way',1,null),
 (10,5,0,'one_way',1,null)) v(n,a,b,direction,priority,note);
insert into public.item_supersessions(organization_id,predecessor_item_id,successor_item_id,effective_on,quantity_factor)
values(pg_temp.id(1),pg_temp.id(50),pg_temp.id(59),'2026-01-01',1);
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone,latitude,longitude,is_active)
select pg_temp.id(100+n),pg_temp.id(case when n=5 then 2 else 1 end),code,code,'branch','SA','Asia/Riyadh',lat,lon,n<>4
from (values(0,'RECEIVER',0.0,0.0),(1,'NEAR',0.0,0.1),(2,'FAR',0.0,1.0),(3,'NOGEO',null,null),
 (4,'INACTIVE',0.0,0.01),(5,'OTHERORG',0.0,0.02)) v(n,code,lat,lon);
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
select pg_temp.id(1),pg_temp.id(50+i),pg_temp.id(100+l),day::date,q::numeric,a::numeric,1,'SAR',unit
from (values
 (0,2,'2026-10-17','7','2','EA'),(1,1,'2026-10-17','900719925474099.125','0.124','EA'),
 (1,2,'2026-10-10','12','0','EA'),(1,3,'2026-10-17','20','0',null),
 (2,1,'2026-10-16','50','0','EA'),(2,1,'2026-10-17','0','0','EA'),
 (2,2,'2026-10-09','12','0','EA'),(2,3,'2026-10-17','1','3','EA'),
 (3,1,'2026-10-16','50','0','EA'),(3,1,'2026-10-17','9','0','KG'),
 (3,2,'2026-10-18','12','0','EA'),(3,3,'2026-10-17','2','0','EA'),
 (4,1,'2026-10-17','900','0','EA'),(5,1,'2026-10-17','900','0','EA'),
 (6,1,'2026-10-17','900','0','EA'),(7,1,'2026-10-17','900','0','EA'),(8,1,'2026-10-17','900','0','EA'),
 (9,1,'2026-10-17','900','0','EA'),(10,1,'2026-10-17','900','0','EA'),(1,0,'2026-10-17','900','0','EA'),
 (1,4,'2026-10-17','900','0','EA')) v(i,l,day,q,a,unit);
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,unit_cost,currency,unit_of_measure)
values(pg_temp.id(2),pg_temp.id(61),pg_temp.id(105),'2026-10-17',999,1,'SAR','EA');
insert into public.network_links(organization_id,from_location_id,to_location_id,lead_time_days_p50,lead_time_days_p90)
values(pg_temp.id(1),pg_temp.id(101),pg_temp.id(100),0,3);
create function pg_temp.locator(filters jsonb default '{}',page integer default 1,size integer default 25,unit text default 'EA',day date default '2026-10-17',code text default 'A')
returns jsonb language sql as $$select public.stock_locator(pg_temp.id(1),code,'RECEIVER',unit,day,'{"scope":"substitutes","view":"all"}'::jsonb||filters,page,size)$$;
create function pg_temp.row(item text,location text) returns jsonb language sql as $$select value from jsonb_array_elements(pg_temp.locator()->'rows') where value#>>'{item,code}'=item and value->>'code'=location$$;
create temporary table before_reads as select
 (select jsonb_agg(to_jsonb(s) order by id) from public.stock_snapshots s) stock,
 (select jsonb_agg(to_jsonb(e) order by id) from public.item_interchanges e) edges,
 (select count(*) from public.audit_log) audits,(select count(*) from public.redistribution_drafts) drafts;
select pg_temp.login(10);
set local role authenticated;
select is(pg_temp.locator()->>'scope','substitutes','direct mode is explicit');
select is(pg_temp.locator()->>'item_count','4','only the seed and three outgoing same-unit alternatives qualify');
select is(pg_temp.locator()->>'total','12','each item has separate permitted active source observations');
select is(pg_temp.locator()#>>'{counts,matching}','4','only fresh positive supplied-unit observations match');
select is(pg_temp.locator()#>>'{counts,other}','8','missing and incompatible observations remain inspectable');
select is(pg_temp.locator()#>>'{rows,0,item,code}','B','closer alternate ranks ahead of farther exact item despite priority 99');
select is(pg_temp.locator()#>>'{rows,1,item,code}','A','stable same-distance item-code tie-break');
select is(pg_temp.locator()#>>'{rows,2,item,code}','B','same location retains separate item rows');
select is(pg_temp.locator()#>>'{rows,3,code}','NOGEO','matching unknown distance follows known distances');
select is(pg_temp.row('B','NEAR')#>>'{snapshot,net}','900719925474099.001','substitute quantities retain exact precision');
select is(pg_temp.row('A','FAR')#>>'{snapshot,net}','5.000','exact stock is not pooled with substitutes');
select is(pg_temp.row('B','NEAR')->>'match_kind','substitute','direct substitute label is distinct from interchangeable');
select is(pg_temp.row('A','FAR')->>'match_kind','exact','seed remains exact');
select is(pg_temp.row('A','FAR')->'relationship_path','[]'::jsonb,'exact stock has no manufactured relationship');
select is(jsonb_array_length(pg_temp.row('B','NEAR')->'relationship_path'),1,'direct evidence has exactly one edge');
select is(pg_temp.row('B','NEAR')#>>'{relationship_path,0,direction}','one_way','evidence retains one-way direction');
select is(pg_temp.row('B','NEAR')#>>'{relationship_path,0,from_code}','A','requested item is the origin');
select is(pg_temp.row('B','NEAR')#>>'{relationship_path,0,to_code}','B','observed item is the alternate');
select is(pg_temp.row('B','NEAR')#>>'{relationship_path,0,priority}','99','recorded priority is preserved as evidence');
select is(pg_temp.row('B','NEAR')#>>'{relationship_path,0,note}','Check the recorded application before issue.','notes remain inspectable');
select ok((pg_temp.row('B','NEAR')#>>'{relationship_path,0,updated_at}') is not null,'relationship update evidence is present');
select ok((pg_temp.row('B','NEAR')#>>'{relationship_path,0,from_updated_at}') is not null,'origin catalog update evidence is present');
select ok((pg_temp.row('B','NEAR')#>>'{relationship_path,0,to_updated_at}') is not null,'alternate catalog update evidence is present');
select is(pg_temp.row('B','NEAR')#>>'{item,status}','phase_out','phase-out status is shown');
select is(pg_temp.row('C','NEAR')#>>'{item,status}','discontinued','discontinued status is not inferred away');
select is(pg_temp.row('D','NOGEO')#>>'{item,status}','new','new status is shown');
select is(pg_temp.row('B','NEAR')#>>'{lane,p50}','0','current directed lane remains an independent reference');
select is(pg_temp.row('B','FAR')->>'status','matching','seven-day observation accepted');
select is(pg_temp.row('C','FAR')->>'status','stale','eight-day observation separated');
select is(pg_temp.row('B','NOGEO')->>'status','unit_unknown','missing supplied unit never inherits catalog unit');
select is(pg_temp.row('D','NEAR')->>'status','unit_mismatch','latest incompatible unit never falls back');
select is(pg_temp.row('C','NEAR')->>'status','no_stock','latest zero never falls back');
select is(pg_temp.row('C','NOGEO')#>>'{snapshot,net}','-2.000','negative net evidence preserved');
select is(pg_temp.row('D','FAR')->>'status','missing','future-only stock remains missing');
select is((select count(*) from jsonb_array_elements(pg_temp.locator()->'rows') r where r#>>'{item,code}' in('KG','CHAIN','INCOMING','TWO-WAY','BRIDGED','SUCCESSOR','BEHIND-KG')),0::bigint,'reverse, chained, mixed, two-way, unit bridge and supersession paths excluded');
select is(pg_temp.locator('{}',1,25,'EA','2026-10-17','C')->>'item_count','1','requesting an alternate never reverses its incoming link');
select is(pg_temp.locator('{}',1,25,'EA','2026-10-17','B')->>'item_count','2','B has only its own explicit outgoing alternate, not incoming A');
select is(pg_temp.locator('{"scope":"exact"}')->>'item_count','1','exact mode remains seed-only');
select is(pg_temp.locator('{"scope":"interchangeable"}')->>'item_count','2','two-way mode follows only its own connected group');
select is(public.stock_locator(pg_temp.id(1),'A','RECEIVER','EA','2026-10-17')->>'scope','exact','omitted scope remains exact');
select is(pg_temp.locator('{}',1,25,'KG')->>'relationship_status','unit_mismatch','seed unit mismatch blocks alternatives');
select is(pg_temp.locator('{}',1,25,'KG')->>'item_count','1','exact observations remain available on catalog mismatch');
select is(pg_temp.locator('{}',1,25,'EA','2026-10-16')->>'item_count','4','historical stock date uses explicitly current relationships');
select is(pg_temp.locator('{"q":"near"}')->>'total','4','source search preserves candidate observations');
select is(pg_temp.locator('{"view":"matching"}')->>'total','4','matching view filters correctly');
select is(pg_temp.locator('{"view":"other"}')->>'total','8','other view retains unavailable evidence');
select pg_temp.login(11);
select is(pg_temp.locator()->>'total','12','viewers can inspect direct alternatives');
select pg_temp.login(12);
select throws_ok($$select pg_temp.locator()$$,'MQ404',null,'branch needs receiving access');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(100));
set local role authenticated;
select is(pg_temp.locator()->>'total','0','receiver-only cannot reveal source observations');
select is(pg_temp.locator()#>>'{counts,matching}','0','counts preserve branch restrictions');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(101));
set local role authenticated;
select is(pg_temp.locator()->>'total','4','both-location access exposes one source for four items');
select is(pg_temp.locator()#>>'{counts,matching}','1','matching counts preserve branch restrictions');
reset role;
delete from public.membership_locations where user_id=pg_temp.id(12) and location_id=pg_temp.id(100);
set local role authenticated;
select throws_ok($$select pg_temp.locator()$$,'MQ404',null,'source-only cannot inspect receiver');
select pg_temp.login(13,2);
select throws_ok($$select pg_temp.locator()$$,'MQ404',null,'cross-tenant graph unavailable');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.locator()$$,'MQ404',null,'active claim cannot broaden membership');
reset role;
select is((select jsonb_agg(to_jsonb(s) order by id) from public.stock_snapshots s),(select stock from before_reads),'reads do not change stock');
select is((select jsonb_agg(to_jsonb(e) order by id) from public.item_interchanges e),(select edges from before_reads),'reads do not change relationships');
select is((select count(*) from public.audit_log),(select audits from before_reads),'reads add no audits');
select is((select count(*) from public.redistribution_drafts),(select drafts from before_reads),'reads add no drafts');
-- Current catalog changes are re-evaluated, without caching the old direction or units.
update public.items set unit_of_measure='KG' where id=pg_temp.id(51);
select pg_temp.login(10);
set local role authenticated;
select is(pg_temp.locator()->>'item_count','3','changed alternate unit excludes it despite matching supplied stock');
reset role;
update public.items set unit_of_measure='EA' where id=pg_temp.id(51);
update public.item_interchanges set item_id=pg_temp.id(51),alternate_item_id=pg_temp.id(50) where id=pg_temp.id(200);
set local role authenticated;
select is(pg_temp.locator()->>'item_count','3','reversing the current relationship excludes the old alternate');
reset role;
update public.item_interchanges set item_id=pg_temp.id(50),alternate_item_id=pg_temp.id(51),direction='two_way' where id=pg_temp.id(200);
set local role authenticated;
select is(pg_temp.locator()->>'item_count','3','changing to two-way does not include it in direct mode');
reset role;
-- Bound counts the seed; overflow is explicit, never partial results.
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
select pg_temp.id(1000+n),pg_temp.id(1),'LIMIT-'||lpad(n::text,3,'0'),'Limit item','Test','EA',1,'SAR' from generate_series(0,100) n;
insert into public.item_interchanges(organization_id,item_id,alternate_item_id,direction)
select pg_temp.id(1),pg_temp.id(1000),pg_temp.id(1000+n),'one_way' from generate_series(1,99) n;
set local role authenticated;
select is(pg_temp.locator('{}',1,25,'EA','2026-10-17','LIMIT-000')->>'item_count','100','99 direct alternatives plus seed supported');
select is(pg_temp.locator('{}',1,25,'EA','2026-10-17','LIMIT-000')->>'total','300','bounded results retain three separate sources');
select is(jsonb_array_length(pg_temp.locator('{}',1,25,'EA','2026-10-17','LIMIT-000')->'rows'),25,'expanded results stay paginated');
select is(pg_temp.locator('{}',999,100,'EA','2026-10-17','LIMIT-000')->>'page','3','paging clamps deterministically');
select is((select count(*) from (
 select value->>'id',value#>>'{item,id}' from jsonb_array_elements(pg_temp.locator('{}',1,100,'EA','2026-10-17','LIMIT-000')->'rows')
 intersect select value->>'id',value#>>'{item,id}' from jsonb_array_elements(pg_temp.locator('{}',2,100,'EA','2026-10-17','LIMIT-000')->'rows')) overlap),0::bigint,'paging never duplicates item/location pairs');
reset role;
insert into public.item_interchanges(organization_id,item_id,alternate_item_id,direction) values(pg_temp.id(1),pg_temp.id(1000),pg_temp.id(1100),'one_way');
set local role authenticated;
select throws_ok($$select pg_temp.locator('{}',1,25,'EA','2026-10-17','LIMIT-000')$$,'MQ422','direct substitute search exceeds 100 items','100 direct alternatives fail visibly without truncation');
select is(pg_temp.locator('{"scope":"exact"}',1,25,'EA','2026-10-17','LIMIT-000')->>'item_count','1','exact mode remains usable on overflow');
select is(pg_temp.locator('{"scope":"interchangeable"}',1,25,'EA','2026-10-17','LIMIT-000')->>'item_count','1','overflowing direct links do not affect two-way mode');
reset role;
select * from finish();
rollback;
