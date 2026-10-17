begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('a8800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer default 1) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'interchange-locator-'||n||'@test.local' from generate_series(10,13) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'inter-locator-a','A'),(pg_temp.id(2),'inter-locator-b','B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),
 (pg_temp.id(1),pg_temp.id(12),'branch_user'),(pg_temp.id(2),pg_temp.id(13),'owner');
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency,status)
select pg_temp.id(50+n),pg_temp.id(case when n=10 then 2 else 1 end),code,'Item '||code,'Test',unit,1,'SAR',status
from (values (0,'A','EA','active'),(1,'B','EA','phase_out'),(2,'C','EA','discontinued'),(3,'D','EA','new'),
 (4,'KG-BRIDGE','KG','active'),(5,'BEHIND-KG','EA','active'),(6,'ONE-OUT','EA','active'),
 (7,'ONE-IN','EA','active'),(8,'SUCCESSOR','EA','active'),(9,'UNRELATED','EA','active'),(10,'A','EA','active')) v(n,code,unit,status);
insert into public.item_interchanges(id,organization_id,item_id,alternate_item_id,direction,priority)
select pg_temp.id(200+n),pg_temp.id(case when n=10 then 2 else 1 end),pg_temp.id(50+a),pg_temp.id(50+b),direction,priority
from (values (0,0,1,'two_way',99),(1,2,1,'two_way',1),(2,2,0,'two_way',2),
 (3,1,3,'two_way',3),(4,2,3,'two_way',1),(5,0,4,'two_way',1),(6,4,5,'two_way',1),
 (7,0,6,'one_way',1),(8,7,0,'one_way',1)) v(n,a,b,direction,priority);
insert into public.item_supersessions(organization_id,predecessor_item_id,successor_item_id,effective_on,quantity_factor)
values(pg_temp.id(1),pg_temp.id(50),pg_temp.id(58),'2026-01-01',1);
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
 (9,1,'2026-10-17','900','0','EA'),(1,0,'2026-10-17','900','0','EA'),(1,4,'2026-10-17','900','0','EA')) v(i,l,day,q,a,unit);
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,unit_cost,currency,unit_of_measure)
values(pg_temp.id(2),pg_temp.id(60),pg_temp.id(105),'2026-10-17',999,1,'SAR','EA');
insert into public.network_links(organization_id,from_location_id,to_location_id,lead_time_days_p50,lead_time_days_p90)
values(pg_temp.id(1),pg_temp.id(101),pg_temp.id(100),0,3);
create function pg_temp.locator(filters jsonb default '{}',page integer default 1,size integer default 25,unit text default 'EA',day date default '2026-10-17',code text default 'A')
returns jsonb language sql as $$select public.stock_locator(pg_temp.id(1),code,'RECEIVER',unit,day,'{"scope":"interchangeable","view":"all"}'::jsonb||filters,page,size)$$;
create function pg_temp.row(item text,location text) returns jsonb language sql as $$select value from jsonb_array_elements(pg_temp.locator()->'rows') where value#>>'{item,code}'=item and value->>'code'=location$$;
create temporary table before_reads as select
 (select jsonb_agg(to_jsonb(s) order by id) from public.stock_snapshots s) stock,
 (select jsonb_agg(to_jsonb(e) order by id) from public.item_interchanges e) edges,
 (select count(*) from public.audit_log) audits,(select count(*) from public.redistribution_drafts) drafts;
select pg_temp.login(10);
set local role authenticated;
select is(pg_temp.locator()->>'item_count','4','cycle and diamond yield four unique candidates');
select is(pg_temp.locator()->>'total','12','each eligible item has separate permitted active source observations');
select is(pg_temp.locator()#>>'{counts,matching}','4','only fresh positive supplied-unit observations match');
select is(pg_temp.locator()#>>'{counts,other}','8','all missing and incompatible observations remain inspectable');
select is(pg_temp.locator()#>>'{rows,0,item,code}','B','closer alternative ranks ahead of farther exact item');
select is(pg_temp.locator()#>>'{rows,1,item,code}','A','same-distance rows have stable item code tie-break');
select is(pg_temp.locator()#>>'{rows,2,item,code}','B','same source has separate item rows');
select is(pg_temp.locator()#>>'{rows,3,code}','NOGEO','matching unknown-distance source ranks last among matches');
select is(pg_temp.row('B','NEAR')#>>'{snapshot,net}','900719925474099.001','alternative quantities preserve exact precision');
select is(pg_temp.row('A','FAR')#>>'{snapshot,net}','5.000','quantities are not pooled across items');
select is(pg_temp.row('B','NEAR')->>'match_kind','interchangeable','alternative is labeled');
select is(pg_temp.row('A','FAR')->>'match_kind','exact','exact item is labeled');
select is(pg_temp.row('A','FAR')->'relationship_path','[]'::jsonb,'exact item has no manufactured connection');
select is(jsonb_array_length(pg_temp.row('D','NOGEO')->'relationship_path'),2,'transitive item retains a two-link path');
select is(pg_temp.row('D','NOGEO')#>>'{relationship_path,0,to_code}','B','equal-hop paths use deterministic parent identity');
select is(pg_temp.row('D','NOGEO')#>>'{relationship_path,1,to_code}','D','path reaches the observed item');
select is(pg_temp.row('D','NOGEO')#>>'{relationship_path,0,priority}','99','priority is evidence, not a distance or path preference');
select is(pg_temp.row('C','NEAR')#>>'{relationship_path,0,from_code}','A','two-way edge can be traversed in reverse');
select is(pg_temp.row('C','NEAR')#>>'{item,status}','discontinued','recorded lifecycle status stays visible, not inferred away');
select is(pg_temp.row('B','NEAR')#>>'{item,status}','phase_out','phase-out status stays visible');
select is(pg_temp.row('D','NOGEO')#>>'{item,status}','new','new status stays visible');
select is(pg_temp.row('B','NEAR')#>>'{lane,p50}','0','same current lane is retained for alternatives');
select is(pg_temp.row('B','FAR')->>'status','matching','seven-day alternative observation accepted');
select is(pg_temp.row('C','FAR')->>'status','stale','eight-day alternative observation separated');
select is(pg_temp.row('B','NOGEO')->>'status','unit_unknown','missing supplied unit never inherits catalog unit');
select is(pg_temp.row('D','NEAR')->>'status','unit_mismatch','latest incompatible unit never falls back');
select is(pg_temp.row('C','NEAR')->>'status','no_stock','latest zero never falls back');
select is(pg_temp.row('C','NOGEO')#>>'{snapshot,net}','-2.000','negative net evidence preserved');
select is(pg_temp.row('D','FAR')->>'status','missing','future-only stock remains missing');
select is((select count(*) from jsonb_array_elements(pg_temp.locator()->'rows') r where r#>>'{item,code}' in('KG-BRIDGE','BEHIND-KG','ONE-OUT','ONE-IN','SUCCESSOR','UNRELATED')),0::bigint,'mismatched bridge, both one-way directions, supersession and unrelated stock excluded');
select is(pg_temp.locator('{"scope":"exact"}')->>'total','3','explicit exact mode keeps one item across sources');
select is(public.stock_locator(pg_temp.id(1),'A','RECEIVER','EA','2026-10-17')->>'scope','exact','omitted scope stays exact-only');
select is(pg_temp.locator('{}',1,25,'KG')->>'relationship_status','unit_mismatch','seed catalog mismatch prevents alternative expansion');
select is(pg_temp.locator('{}',1,25,'KG')->>'item_count','1','mismatch still permits exact-item observations');
select is(pg_temp.locator('{}',1,25,'EA','2026-10-16')->>'item_count','4','historical snapshot date uses current unversioned graph explicitly');
select is(pg_temp.locator('{"q":"near"}')->>'total','4','source search preserves separate candidate observations');
select is(pg_temp.locator('{"view":"matching"}')->>'total','4','matching view filters observations');
select is(pg_temp.locator('{"view":"other"}')->>'total','8','other view retains eight observations');
select throws_ok($$select pg_temp.locator('{"scope":"supersessions"}')$$,'MQ422',null,'unknown scope rejected');
select throws_ok($$select pg_temp.locator('{"scope":null}')$$,'MQ422',null,'null scope rejected');
select pg_temp.login(11);
select is(pg_temp.locator()->>'total','12','viewer can inspect alternatives');
select pg_temp.login(12);
select throws_ok($$select pg_temp.locator()$$,'MQ404',null,'branch needs receiving access');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(100));
set local role authenticated;
select is(pg_temp.locator()->>'total','0','receiver-only cannot reveal any source observations or counts');
select is(pg_temp.locator()#>>'{counts,matching}','0','matching count preserves branch restrictions');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(101));
set local role authenticated;
select is(pg_temp.locator()->>'total','4','both-location access exposes only one source for four items');
select is(pg_temp.locator()#>>'{counts,matching}','1','alternative counts preserve branch restrictions');
reset role;
delete from public.membership_locations where user_id=pg_temp.id(12) and location_id=pg_temp.id(100);
set local role authenticated;
select throws_ok($$select pg_temp.locator()$$,'MQ404',null,'source-only cannot inspect receiver');
select pg_temp.login(13,2);
select throws_ok($$select pg_temp.locator()$$,'MQ404',null,'cross-tenant graph cannot be requested');
reset role;
select is((select jsonb_agg(to_jsonb(s) order by id) from public.stock_snapshots s),(select stock from before_reads),'reads do not change stock');
select is((select jsonb_agg(to_jsonb(e) order by id) from public.item_interchanges e),(select edges from before_reads),'reads do not change relationships');
select is((select count(*) from public.audit_log),(select audits from before_reads),'reads add no audits');
select is((select count(*) from public.redistribution_drafts),(select drafts from before_reads),'reads add no transfer drafts');
-- Unit mismatch blocks a connection, even when a matching unit exists beyond it.
update public.items set unit_of_measure='KG' where id in(pg_temp.id(51),pg_temp.id(52));
select pg_temp.login(10);
set local role authenticated;
select is(pg_temp.locator()->>'item_count','1','all paths through incompatible intermediate units are blocked');
reset role;
update public.items set unit_of_measure='EA' where id in(pg_temp.id(51),pg_temp.id(52));
update public.item_interchanges set direction='one_way' where id=pg_temp.id(200);
set local role authenticated;
select is(pg_temp.locator()->>'item_count','4','another eligible two-way route remains available');
select is(jsonb_array_length(pg_temp.row('B','NEAR')->'relationship_path'),2,'changed graph is reflected without a stale cached direct path');
reset role;
-- A bounded 100-item chain, with cycles in the earlier fixture, exercises expansion and paging.
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
select pg_temp.id(1000+n),pg_temp.id(1),'CHAIN-'||lpad(n::text,3,'0'),'Chain item','Test','EA',1,'SAR' from generate_series(1,101) n;
insert into public.item_interchanges(organization_id,item_id,alternate_item_id,direction)
select pg_temp.id(1),pg_temp.id(1000+n),pg_temp.id(1001+n),'two_way' from generate_series(1,99) n;
set local role authenticated;
select is(pg_temp.locator('{}',1,25,'EA','2026-10-17','CHAIN-001')->>'item_count','100','100-item connected graph is supported');
select is(pg_temp.locator('{}',1,25,'EA','2026-10-17','CHAIN-001')->>'total','300','100 candidates retain three separate locations');
select is(jsonb_array_length(pg_temp.locator('{}',1,25,'EA','2026-10-17','CHAIN-001')->'rows'),25,'expanded rows stay paginated');
select is(pg_temp.locator('{}',999,100,'EA','2026-10-17','CHAIN-001')->>'page','3','expanded paging clamps deterministically');
select is((select count(*) from (
 select value->>'id',value#>>'{item,id}' from jsonb_array_elements(pg_temp.locator('{}',1,100,'EA','2026-10-17','CHAIN-001')->'rows')
 intersect select value->>'id',value#>>'{item,id}' from jsonb_array_elements(pg_temp.locator('{}',2,100,'EA','2026-10-17','CHAIN-001')->'rows')) overlap),0::bigint,'paging has no duplicate item-location pairs');
reset role;
insert into public.item_interchanges(organization_id,item_id,alternate_item_id,direction) values(pg_temp.id(1),pg_temp.id(1100),pg_temp.id(1101),'two_way');
set local role authenticated;
select throws_ok($$select pg_temp.locator('{}',1,25,'EA','2026-10-17','CHAIN-001')$$,'MQ422','interchange group exceeds 100 items','101-item graph fails visibly without partial results');
select is(pg_temp.locator('{"scope":"exact"}',1,25,'EA','2026-10-17','CHAIN-001')->>'item_count','1','exact lookup remains usable for oversized groups');
reset role;
select * from finish();
rollback;
