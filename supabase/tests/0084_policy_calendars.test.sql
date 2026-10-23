begin;
select plan(19);
create temporary table captured as
select jsonb_build_object('from_date','2026-01-02','to_date','2026-01-05',
 'options',jsonb_build_object('opening_stock','2','configurations',jsonb_build_array(
  jsonb_build_object('maximum','6','lead_time',0,'review_interval',1,'moq','0','pack','2.5'))),
 'demand',(select jsonb_agg(jsonb_build_object('date',date '2026-01-02'+n,'quantity','4','lost_sales_quantity','1.125') order by n) from generate_series(0,3) n),
 'calendars',jsonb_build_object(
  'ordering_days',(select jsonb_object_agg((date '2026-01-02'+n)::text,jsonb_build_object('date',date '2026-01-02'+n,'working',n>=2)) from generate_series(0,3) n),
  'receiving_days',(select jsonb_object_agg((date '2026-01-02'+n)::text,jsonb_build_object('date',date '2026-01-02'+n,'working',true)) from generate_series(0,457) n))) input;
create temporary table result as select app.simulation_calendar_output(input) output from captured;
select is((select output->>'status' from result),'available','known calendars produce a comparison');
select is((select output#>>'{variants,0,ledger,0,order_quantity}' from result),'0','closed ordering day has no order');
select is((select output#>>'{variants,0,ledger,2,order_gap}' from result),'12','gap recomputed after delayed demand');
select is((select output#>>'{variants,0,ledger,2,order_quantity}' from result),'12.5','fractional pack applies once');
select is((select jsonb_array_length(output#>'{variants,0,ledger,2,nominal_reviews}') from result),3,'three nominal reviews coalesce');
select is((select output#>>'{variants,0,ledger,2,backlog_fulfilled}' from result),'6','zero lead receipt clears older backlog');
select is((select output#>>'{variants,0,metrics,lost_sales_quantity}' from result),'4.5','lost sales stay separate');
select is((select output#>>'{variants,0,metrics,ending_backlog}' from result),'0','closing backlog reconciles');
select is((select app.simulation_calendar_output(jsonb_set(input,'{calendars,ordering_days,2026-01-02,working}','null'))#>>'{failure,stage}' from captured),'ordering','unknown ordering date reported');
select is((select app.simulation_calendar_output(jsonb_set(input,'{calendars,receiving_days,2026-01-04,working}','null'))->'variants' from captured),'[]'::jsonb,'unknown receipt never publishes partial variants');
select is((select app.simulation_calendar_output(jsonb_set(input,'{calendars,receiving_days,2026-01-04,working}','false'))#>>'{variants,0,ledger,2,order_due}' from captured),'2026-01-05','receiving closure shifts zero-lead order');
select is((select app.simulation_calendar_output(jsonb_set(input,'{options,configurations,0,lead_time}','365'))#>>'{variants,0,metrics,ending_on_order}' from captured),'17.5','orders beyond window remain in pipeline');
select is(app.simulation_calendar_next('{"2026-01-02":{"date":"2026-01-02","working":false}}','2026-01-02','2026-01-02')->>'status','outside_window','ordering beyond window needs no extra evidence');
select is(app.simulation_calendar_next((select jsonb_object_agg((date '2026-01-02'+n)::text,jsonb_build_object('date',date '2026-01-02'+n,'working',false)) from generate_series(0,89) n),'2026-01-02')->>'status','search_exhausted','90 closed dates exhaust search');
select ok(not has_function_privilege('service_role','public.simulation_calendars_enqueue(uuid,uuid,uuid,uuid,text,boolean)','execute'),'integration keys gain no scope');
select ok(not has_function_privilege('authenticated','app.simulation_calendar_output(jsonb)','execute'),'result calculator private');
select ok(not has_function_privilege('zeespare_worker','app.simulation_calendar_replay(jsonb,jsonb)','execute'),'worker has only existing publication capability');
set local role authenticated;
select throws_ok($$select public.simulation_calendars_preview(gen_random_uuid(),gen_random_uuid(),gen_random_uuid())$$,'MQ404',null,'anonymous membership cannot preview another tenant');
select throws_ok($$select public.simulation_calendars_enqueue(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),repeat('a',64),true)$$,'MQ403',null,'nonmember cannot enqueue');
reset role;
select * from finish();
rollback;
