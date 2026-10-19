begin;
select no_plan();
select ok((select not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
 and not rolinherit and not rolbypassrls from pg_roles where rolname='maqdar_simulation_worker'),
 'scoped capability has no login or administrative flags');
select ok((select relrowsecurity from pg_class where oid='planning.simulation_worker_scopes'::regclass),
 'private runtime bindings have RLS');
select is((select count(*) from planning.simulation_worker_scopes),0::bigint,'migration binds no organization or login');
select ok(not pg_has_role('maqdar_simulation_worker','maqdar_worker','MEMBER'),'scoped role cannot assume global role');
select ok(not has_schema_privilege('maqdar_simulation_worker','planning','USAGE'),'runtime has no private schema access');
select ok(not has_schema_privilege('maqdar_simulation_worker','pgmq','USAGE'),'runtime has no raw queue access');
select ok(not has_table_privilege('maqdar_simulation_worker','public.planning_runs','SELECT'), 'no raw run access');
select ok(not has_table_privilege('maqdar_simulation_worker','public.policy_simulations','INSERT'), 'no raw result writes');
select ok(not has_function_privilege('maqdar_simulation_worker','app.planning_claim()','EXECUTE'),'global claim denied');
select ok(not has_function_privilege('maqdar_simulation_worker','app.planning_task(uuid,uuid)','EXECUTE'),'global task denied');
select ok(not has_function_privilege('maqdar_simulation_worker','app.planning_fail(uuid,uuid)','EXECUTE'),'global failure denied');
select ok(not has_function_privilege('maqdar_simulation_worker','app.simulation_finish(uuid,uuid,jsonb)','EXECUTE'),'global publication denied');
select ok(not has_function_privilege('maqdar_simulation_worker','app.planning_claim_scoped(uuid)','EXECUTE'),'internal arbitrary scope denied');
select ok(has_function_privilege('maqdar_simulation_worker','app.scoped_simulation_claim()','EXECUTE'),'scoped claim granted');
select ok(has_function_privilege('maqdar_simulation_worker','app.scoped_simulation_task(uuid,uuid)','EXECUTE'),'scoped task granted');
select ok(has_function_privilege('maqdar_simulation_worker','app.scoped_simulation_finish(uuid,uuid,jsonb)','EXECUTE'),'scoped publication granted');
select ok(has_function_privilege('maqdar_simulation_worker','app.scoped_simulation_fail(uuid,uuid)','EXECUTE'),'scoped failure granted');
set local role maqdar_simulation_worker;
select throws_ok($$select app.scoped_simulation_identity()$$,'42501',null,'SET ROLE without a bound session_user grants no tenant');
reset role;
select ok(not has_function_privilege('anon','app.scoped_simulation_claim()','EXECUTE'),'anonymous cannot claim');
select ok(not has_function_privilege('authenticated','app.scoped_simulation_claim()','EXECUTE'),'browser cannot claim');
select ok(not has_function_privilege('service_role','app.scoped_simulation_claim()','EXECUTE'),'web service cannot claim');
select ok(not has_function_privilege('maqdar_worker','app.scoped_simulation_claim()','EXECUTE'),'global consumer cannot borrow scoped claim');
select * from finish();
rollback;
