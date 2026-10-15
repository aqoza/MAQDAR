begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('94000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'kpi-'||n||'@test.local' from generate_series(10,13) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'kpi-a','KPI A'),(pg_temp.id(2),'kpi-b','KPI B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),
 (pg_temp.id(1),pg_temp.id(12),'branch_user'),(pg_temp.id(2),pg_temp.id(13),'owner');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone,is_active)
 select pg_temp.id(20+n),pg_temp.id(case when n=3 then 2 else 1 end),'L'||n,'Location '||n,'branch','SA','Asia/Riyadh',n<>2 from generate_series(0,3) n;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency,status)
 select pg_temp.id(100+n),pg_temp.id(1),'I'||n,'Item '||n,'Test','EA',1,'SAR',case when n=3 then 'discontinued' else 'active' end from generate_series(0,3) n;
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency) values
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(20),'2026-10-01',10,0,1.125,'KWD'),
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(20),'2026-10-09',8,2,1.125,'KWD'),
 (pg_temp.id(1),pg_temp.id(101),pg_temp.id(20),'2026-10-02',0,0,2,'SAR'),
 (pg_temp.id(1),pg_temp.id(102),pg_temp.id(20),'2026-10-10',1,2,5,'SAR'),
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(21),'2026-10-03',2,0,3,'SAR'),
 (pg_temp.id(1),pg_temp.id(101),pg_temp.id(21),'2026-10-11',100,0,1,'SAR'),
 (pg_temp.id(1),pg_temp.id(103),pg_temp.id(20),'2026-10-10',99,0,1,'SAR'),
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(22),'2026-10-10',99,0,1,'SAR');
insert into public.demand_history(organization_id,item_id,location_id,demand_date,quantity,lost_sales_quantity) values
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(20),'2026-10-10',2,1),
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(21),'2026-10-10',3,4);
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 select pg_temp.id(30+n),pg_temp.id(case when n=2 then 2 else 1 end),pg_temp.id(case when n=2 then 23 else 20+n end),pg_temp.id(40+n),
 '2026-01-01','2026-10-01','forecast','succeeded',jsonb_build_object('method',case when n=0 then 'regional-v1' else 'baseline-v1' end,'horizon',28),now(),'{}' from generate_series(0,2) n;
insert into public.forecast_results(id,organization_id,run_id,location_id,item_id,item_code,item_name,status,model,summary,evidence) values
 (pg_temp.id(50),pg_temp.id(1),pg_temp.id(30),pg_temp.id(20),pg_temp.id(200),'HIST-1','Historical group','selected','mean',
 '{"scores":[{"model":"naive","rmse":"999999999999999999.123","mae":"2","bias":"1"},{"model":"mean","rmse":"123456789012345678.123","mae":"1.125","bias":"-0.125"}]}',
 '{"source":{"preparation":{"unit":"EA"}},"output":{"comparison":"fixed-group-v1","folds":[{"train_from":"2026-01-01","train_to":"2026-07-09","test_from":"2026-07-10","test_to":"2026-08-06"}],"evaluation":{"status":"available","model":"naive","train_to":"2026-09-03","test_from":"2026-09-04","test_to":"2026-10-01","count":28,"coverage80":"0.75","coverage95":"0.9","forecast":["2"],"bands":[]}}}'),
 (pg_temp.id(51),pg_temp.id(1),pg_temp.id(31),pg_temp.id(21),pg_temp.id(201),'SHORT-2','Short history','insufficient',null,'{"scores":[]}','{}'),
 (pg_temp.id(52),pg_temp.id(2),pg_temp.id(32),pg_temp.id(23),pg_temp.id(202),'FOREIGN-3','Foreign item','insufficient',null,'{"scores":[]}','{}');
set local role authenticated;
select pg_temp.login(11,1);
select is(public.dashboard_kpis(pg_temp.id(1),'2026-10-10')->>'observed_pairs','4','latest snapshots counted once; future, discontinued and inactive excluded');
select is(public.dashboard_kpis(pg_temp.id(1),'2026-10-10')->>'available_pairs','2','positive after allocations only');
select is(public.dashboard_kpis(pg_temp.id(1),'2026-10-10')->>'stock_outs','2','zero and overallocated snapshots are unavailable');
select is(public.dashboard_kpis(pg_temp.id(1),'2026-10-10')->>'unobserved_pairs','2','missing observations remain separate');
select is(public.dashboard_kpis(pg_temp.id(1),'2026-10-10')->>'stale_pairs','1','exactly seven days old is not stale');
select is(public.dashboard_kpis(pg_temp.id(1),'2026-10-10')->>'oldest_snapshot','2026-10-02','oldest included date');
select is(public.dashboard_kpis(pg_temp.id(1),'2026-10-10')->'inventory_value','[{"currency":"KWD","value":"9.000000"},{"currency":"SAR","value":"11.000000"}]'::jsonb,'supplied costs, separate currencies and exact decimal strings');
select is(public.dashboard_kpis(pg_temp.id(1),'2026-10-10') - 'available_pairs' - 'location_code',public.dashboard_summary(pg_temp.id(1),'2026-10-10'),'existing unfiltered summary is unchanged');
select is(public.dashboard_kpis(pg_temp.id(1),'2026-10-10','L0')->>'available_pairs','1','location filter applied');
select is(public.dashboard_kpis(pg_temp.id(1),'2026-10-10','L0')->>'unobserved_pairs','0','location denominator scoped');
select is(public.dashboard_kpis(pg_temp.id(1),'2026-10-10','L0')->'demand'->29->>'quantity','2.000','demand follows selected location');
select is(public.dashboard_kpis(pg_temp.id(1),'2026-10-10','L0')->'demand'->29->>'lost_sales_quantity','1.000','lost demand remains separate');
select is(public.dashboard_kpis(pg_temp.id(1),'2026-09-01')->>'observed_pairs','0','no observations before first snapshot');
select is(public.dashboard_kpis(pg_temp.id(1),'2026-09-01')->>'unobserved_pairs','6','all pairs missing before first snapshot');
select throws_ok($$select public.dashboard_kpis(pg_temp.id(1),null)$$,'MQ422',null,'null day rejected');
select throws_ok($$select public.dashboard_kpis(pg_temp.id(1),'infinity')$$,'MQ422',null,'infinite day rejected');
select throws_ok($$select public.dashboard_kpis(pg_temp.id(1),'2026-10-10','L2')$$,'MQ404',null,'inactive location rejected');
select throws_ok($$select public.dashboard_kpis(pg_temp.id(1),'2026-10-10','L3')$$,'MQ404',null,'foreign location rejected');
select is((select count(*) from public.forecast_quality),2::bigint,'viewer sees only tenant saved results');
select is((select rmse from public.forecast_quality where id=pg_temp.id(50)),'123456789012345678.123','selected model score matched by name without precision loss');
select is((select bias from public.forecast_quality where id=pg_temp.id(50)),'-0.125','signed bias retained');
select is((select evaluation->>'model' from public.forecast_quality where id=pg_temp.id(50)),'naive','coverage model is independent of selected model');
select is((select evaluation->>'count' from public.forecast_quality where id=pg_temp.id(50)),'28','coverage denominator retained');
select ok((select not(evaluation ? 'forecast') and not(evaluation ? 'bands') from public.forecast_quality where id=pg_temp.id(50)),'list projection excludes large evidence arrays');
select is((select comparison from public.forecast_quality where id=pg_temp.id(50)),'fixed-group-v1','fixed-group interpretation retained');
select is((select unit from public.forecast_quality where id=pg_temp.id(50)),'EA','saved group unit retained');
select is((select folds->0->>'train_to' from public.forecast_quality where id=pg_temp.id(50)),'2026-07-09','model-selection windows retained');
select is((select rmse from public.forecast_quality where id=pg_temp.id(51)),null,'missing scores are null, not zero');
select is((select evaluation->>'status' from public.forecast_quality where id=pg_temp.id(51)),'unavailable','old baseline evidence has unavailable coverage');
select is((select unit from public.forecast_quality where id=pg_temp.id(51)),null,'no historical unit inferred from current catalog');
select is((select count(*) from public.forecast_quality where search_text like '%historical%'),1::bigint,'saved identity searchable without a live item');
select throws_ok($$delete from public.forecast_quality$$,'55000',null,'quality view is not updatable');
select ok(not has_table_privilege('authenticated','public.forecast_quality','DELETE'),'members have no write privilege on quality view');
select pg_temp.login(12,1);
select is(public.dashboard_kpis(pg_temp.id(1),'2026-10-10')->>'observed_pairs','3','branch summary restricts observations');
select is(public.dashboard_kpis(pg_temp.id(1),'2026-10-10')->>'unobserved_pairs','0','branch summary restricts denominator');
select throws_ok($$select public.dashboard_kpis(pg_temp.id(1),'2026-10-10','L1')$$,'MQ404',null,'branch cannot select another location');
select is((select count(*) from public.forecast_quality),1::bigint,'branch quality scope enforced');
select pg_temp.login(13,2);
select throws_ok($$select public.dashboard_kpis(pg_temp.id(1),'2026-10-10')$$,'MQ404',null,'cross-tenant summary rejected');
select is((select count(*) from public.forecast_quality where organization_id=pg_temp.id(1)),0::bigint,'cross-tenant quality hidden');
select pg_temp.login(10,2);
select throws_ok($$select public.dashboard_kpis(pg_temp.id(1),'2026-10-10')$$,'MQ404',null,'stale organization claim cannot read summary');
select is((select count(*) from public.forecast_quality),0::bigint,'stale organization claim cannot read quality');
reset role;
select ok((select not prosecdef from pg_proc where oid='public.dashboard_kpis(uuid,date,text)'::regprocedure),'summary uses invoker rights');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.forecast_quality'::regclass),'quality view uses invoker rights');
select ok(not has_table_privilege('anon','public.forecast_quality','SELECT'),'anonymous quality denied');
select ok(not has_function_privilege('anon','public.dashboard_kpis(uuid,date,text)','EXECUTE'),'anonymous summary denied');
select is((select count(*) from public.planning_runs where organization_id=pg_temp.id(1)),2::bigint,'read-only KPIs create no runs');
select * from finish();
rollback;
