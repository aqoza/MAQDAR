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
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
 values(pg_temp.id(101),pg_temp.id(1),'OTHER','Other','Test','KG',999,'SAR');
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
 values(pg_temp.id(1),pg_temp.id(101),pg_temp.id(20),'2026-10-10',5,1,2,'SAR','EA');
create temp table captured(source jsonb,output jsonb);
insert into captured select jsonb_build_object('items',jsonb_build_array(
 jsonb_build_object('item_id',pg_temp.id(100),'item_code','ITEM','unit','EA','unit_provenance',app.demand_unit_evidence(2,0,array['EA'])),
 jsonb_build_object('item_id',pg_temp.id(101),'item_code','OTHER','unit','EA','unit_provenance',app.demand_unit_evidence(0,0,array[]::text[]))),
 'interchanges',jsonb_build_array(jsonb_build_object('item',pg_temp.id(100),'alternate',pg_temp.id(101),'direction','two_way'))),
 jsonb_build_object('status','ready','unit','EA','contributors',jsonb_build_array(jsonb_build_object('item_id',pg_temp.id(100),'factor','1'),jsonb_build_object('item_id',pg_temp.id(101),'factor','1')));
create function pg_temp.evidence() returns jsonb language sql as $$select app.prepared_stock_evidence(source,output) from captured$$;
select is(pg_temp.evidence()->>'status','eligible','an empty confirmed member adds no invented demand rows');
select is(pg_temp.evidence()->'unit_provenance'->>'rows','2','recorded observations counted once');
select is((select app.prepared_stock_evidence(source #- '{items,0,unit_provenance}',output)->>'status' from captured),'unknown_evidence','legacy preparation cannot infer provenance');
select is((select app.prepared_stock_evidence(jsonb_set(source,'{items,0,unit_provenance}',app.demand_unit_evidence(2,1,array['EA'])),output)->>'status' from captured),'unknown_units','partly unlabeled history cannot pool');
select is((select app.prepared_stock_evidence(jsonb_set(source,'{items,0,unit_provenance}',app.demand_unit_evidence(2,0,array['EA','KG'])),output)->>'status' from captured),'unknown_units','conflicting units cannot pool');
select is((select app.prepared_stock_evidence(jsonb_set(source,'{items,0,unit_provenance}',app.demand_unit_evidence(0,0,array[]::text[])),output)->>'status' from captured),'unknown_units','entirely empty group remains unknown');
select is((select app.prepared_stock_evidence(jsonb_set(source,'{interchanges,0,direction}','"one_way"'),output)->>'status' from captured),'not_interchangeable','one-way substitution never authorizes pooling');
select is((select app.prepared_stock_evidence(jsonb_set(source,'{interchanges}','[]'),output)->>'status' from captured),'not_interchangeable','factor one alone does not prove interchangeability');
select is((select app.prepared_stock_evidence(source,jsonb_set(output,'{contributors,0,factor}','"2"'))->>'status' from captured),'not_interchangeable','nonidentity conversions cannot pool');
select is((select app.prepared_stock_evidence(jsonb_set(source,'{items,1,unit}','"KG"'),output)->>'status' from captured),'not_interchangeable','all saved catalog units must match');
with fixture as (
 select jsonb_build_object('items',(select jsonb_agg(jsonb_build_object('item_id',pg_temp.id(100+n),'item_code','I'||n,'unit','EA',
   'unit_provenance',app.demand_unit_evidence(1,0,array['EA']))) from generate_series(0,99) n),
   'interchanges',(select jsonb_agg(jsonb_build_object('item',pg_temp.id(100+n),'alternate',pg_temp.id(101+n),'direction','two_way')) from generate_series(0,98) n)) source,
   jsonb_build_object('status','ready','unit','EA','contributors',(select jsonb_agg(jsonb_build_object('item_id',pg_temp.id(100+n),'factor','1')) from generate_series(0,99) n)) output
)
select is(app.prepared_stock_evidence(source,output)->>'status','eligible','100-member transitive two-way chain is bounded and eligible') from fixture;
with outsider as (
 select jsonb_set(source,'{interchanges}',jsonb_build_array(
   jsonb_build_object('item',pg_temp.id(100),'alternate',pg_temp.id(999),'direction','two_way'),
   jsonb_build_object('item',pg_temp.id(999),'alternate',pg_temp.id(101),'direction','two_way'))) source,output from captured
)
select is(app.prepared_stock_evidence(source,output)->>'status','not_interchangeable','edges through members outside the saved group do not authorize pooling') from outsider;
update public.inventory_policies set evidence=jsonb_build_object('forecast',jsonb_build_object('to_date','2026-10-10','method','regional-v1',
 'source',jsonb_build_object('preparation',jsonb_build_object('stock_pool',pg_temp.evidence())))) where id=pg_temp.id(50);
set local role authenticated;
select pg_temp.login(11,1);
select is(pg_temp.compare()->>'status','available','viewer can compare saved group independently of current catalog labels');
select is(pg_temp.compare()->>'quantity_above','7.000','(12-2)+(5-1)-7 = 7');
select is(pg_temp.compare()->'pool'->>'available','14.000','pool counts each saved member once');
select is(pg_temp.compare()->>'value_above',null,'no invented cost allocation for pooled excess');
select is(pg_temp.compare()->'pool'->'inventory_values','[{"currency":"KWD","value":"13.500000"},{"currency":"SAR","value":"10.000000"}]'::jsonb,'physical inventory value separated by currency');
select is(pg_temp.compare()->'pool'->'members'->0->'snapshot'->>'age','7','seven day boundary; future stock excluded');
select is(pg_temp.compare('2026-10-10','approved',pg_temp.id(61))->>'quantity_above','6.000','exact selected revision, not the newest');
select is(pg_temp.compare('2026-10-09')->>'status','date_mismatch','prepared policy cutoff enforced');
select is(pg_temp.compare('2026-10-09')->>'quantity_above',null,'mismatched cutoff has no total');
select throws_ok($$select pg_temp.compare('2026-10-10','approved',pg_temp.id(999))$$,'MQ404',null,'unknown override denied');
select throws_ok($$select public.policy_stock_comparison(pg_temp.id(1),pg_temp.id(51),'2026-10-10','approved',pg_temp.id(61))$$,'MQ404',null,'foreign policy override denied');
select pg_temp.login(12,1);
select throws_ok($$select pg_temp.compare()$$,'MQ404',null,'group comparison respects branch restrictions');
select pg_temp.login(13,2);
select throws_ok($$select pg_temp.compare()$$,'MQ404',null,'group comparison respects tenant restrictions');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.compare()$$,'MQ404',null,'active organization claim cannot widen access');
reset role;
select pg_temp.login(10,1);
update public.stock_snapshots set quantity=1,allocated_quantity=3 where item_id=pg_temp.id(101);
select is(pg_temp.compare()->>'quantity_above','1.000','member deficit reduces pool before final clamp');
update public.stock_snapshots set allocated_quantity=30 where item_id=pg_temp.id(101);
select is(pg_temp.compare()->>'quantity_above','0','valid zero differs from unavailable');
update public.stock_snapshots set quantity=5,allocated_quantity=1,snapshot_date='2026-10-02' where item_id=pg_temp.id(101);
select is(pg_temp.compare()->>'status','stock_stale','one stale member invalidates entire group');
select is(pg_temp.compare()->'pool'->>'available',null,'no partial pooled availability');
select is(pg_temp.compare()->'pool'->'inventory_values','[]'::jsonb,'no misleading partial inventory totals');
select is(pg_temp.compare()->'pool'->'members'->1->>'status','stock_stale','member diagnostic identifies stale source');
update public.stock_snapshots set snapshot_date='2026-10-10',unit_of_measure=null where item_id=pg_temp.id(101);
select is(pg_temp.compare()->>'status','stock_unit_unknown','one unknown member unit prevents comparison');
update public.stock_snapshots set unit_of_measure='SET' where item_id=pg_temp.id(101);
select is(pg_temp.compare()->>'status','unit_mismatch','no automatic conversion of member snapshots');
delete from public.stock_snapshots where item_id=pg_temp.id(101);
select is(pg_temp.compare()->>'status','stock_missing','missing member never shrinks group');
select is(pg_temp.compare()->>'quantity_above',null,'missing is not zero');
select is(jsonb_array_length(pg_temp.compare()->'pool'->'members'),2,'missing member remains visible');
update public.inventory_policies set evidence=jsonb_set(evidence,'{forecast,source,preparation,stock_pool,status}','"not_interchangeable"') where id=pg_temp.id(50);
select is(pg_temp.compare()->>'status','group_not_interchangeable','supersession group explains its exclusion');
update public.inventory_policies set evidence=jsonb_set(evidence,'{forecast,source,preparation,stock_pool,status}','"unknown_units"') where id=pg_temp.id(50);
select is(pg_temp.compare()->>'status','policy_unit_unknown','unknown demand units explained');
update public.inventory_policies set evidence=evidence #- '{forecast,source,preparation,stock_pool}' where id=pg_temp.id(50);
select is(pg_temp.compare()->>'status','prepared_group','legacy policy remains non-comparable');
select ok(not has_function_privilege('authenticated','app.prepared_stock_evidence(jsonb,jsonb)','EXECUTE'),'private evidence helper is not a session capability');
select ok(not has_function_privilege('zeespare_worker','app.prepared_stock_evidence(jsonb,jsonb)','EXECUTE'),'worker gains no direct capability');
select ok((select not prosecdef from pg_proc where oid='public.policy_stock_comparison(uuid,uuid,date,text,uuid)'::regprocedure),'comparison remains invoker with RLS');
select * from finish();
rollback;
