begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('b1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer default 1) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'simulation-'||n||'@test.local' from generate_series(10,15) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'simulation-a','Simulation A'),(pg_temp.id(2),'simulation-b','Simulation B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'planner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),(pg_temp.id(1),pg_temp.id(12),'branch_user'),
 (pg_temp.id(2),pg_temp.id(13),'owner'),(pg_temp.id(1),pg_temp.id(14),'approver'),(pg_temp.id(1),pg_temp.id(15),'owner');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone)
 values(pg_temp.id(20),pg_temp.id(1),'SIM','Simulation','branch','SA','Asia/Riyadh'),(pg_temp.id(21),pg_temp.id(1),'OTHER','Other','branch','SA','Asia/Riyadh');
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
 values(pg_temp.id(30),pg_temp.id(1),'SIM-ITEM','Replay item','Test','EA',1,'SAR');
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 values(pg_temp.id(40),pg_temp.id(1),pg_temp.id(20),pg_temp.id(41),'2026-07-01','2026-10-01','policy','succeeded','{}',now(),'{}');
insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
 values(pg_temp.id(50),pg_temp.id(1),pg_temp.id(40),pg_temp.id(20),pg_temp.id(51),pg_temp.id(30),'SIM-ITEM','EA','available',
 '{"protection":{"target":"6"}}', '{"options":{"lead_time":1,"review_interval":2},"forecast":{"to_date":"2026-10-01","horizon":7,"method":"baseline-v1","source":{"unit_provenance":{"status":"consistent","unit":"EA"}}},"output":{"protection":{"target":"6"}}}');
insert into public.demand_history(organization_id,item_id,location_id,demand_date,quantity,lost_sales_quantity,unit_of_measure)
 values(pg_temp.id(1),pg_temp.id(30),pg_temp.id(20),'2026-10-02',4,2,'EA'),(pg_temp.id(1),pg_temp.id(30),pg_temp.id(20),'2026-10-03',4,1,'EA');
create function pg_temp.enqueue(request integer default 60,policy integer default 50,ending date default '2026-10-04',opening text default '2',alternative text default '8',history boolean default true,empty_start boolean default true) returns uuid language sql as $$
 select public.simulation_enqueue(pg_temp.id(1),pg_temp.id(policy),pg_temp.id(request),ending,opening,alternative,history,empty_start)$$;
create temporary table saved(run uuid,payload jsonb);
grant all on saved to authenticated;

set local role anon;
select throws_ok($$select pg_temp.enqueue()$$,'42501',null,'anonymous cannot enqueue');
reset role;
select pg_temp.login(11);
set local role authenticated;
select throws_ok($$select pg_temp.enqueue()$$,'MQ403',null,'viewer cannot enqueue');
select pg_temp.login(12);
select throws_ok($$select pg_temp.enqueue()$$,'MQ403',null,'branch user cannot enqueue');
select pg_temp.login(14);
select throws_ok($$select pg_temp.enqueue()$$,'MQ403',null,'approver cannot enqueue');
select pg_temp.login(13,2);
select throws_ok($$select pg_temp.enqueue()$$,'MQ403',null,'foreign owner cannot enqueue');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.enqueue()$$,'MQ403',null,'stale organization claim rejected');
select pg_temp.login(10);
select throws_ok($$select pg_temp.enqueue(history=>false)$$,'MQ422',null,'complete-history confirmation required');
select throws_ok($$select pg_temp.enqueue(empty_start=>false)$$,'MQ422',null,'controlled starting state required');
select throws_ok($$select pg_temp.enqueue(opening=>'-1')$$,'MQ422',null,'negative opening rejected');
select throws_ok($$select pg_temp.enqueue(alternative=>'NaN')$$,'MQ422',null,'nonfinite maximum rejected');
select throws_ok($$select pg_temp.enqueue(alternative=>'1e3')$$,'MQ422',null,'exponent rejected');
select throws_ok($$select pg_temp.enqueue(opening=>'0.0001')$$,'MQ422',null,'unsupported precision rejected');
select throws_ok($$select pg_temp.enqueue(ending=>'2026-10-01')$$,'MQ422',null,'window starts after cutoff');
select throws_ok($$select pg_temp.enqueue(ending=>'2026-10-09')$$,'MQ422',null,'window cannot exceed forecast horizon');
select throws_ok($$select pg_temp.enqueue(ending=>'infinity')$$,'MQ422',null,'infinite date rejected');
select throws_ok($$select pg_temp.enqueue(policy=>999)$$,'MQ404',null,'missing policy unavailable');
reset role;
update public.inventory_policies set unit=null where id=pg_temp.id(50);
set local role authenticated;
select throws_ok($$select pg_temp.enqueue()$$,'MQ422',null,'unknown policy unit rejected');
reset role;
update public.inventory_policies set unit='EA',evidence=jsonb_set(evidence,'{forecast,method}','"regional-v1"') where id=pg_temp.id(50);
set local role authenticated;
select throws_ok($$select pg_temp.enqueue()$$,'MQ422',null,'prepared group policy rejected');
reset role;
update public.inventory_policies set evidence=jsonb_set(evidence,'{forecast,method}','"baseline-v1"') where id=pg_temp.id(50);
update public.demand_history set unit_of_measure=null where organization_id=pg_temp.id(1);
set local role authenticated;
select throws_ok($$select pg_temp.enqueue()$$,'MQ422',null,'unlabeled history rejected');
reset role;
update public.demand_history set unit_of_measure='KG' where organization_id=pg_temp.id(1);
set local role authenticated;
select throws_ok($$select pg_temp.enqueue()$$,'MQ422',null,'mismatched history rejected');
reset role;
update public.demand_history set unit_of_measure='EA' where organization_id=pg_temp.id(1);
update public.locations set is_active=false where id=pg_temp.id(20);
set local role authenticated;
select throws_ok($$select pg_temp.enqueue()$$,'MQ422',null,'inactive receiving location rejected');
reset role;
update public.locations set is_active=true where id=pg_temp.id(20);
update public.organizations set time_zone='UTC' where id=pg_temp.id(1);
update public.planning_runs set to_date=current_date-1 where id=pg_temp.id(40);
update public.inventory_policies set evidence=jsonb_set(evidence,'{forecast,to_date}',to_jsonb((current_date-1)::text)) where id=pg_temp.id(50);
set local role authenticated;
select throws_ok($$select pg_temp.enqueue(ending=>current_date)$$,'MQ422',null,'today is not a completed replay day');
reset role;
update public.planning_runs set to_date='2026-10-01' where id=pg_temp.id(40);
update public.inventory_policies set evidence=jsonb_set(evidence,'{forecast,to_date}','"2026-10-01"') where id=pg_temp.id(50);
set local role authenticated;
insert into saved(run) values(pg_temp.enqueue());
select is(pg_temp.enqueue(),(select run from saved),'identical retry returns original run');
select is(pg_temp.enqueue(opening=>'02.000',alternative=>'08.000'),(select run from saved),'canonical decimal retry returns original');
select throws_ok($$select pg_temp.enqueue(alternative=>'9')$$,'MQ409',null,'conflicting retry rejected');
select throws_ok($$select pg_temp.enqueue(request=>61)$$,'MQ409',null,'one active run per organization');
select throws_ok($$select * from planning.simulation_inputs$$,'42501',null,'private input never readable by browser');
select throws_ok($$insert into public.policy_simulations(organization_id,run_id,location_id,policy_id,item_id,item_code,unit,evidence) values(pg_temp.id(1),pg_temp.id(60),pg_temp.id(20),pg_temp.id(50),pg_temp.id(30),'X','EA','{}')$$,'42501',null,'browser cannot forge results');
reset role;
update saved set payload=i.payload from planning.simulation_inputs i where i.run_id=saved.run;
select is((select payload#>>'{demand,2,quantity}' from saved),'0','missing day captured as confirmed zero');
select is((select payload#>>'{demand,2,recorded}' from saved),'false','missing provenance preserved');
select is((select payload#>>'{demand,0,lost_sales_quantity}' from saved),'2','lost sales captured separately');
select is((select payload#>>'{policy,maximum}' from saved),'6','calculated maximum copied');
select is((select payload#>>'{options,opening_stock}' from saved),'2','opening scenario assumption copied');
update public.demand_history set quantity=999 where organization_id=pg_temp.id(1);
select is((select payload#>>'{demand,0,quantity}' from planning.simulation_inputs where run_id=(select run from saved)),'4','history changes do not rewrite captured input');

-- Result visibility uses the existing organization and restrictive location policies.
insert into public.policy_simulations(organization_id,run_id,location_id,policy_id,item_id,item_code,unit,evidence)
 select pg_temp.id(1),run,pg_temp.id(20),pg_temp.id(50),pg_temp.id(30),'SIM-ITEM','EA',payload from saved;
select pg_temp.login(11);
set local role authenticated;
select is((select count(*)::integer from public.policy_simulations),1,'viewer sees organization result');
select pg_temp.login(12);
select is((select count(*)::integer from public.policy_simulations),0,'unassigned branch cannot see result');
select is((select count(*)::integer from public.planning_runs where kind='simulation'),0,'unassigned branch cannot see history counts');
reset role;
insert into public.membership_locations(organization_id,user_id,location_id) values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
set local role authenticated;
select is((select count(*)::integer from public.policy_simulations),1,'assigned branch can see result');
select pg_temp.login(13,2);
select is((select count(*)::integer from public.policy_simulations),0,'foreign organization cannot see result');
select pg_temp.login(10);
select lives_ok($$select public.planning_cancel(pg_temp.id(1),(select run from saved))$$,'editor can cancel');
reset role;
select is((select count(*)::integer from planning.simulation_inputs where run_id=(select run from saved)),0,'cancel cleans private staging');
delete from public.planning_runs where id=pg_temp.id(40);
select is((select count(*)::integer from public.policy_simulations where run_id=(select run from saved)),1,'source deletion retains copied result evidence');
set local role authenticated;
select is(pg_temp.enqueue(),(select run from saved),'terminal retry remains stable after source deletion');
reset role;
select ok(not has_function_privilege('service_role','public.simulation_enqueue(uuid,uuid,uuid,date,text,text,boolean,boolean)','EXECUTE'),'service API role cannot enqueue');
select ok(not has_function_privilege('authenticated','app.simulation_finish(uuid,uuid,jsonb)','EXECUTE'),'browser cannot publish');
select ok(not has_table_privilege('zeespare_worker','public.policy_simulations','INSERT'),'worker has no direct result write');
select ok(has_function_privilege('zeespare_worker','app.simulation_finish(uuid,uuid,jsonb)','EXECUTE'),'worker can use fenced publication');
select is((select count(*)::integer from public.stock_snapshots where organization_id=pg_temp.id(1)),0,'no physical stock created');
select is((select count(*)::integer from public.open_orders where organization_id=pg_temp.id(1)),0,'no operational inbound created');
select * from finish();
rollback;
