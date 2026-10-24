begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('ed270f10-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object(
    'sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void
$$;
insert into auth.users(id,email) select pg_temp.id(n),'return-dates-'||n||'@test.local' from generate_series(10,12) n;
insert into public.organizations(id,slug,name) values
  (pg_temp.id(1),'return-api-a','Return dates A'),(pg_temp.id(2),'return-api-b','Return dates B');
insert into public.memberships(organization_id,user_id,role) values
  (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(2),pg_temp.id(11),'owner'),
  (pg_temp.id(1),pg_temp.id(12),'branch_user');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values
  (pg_temp.id(20),pg_temp.id(1),'SOURCE','Source','central','SA','Asia/Riyadh'),
  (pg_temp.id(21),pg_temp.id(1),'BRANCH','Branch','branch','SA','Asia/Riyadh');
insert into public.dealer_return_batches(id,organization_id,source_location_id,location_id,handoff_ids,created_by,created_at,payload,search_text)
values(pg_temp.id(70),pg_temp.id(1),pg_temp.id(21),pg_temp.id(20),array[pg_temp.id(60)],pg_temp.id(10),clock_timestamp(),
'{"schema_version":"dealer-return-batch-v1","purpose":"internal_return_authorization","summary":{"source_code":"B","location_code":"H","requested_date":"2026-10-24"},"lines":[]}', 'retained batch');
create function pg_temp.hash(n integer) returns bytea language sql immutable as $$
  select decode(lpad(n::text,64,'0'),'hex')
$$;
create function pg_temp.key(n integer,org integer default 1,scopes text[] default array['dealer_return_handoffs:read'])
returns uuid language sql as $$
  select public.create_api_key(pg_temp.id(org),'Return reader',scopes,30,pg_temp.hash(n),'zeespare_sk_test','test')
$$;
select pg_temp.login(10,1);
set local role authenticated;
select lives_ok($$select pg_temp.key(100)$$,'owner explicitly issues reader');
select lives_ok($$select pg_temp.key(101,1,array['master_data:read','master_data:write','transactions:read','transactions:write','purchase_handoffs:read','purchase_handoffs:acknowledge','transfer_handoffs:read','transfer_handoffs:acknowledge','event_purchase_handoffs:read','event_purchase_handoffs:acknowledge','excess_disposition_handoffs:read','excess_disposition_handoffs:acknowledge','network_handoffs:read','network_handoffs:acknowledge','regional_handoffs:read','regional_handoffs:acknowledge'])$$,'all legacy permissions remain issuable');
reset role;
select pg_temp.login(11,2);
set local role authenticated;
select lives_ok($$select pg_temp.key(102,2)$$,'other organization explicitly issues reader');
reset role;
select pg_temp.login(12,1);
set local role authenticated;
select throws_ok($$select pg_temp.key(103)$$,'MQ403',null,'branch member cannot issue return keys');
select is((select count(*) from public.dealer_return_handoffs),0::bigint,'browser cannot read without every location');
select is((select count(*) from public.dealer_return_batches),0::bigint,'browser batch restrictions unchanged');
reset role;
set local role service_role;
select is(jsonb_array_length(public.api_dealer_return_handoff_list(pg_temp.hash(100),'dealer-return-handoffs')->'data'),0,'explicit key reads empty single list');
select is(jsonb_array_length(public.api_dealer_return_handoff_list(pg_temp.hash(100),'dealer-return-handoff-batches')->'data'),1,'explicit key reads batches');
select is(jsonb_array_length(public.api_dealer_return_handoff_list(pg_temp.hash(102),'dealer-return-handoffs')->'data'),0,'other tenant cannot enumerate');
select is(jsonb_array_length(public.api_dealer_return_handoff_list(pg_temp.hash(102),'dealer-return-handoff-batches')->'data'),0,'other tenant cannot enumerate batches');
select throws_ok($$select public.api_dealer_return_handoff_get(pg_temp.hash(102),'dealer-return-handoffs',pg_temp.id(60))$$,'MQ404',null,'foreign handoff hidden');
select throws_ok($$select public.api_dealer_return_handoff_get(pg_temp.hash(102),'dealer-return-handoff-batches',pg_temp.id(70))$$,'MQ404',null,'foreign batch hidden');
select throws_ok($$select public.api_dealer_return_handoff_get(pg_temp.hash(100),'dealer-return-handoffs',gen_random_uuid())$$,'MQ404',null,'unknown ID is also hidden');
select throws_ok($$select public.api_dealer_return_handoff_list(pg_temp.hash(101),'dealer-return-handoffs')$$,'MQ403',null,'all legacy scopes grant no return access');
select throws_ok($$select public.api_dealer_return_handoff_get(pg_temp.hash(101),'dealer-return-handoff-batches',pg_temp.id(70))$$,'MQ403',null,'all legacy scopes grant no return batch access');
select throws_ok($$select public.api_dealer_return_handoff_get(pg_temp.hash(999),'dealer-return-handoffs',pg_temp.id(60))$$,'MQ401',null,'unknown key denied');
select throws_ok($$select public.api_dealer_return_handoff_list(pg_temp.hash(100),'purchase-handoffs')$$,'MQ404',null,'resource allowlist enforced');
select throws_ok($$select public.api_dealer_return_handoff_get(pg_temp.hash(100),'transfer-handoffs',pg_temp.id(60))$$,'MQ404',null,'detail resource allowlist enforced');
select throws_ok($$select public.api_handoff_list(pg_temp.hash(100),'purchase-handoffs')$$,'MQ403',null,'return scope grants no purchase reads');
select throws_ok($$select public.api_transfer_handoff_list(pg_temp.hash(100),'transfer-handoffs')$$,'MQ403',null,'return scope grants no individual transfer reads');
select throws_ok($$select public.api_event_purchase_handoff_list(pg_temp.hash(100),'event-purchase-handoffs')$$,'MQ403',null,'return scope grants no event reads');
select throws_ok($$select public.api_excess_disposition_handoff_list(pg_temp.hash(100),'excess-disposition-handoffs')$$,'MQ403',null,'return scope grants no disposition reads');
select throws_ok($$select public.api_transfer_handoff_acknowledge(pg_temp.hash(100),'transfer-handoffs',pg_temp.id(60),'{}')$$,'MQ403',null,'return scope grants no acknowledgement writes');
reset role;
select ok(not has_table_privilege('anon','app.dealer_return_handoff_api_records','SELECT'),'private projection denied to anon');
select ok(not has_function_privilege('anon','public.api_dealer_return_handoff_list(bytea,text,text,integer,timestamptz)','execute'),'reader list execution for anon');
select ok(not has_function_privilege('anon','public.api_dealer_return_handoff_get(bytea,text,uuid)','execute'),'reader get execution for anon');
select ok(not has_table_privilege('anon','public.dealer_return_handoffs','SELECT'),'no direct dealer_return_handoffs read by anon');
select ok(not has_table_privilege('anon','public.dealer_return_batches','SELECT'),'no direct dealer_return_handoff_batches read by anon');
select ok(not has_table_privilege('authenticated','app.dealer_return_handoff_api_records','SELECT'),'private projection denied to authenticated');
select ok(not has_function_privilege('authenticated','public.api_dealer_return_handoff_list(bytea,text,text,integer,timestamptz)','execute'),'reader list execution for authenticated');
select ok(not has_function_privilege('authenticated','public.api_dealer_return_handoff_get(bytea,text,uuid)','execute'),'reader get execution for authenticated');
select ok(not has_table_privilege('service_role','app.dealer_return_handoff_api_records','SELECT'),'private projection denied to service_role');
select ok(has_function_privilege('service_role','public.api_dealer_return_handoff_list(bytea,text,text,integer,timestamptz)','execute'),'reader list execution for service_role');
select ok(has_function_privilege('service_role','public.api_dealer_return_handoff_get(bytea,text,uuid)','execute'),'reader get execution for service_role');
select ok(not has_table_privilege('service_role','public.dealer_return_handoffs','SELECT'),'no direct dealer_return_handoffs read by service_role');
select ok(not has_table_privilege('service_role','public.dealer_return_batches','SELECT'),'no direct dealer_return_handoff_batches read by service_role');
select ok(not has_table_privilege('zeespare_worker','app.dealer_return_handoff_api_records','SELECT'),'private projection denied to zeespare_worker');
select ok(not has_function_privilege('zeespare_worker','public.api_dealer_return_handoff_list(bytea,text,text,integer,timestamptz)','execute'),'reader list execution for zeespare_worker');
select ok(not has_function_privilege('zeespare_worker','public.api_dealer_return_handoff_get(bytea,text,uuid)','execute'),'reader get execution for zeespare_worker');
select ok(not has_table_privilege('zeespare_worker','public.dealer_return_handoffs','SELECT'),'no direct dealer_return_handoffs read by zeespare_worker');
select ok(not has_table_privilege('zeespare_worker','public.dealer_return_batches','SELECT'),'no direct dealer_return_handoff_batches read by zeespare_worker');
select ok(not has_table_privilege('zeespare_simulation_worker','app.dealer_return_handoff_api_records','SELECT'),'private projection denied to zeespare_simulation_worker');
select ok(not has_function_privilege('zeespare_simulation_worker','public.api_dealer_return_handoff_list(bytea,text,text,integer,timestamptz)','execute'),'reader list execution for zeespare_simulation_worker');
select ok(not has_function_privilege('zeespare_simulation_worker','public.api_dealer_return_handoff_get(bytea,text,uuid)','execute'),'reader get execution for zeespare_simulation_worker');
select ok(not has_table_privilege('zeespare_simulation_worker','public.dealer_return_handoffs','SELECT'),'no direct dealer_return_handoffs read by zeespare_simulation_worker');
select ok(not has_table_privilege('zeespare_simulation_worker','public.dealer_return_batches','SELECT'),'no direct dealer_return_handoff_batches read by zeespare_simulation_worker');

-- A cursor is tenant-bound even when its record UUID is known.
create temporary table cursor_fixture(value text);
insert into cursor_fixture values(app.api_cursor_encode(jsonb_build_object('v',1,'k','dealer-return-handoffs','o',pg_temp.id(1),
 'a',pg_temp.id(60),'d',statement_timestamp(),'t',statement_timestamp(),'s',null)));
grant select on cursor_fixture to service_role;
set local role service_role;
select throws_ok(format('select public.api_dealer_return_handoff_list(pg_temp.hash(102),%L,%L)','dealer-return-handoffs',(select value from cursor_fixture)),'MQ422',null,'cross-organization cursor refused');
reset role;
select * from finish();
rollback;
