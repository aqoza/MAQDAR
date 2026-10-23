begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('e250f100-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object(
    'sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void
$$;
insert into auth.users(id,email) select pg_temp.id(n),'regional-dates-'||n||'@test.local' from generate_series(10,12) n;
insert into public.organizations(id,slug,name) values
  (pg_temp.id(1),'regional-api-a','Regional dates A'),(pg_temp.id(2),'regional-api-b','Regional dates B');
insert into public.memberships(organization_id,user_id,role) values
  (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(2),pg_temp.id(11),'owner'),
  (pg_temp.id(1),pg_temp.id(12),'branch_user');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values
  (pg_temp.id(20),pg_temp.id(1),'SOURCE','Source','central','SA','Asia/Riyadh'),
  (pg_temp.id(21),pg_temp.id(1),'BRANCH','Branch','branch','SA','Asia/Riyadh');
insert into public.regional_handoff_batches(id,organization_id,destination_location_id,required_location_ids,handoff_ids,created_by,payload)
values(pg_temp.id(70),pg_temp.id(1),pg_temp.id(20),array[pg_temp.id(20),pg_temp.id(21)],array[pg_temp.id(60)],pg_temp.id(10),
'{"schema_version":"regional-handoff-batch-v1","purpose":"planning_only","summary":{"destination_code":"DEST","requested_date":"2026-10-10","source_row_count":1,"totals":[]},"lines":[]}');
create function pg_temp.hash(n integer) returns bytea language sql immutable as $$
  select decode(lpad(n::text,64,'0'),'hex')
$$;
create function pg_temp.key(n integer,org integer default 1,scopes text[] default array['regional_handoffs:read'])
returns uuid language sql as $$
  select public.create_api_key(pg_temp.id(org),'Regional reader',scopes,30,pg_temp.hash(n),'maqdar_sk_test','test')
$$;
select pg_temp.login(10,1);
set local role authenticated;
select lives_ok($$select pg_temp.key(100)$$,'owner explicitly issues reader');
select lives_ok($$select pg_temp.key(101,1,array['master_data:read','master_data:write','transactions:read','transactions:write','purchase_handoffs:read','purchase_handoffs:acknowledge','transfer_handoffs:read','transfer_handoffs:acknowledge','event_purchase_handoffs:read','event_purchase_handoffs:acknowledge','excess_disposition_handoffs:read','excess_disposition_handoffs:acknowledge','network_handoffs:read','network_handoffs:acknowledge'])$$,'all legacy permissions remain issuable');
reset role;
select pg_temp.login(11,2);
set local role authenticated;
select lives_ok($$select pg_temp.key(102,2)$$,'other organization explicitly issues reader');
reset role;
select pg_temp.login(12,1);
set local role authenticated;
select throws_ok($$select pg_temp.key(103)$$,'MQ403',null,'branch member cannot issue regional keys');
select is((select count(*) from public.regional_transfer_handoffs),0::bigint,'browser cannot read without every location');
select is((select count(*) from public.regional_handoff_batches),0::bigint,'browser batch restrictions unchanged');
reset role;
set local role service_role;
select is(jsonb_array_length(public.api_regional_handoff_list(pg_temp.hash(100),'regional-handoffs')->'data'),0,'explicit key reads empty single list');
select is(jsonb_array_length(public.api_regional_handoff_list(pg_temp.hash(100),'regional-handoff-batches')->'data'),1,'explicit key reads batches');
select is(jsonb_array_length(public.api_regional_handoff_list(pg_temp.hash(102),'regional-handoffs')->'data'),0,'other tenant cannot enumerate');
select is(jsonb_array_length(public.api_regional_handoff_list(pg_temp.hash(102),'regional-handoff-batches')->'data'),0,'other tenant cannot enumerate batches');
select throws_ok($$select public.api_regional_handoff_get(pg_temp.hash(102),'regional-handoffs',pg_temp.id(60))$$,'MQ404',null,'foreign handoff hidden');
select throws_ok($$select public.api_regional_handoff_get(pg_temp.hash(102),'regional-handoff-batches',pg_temp.id(70))$$,'MQ404',null,'foreign batch hidden');
select throws_ok($$select public.api_regional_handoff_get(pg_temp.hash(100),'regional-handoffs',gen_random_uuid())$$,'MQ404',null,'unknown ID is also hidden');
select throws_ok($$select public.api_regional_handoff_list(pg_temp.hash(101),'regional-handoffs')$$,'MQ403',null,'all legacy scopes grant no regional access');
select throws_ok($$select public.api_regional_handoff_get(pg_temp.hash(101),'regional-handoff-batches',pg_temp.id(70))$$,'MQ403',null,'all legacy scopes grant no regional batch access');
select throws_ok($$select public.api_regional_handoff_get(pg_temp.hash(999),'regional-handoffs',pg_temp.id(60))$$,'MQ401',null,'unknown key denied');
select throws_ok($$select public.api_regional_handoff_list(pg_temp.hash(100),'purchase-handoffs')$$,'MQ404',null,'resource allowlist enforced');
select throws_ok($$select public.api_regional_handoff_get(pg_temp.hash(100),'transfer-handoffs',pg_temp.id(60))$$,'MQ404',null,'detail resource allowlist enforced');
select throws_ok($$select public.api_handoff_list(pg_temp.hash(100),'purchase-handoffs')$$,'MQ403',null,'regional scope grants no purchase reads');
select throws_ok($$select public.api_transfer_handoff_list(pg_temp.hash(100),'transfer-handoffs')$$,'MQ403',null,'regional scope grants no individual transfer reads');
select throws_ok($$select public.api_event_purchase_handoff_list(pg_temp.hash(100),'event-purchase-handoffs')$$,'MQ403',null,'regional scope grants no event reads');
select throws_ok($$select public.api_excess_disposition_handoff_list(pg_temp.hash(100),'excess-disposition-handoffs')$$,'MQ403',null,'regional scope grants no disposition reads');
select throws_ok($$select public.api_transfer_handoff_acknowledge(pg_temp.hash(100),'transfer-handoffs',pg_temp.id(60),'{}')$$,'MQ403',null,'regional scope grants no acknowledgement writes');
reset role;
select ok(not has_table_privilege('anon','app.regional_handoff_api_records','SELECT'),'private projection denied to anon');
select ok(not has_function_privilege('anon','public.api_regional_handoff_list(bytea,text,text,integer,timestamptz)','execute'),'reader list execution for anon');
select ok(not has_function_privilege('anon','public.api_regional_handoff_get(bytea,text,uuid)','execute'),'reader get execution for anon');
select ok(not has_table_privilege('anon','public.regional_transfer_handoffs','SELECT'),'no direct regional_transfer_handoffs read by anon');
select ok(not has_table_privilege('anon','public.regional_handoff_batches','SELECT'),'no direct regional_handoff_batches read by anon');
select ok(not has_table_privilege('authenticated','app.regional_handoff_api_records','SELECT'),'private projection denied to authenticated');
select ok(not has_function_privilege('authenticated','public.api_regional_handoff_list(bytea,text,text,integer,timestamptz)','execute'),'reader list execution for authenticated');
select ok(not has_function_privilege('authenticated','public.api_regional_handoff_get(bytea,text,uuid)','execute'),'reader get execution for authenticated');
select ok(not has_table_privilege('service_role','app.regional_handoff_api_records','SELECT'),'private projection denied to service_role');
select ok(has_function_privilege('service_role','public.api_regional_handoff_list(bytea,text,text,integer,timestamptz)','execute'),'reader list execution for service_role');
select ok(has_function_privilege('service_role','public.api_regional_handoff_get(bytea,text,uuid)','execute'),'reader get execution for service_role');
select ok(not has_table_privilege('service_role','public.regional_transfer_handoffs','SELECT'),'no direct regional_transfer_handoffs read by service_role');
select ok(not has_table_privilege('service_role','public.regional_handoff_batches','SELECT'),'no direct regional_handoff_batches read by service_role');
select ok(not has_table_privilege('maqdar_worker','app.regional_handoff_api_records','SELECT'),'private projection denied to maqdar_worker');
select ok(not has_function_privilege('maqdar_worker','public.api_regional_handoff_list(bytea,text,text,integer,timestamptz)','execute'),'reader list execution for maqdar_worker');
select ok(not has_function_privilege('maqdar_worker','public.api_regional_handoff_get(bytea,text,uuid)','execute'),'reader get execution for maqdar_worker');
select ok(not has_table_privilege('maqdar_worker','public.regional_transfer_handoffs','SELECT'),'no direct regional_transfer_handoffs read by maqdar_worker');
select ok(not has_table_privilege('maqdar_worker','public.regional_handoff_batches','SELECT'),'no direct regional_handoff_batches read by maqdar_worker');
select ok(not has_table_privilege('maqdar_simulation_worker','app.regional_handoff_api_records','SELECT'),'private projection denied to maqdar_simulation_worker');
select ok(not has_function_privilege('maqdar_simulation_worker','public.api_regional_handoff_list(bytea,text,text,integer,timestamptz)','execute'),'reader list execution for maqdar_simulation_worker');
select ok(not has_function_privilege('maqdar_simulation_worker','public.api_regional_handoff_get(bytea,text,uuid)','execute'),'reader get execution for maqdar_simulation_worker');
select ok(not has_table_privilege('maqdar_simulation_worker','public.regional_transfer_handoffs','SELECT'),'no direct regional_transfer_handoffs read by maqdar_simulation_worker');
select ok(not has_table_privilege('maqdar_simulation_worker','public.regional_handoff_batches','SELECT'),'no direct regional_handoff_batches read by maqdar_simulation_worker');

-- A cursor is tenant-bound even when its record UUID is known.
create temporary table cursor_fixture(value text);
insert into cursor_fixture values(app.api_cursor_encode(jsonb_build_object('v',1,'k','regional-handoffs','o',pg_temp.id(1),
 'a',pg_temp.id(60),'d',statement_timestamp(),'t',statement_timestamp(),'s',null)));
grant select on cursor_fixture to service_role;
set local role service_role;
select throws_ok(format('select public.api_regional_handoff_list(pg_temp.hash(102),%L,%L)','regional-handoffs',(select value from cursor_fixture)),'MQ422',null,'cross-organization cursor refused');
reset role;
select * from finish();
rollback;
