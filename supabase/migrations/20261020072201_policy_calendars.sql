-- Step 21e is additive/forward-only. Upgrade workers before enabling web queues.
-- Rollback disables new queues, cancels pending runs and retains saved evidence.
set lock_timeout='5s';

create function public.simulation_calendars_preview(p_organization_id uuid,p_source_run_id uuid,p_calendar_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source public.policy_simulations; receiver public.locations; ordering public.work_calendars;
 ordering_context jsonb; receiving_context jsonb; ordering_days jsonb; receiving_days jsonb;
 first_day date; last_day date; result jsonb;
begin
 if p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
  raise exception using errcode='MQ404',message='source comparison unavailable';
 end if;
 select s.* into source from public.policy_simulations s join public.planning_runs r
  on r.organization_id=s.organization_id and r.id=s.run_id
  where s.organization_id=p_organization_id and s.run_id=p_source_run_id
  and r.status='succeeded' and r.kind='simulation'
  and (s.organization_id=any(array(select app.unscoped_organizations()))
    or s.location_id=any(array(select app.scoped_locations())));
 if not found then raise exception using errcode='MQ404',message='source comparison unavailable'; end if;
 if source.evidence->>'method' is distinct from 'periodic-constraints-v1'
  or app.simulation_output_valid(source.evidence,source.evidence->'output') is distinct from true then
  raise exception using errcode='MQ422',message='choose a completed MOQ/pack comparison';
 end if;
 select * into receiver from public.locations where organization_id=p_organization_id and id=source.location_id and is_active;
 select * into ordering from public.work_calendars where organization_id=p_organization_id and id=p_calendar_id and is_active;
 if receiver.id is null or ordering.id is null then
  raise exception using errcode='MQ422',message='choose active location and ordering calendar';
 end if;
 if receiver.work_calendar_id is not null and not exists(select 1 from public.work_calendars
  where organization_id=p_organization_id and id=receiver.work_calendar_id and is_active) then
  raise exception using errcode='MQ422',message='receiving calendar unavailable';
 end if;
 first_day:=(source.evidence->>'from_date')::date; last_day:=(source.evidence->>'to_date')::date;
 ordering_context:=app.delivery_calendar_context(p_organization_id,ordering.country_code,ordering.id,first_day,last_day);
 receiving_context:=app.delivery_calendar_context(p_organization_id,receiver.country_code,receiver.work_calendar_id,first_day,last_day+454);
 select jsonb_object_agg(d::text,app.delivery_calendar_day(ordering_context,d)) into ordering_days
  from (select first_day+n d from generate_series(0,last_day-first_day) n) dates;
 select jsonb_object_agg(d::text,app.delivery_calendar_day(receiving_context,d)) into receiving_days
  from (select first_day+n d from generate_series(0,last_day-first_day+454) n) dates;
 result:=jsonb_build_object('kind','simulation','method','periodic-calendars-v1',
  'from_date',first_day,'to_date',last_day,'policy',source.evidence->'policy','demand',source.evidence->'demand',
  'options',(source.evidence->'options')||jsonb_build_object('method','periodic-calendars-v1',
    'source_run_id',source.run_id,'ordering_calendar_id',ordering.id,'calendars_confirmed',false),
  'source_comparison',jsonb_build_object('id',source.id,'run_id',source.run_id,'evidence',source.evidence),
  'calendars',jsonb_build_object('ordering',ordering_context,'receiving',receiving_context,
    'ordering_days',ordering_days,'receiving_days',receiving_days,
    'receiver',jsonb_build_object('id',receiver.id,'code',receiver.code,'active',receiver.is_active,'updated_at',receiver.updated_at)));
 if octet_length(result::text)>20000000 then raise exception using errcode='MQ422',message='calendar evidence too large'; end if;
 return result||jsonb_build_object('fingerprint',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end; $$;
revoke all on function public.simulation_calendars_preview(uuid,uuid,uuid) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.simulation_calendars_preview(uuid,uuid,uuid) to authenticated;

create function public.simulation_calendars_enqueue(p_organization_id uuid,p_source_run_id uuid,
 p_calendar_id uuid,p_request_id uuid,p_fingerprint text,p_calendars_confirmed boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare prior public.planning_runs; options jsonb; payload jsonb; run uuid;
begin
 if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='calendar simulation requires an editor';
 end if;
 if p_source_run_id is null or p_calendar_id is null or p_request_id is null
  or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$' or p_calendars_confirmed is distinct from true then
  raise exception using errcode='MQ422',message='invalid calendar inputs or confirmation';
 end if;
 options:=jsonb_build_object('method','periodic-calendars-v1','source_run_id',p_source_run_id,
  'ordering_calendar_id',p_calendar_id,'fingerprint',p_fingerprint,'calendars_confirmed',true);
 perform pg_advisory_xact_lock(hashtextextended('maqdar.planning:'||p_organization_id::text,0));
 if not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='calendar simulation requires an editor';
 end if;
 select * into prior from public.planning_runs where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if prior.kind<>'simulation' or prior.options<>options then
   raise exception using errcode='MQ409',message='request id already used with different parameters';
  end if;
  if not(p_organization_id=any(array(select app.unscoped_organizations())))
   and not(prior.location_id=any(array(select app.scoped_locations()))) then
   raise exception using errcode='MQ404',message='comparison unavailable';
  end if;
  return prior.id;
 end if;
 payload:=public.simulation_calendars_preview(p_organization_id,p_source_run_id,p_calendar_id);
 if payload->>'fingerprint'<>p_fingerprint then
  raise exception using errcode='MQ409',message='calendar evidence changed; refresh preview';
 end if;
 payload:=jsonb_set(payload,'{options,calendars_confirmed}','true')||jsonb_build_object('computed_at',statement_timestamp());
 run:=app.planning_enqueue_kind(p_organization_id,payload#>>'{calendars,receiver,code}',
  (payload->>'from_date')::date,(payload->>'to_date')::date,p_request_id,'simulation',options);
 insert into planning.simulation_inputs(run_id,payload) values(run,payload);
 return run;
end; $$;
revoke all on function public.simulation_calendars_enqueue(uuid,uuid,uuid,uuid,text,boolean) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.simulation_calendars_enqueue(uuid,uuid,uuid,uuid,text,boolean) to authenticated;

-- Independent bounded date search over server-captured day facts.
create function app.simulation_calendar_next(days jsonb,first_day date,last_day date default null)
returns jsonb language plpgsql immutable set search_path='' as $$
declare d date; checked date; fact jsonb;
begin
 for n in 0..89 loop
  d:=first_day+n;
  if last_day is not null and d>last_day then
   return jsonb_build_object('status','outside_window','date',null,'checked_through',checked);
  end if;
  fact:=days->d::text; checked:=d;
  if fact is null or fact->>'date' is distinct from d::text then raise exception 'invalid captured date'; end if;
  if fact->>'working' is null then
   return jsonb_build_object('status','calendar_unknown','date',null,'checked_through',checked);
  elsif (fact->>'working')::boolean then
   return jsonb_build_object('status','resolved','date',d,'checked_through',checked);
  end if;
 end loop;
 return jsonb_build_object('status','search_exhausted','date',null,'checked_through',checked);
end; $$;
revoke all on function app.simulation_calendar_next(jsonb,date,date) from public,anon,authenticated,service_role,maqdar_worker;

-- SQL independently replays every state transition and metric before accepting worker output.
create function app.simulation_calendar_replay(input jsonb,c jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare
 first_day date:=(input->>'from_date')::date; last_day date:=(input->>'to_date')::date;
 lead integer:=(c->>'lead_time')::integer; review integer:=(c->>'review_interval')::integer;
 maximum numeric:=(c->>'maximum')::numeric; moq numeric:=(c->>'moq')::numeric; pack numeric:=(c->>'pack')::numeric;
 stock numeric:=(input#>>'{options,opening_stock}')::numeric; backlog numeric:=0; pipeline numeric:=0;
 incoming jsonb:='{}'; schedule jsonb:='[]'; scheduled jsonb:='{}'; ledger jsonb:='[]';
 search jsonb; nominal_reviews jsonb; observation jsonb; row jsonb; totals jsonb; metrics jsonb;
 d date; nominal date; due date; opening numeric; receipts numeric; cleared numeric; extra_cleared numeric;
 gap numeric; ordered numeric; sold numeric; lost numeric; immediate numeric; shortage numeric;
begin
 for i in 0..last_day-first_day loop
  if i%review<>0 then continue; end if;
  d:=first_day+i;
  search:=app.simulation_calendar_next(input#>'{calendars,ordering_days}',d,last_day);
  schedule:=schedule||jsonb_build_array(jsonb_build_object('nominal_date',d)||search);
  if search->>'status' not in ('resolved','outside_window') then
   return jsonb_build_object('failure',jsonb_build_object('stage','ordering','nominal_date',d)||search);
  end if;
  if search->>'date' is not null then
   scheduled:=jsonb_set(scheduled,array[search->>'date'],
    coalesce(scheduled->(search->>'date'),'[]')||jsonb_build_array(d));
  end if;
 end loop;
 for i in 0..last_day-first_day loop
  d:=first_day+i; observation:=input->'demand'->i; opening:=stock;
  receipts:=coalesce((incoming->>d::text)::numeric,0); incoming:=incoming-d::text; pipeline:=pipeline-receipts;
  stock:=stock+receipts; cleared:=least(stock,backlog); stock:=stock-cleared; backlog:=backlog-cleared;
  nominal_reviews:=coalesce(scheduled->d::text,'[]');
  gap:=case when jsonb_array_length(nominal_reviews)>0 then greatest(maximum-(stock+pipeline-backlog),0) else 0 end;
  ordered:=case when gap=0 then 0 else div(greatest(gap,moq)*1000+pack*1000-1,pack*1000)*pack end;
  nominal:=null; due:=null; search:=null;
  if ordered>0 then
   nominal:=d+lead;
   search:=app.simulation_calendar_next(input#>'{calendars,receiving_days}',nominal);
   if search->>'status'<>'resolved' then
    return jsonb_build_object('failure',jsonb_build_object('stage','receiving','nominal_date',nominal,'order_date',d)||search);
   end if;
   due:=(search->>'date')::date;
   if due=d then
    receipts:=receipts+ordered; stock:=stock+ordered;
    extra_cleared:=least(stock,backlog); stock:=stock-extra_cleared; backlog:=backlog-extra_cleared; cleared:=cleared+extra_cleared;
   else
    incoming:=jsonb_set(incoming,array[due::text],to_jsonb(coalesce((incoming->>due::text)::numeric,0)+ordered));
    pipeline:=pipeline+ordered;
   end if;
  end if;
  sold:=(observation->>'quantity')::numeric; lost:=(observation->>'lost_sales_quantity')::numeric;
  immediate:=least(stock,sold); stock:=stock-immediate; shortage:=sold-immediate; backlog:=backlog+shortage;
  row:=jsonb_build_object('date',d,'review',jsonb_array_length(nominal_reviews)>0,'nominal_reviews',nominal_reviews,
   'nominal_receipt',nominal,'order_due',due,'receipt_search',search);
  select row||jsonb_object_agg(k,trim_scale(v)::text) into row from (values
   ('demand',sold),('lost_sales',lost),('opening_stock',opening),('receipts',receipts),
   ('backlog_fulfilled',cleared),('order_gap',gap),('order_quantity',ordered),('rounding_extra',ordered-gap),
   ('immediate_fulfilled',immediate),('new_backlog',shortage),('closing_stock',stock),
   ('closing_backlog',backlog),('closing_on_order',pipeline)) fields(k,v);
  ledger:=ledger||jsonb_build_array(row);
 end loop;
 select jsonb_object_agg(k,v) into totals from (select k,sum((r->>k)::numeric) v
  from jsonb_array_elements(ledger) r cross join unnest(array['demand','lost_sales','order_quantity','receipts',
  'immediate_fulfilled','closing_stock','rounding_extra']) k group by k) sums;
 metrics:=jsonb_build_object('days',jsonb_array_length(ledger),
  'order_count',(select count(*) from jsonb_array_elements(ledger) r where (r->>'order_quantity')::numeric>0),
  'backlog_days',(select count(*) from jsonb_array_elements(ledger) r where (r->>'closing_backlog')::numeric>0));
 select metrics||jsonb_object_agg(k,trim_scale(v)::text) into metrics from (values
  ('sold_quantity',(totals->>'demand')::numeric),('lost_sales_quantity',(totals->>'lost_sales')::numeric),
  ('ordered_quantity',(totals->>'order_quantity')::numeric),('received_quantity',(totals->>'receipts')::numeric),
  ('immediate_fulfilled',(totals->>'immediate_fulfilled')::numeric),('closing_stock_sum',(totals->>'closing_stock')::numeric),
  ('rounding_extra_quantity',(totals->>'rounding_extra')::numeric),
  ('average_closing_stock',div((totals->>'closing_stock')::numeric*2000000+jsonb_array_length(ledger),2*jsonb_array_length(ledger))/1000000),
  ('immediate_fill_rate',div((totals->>'immediate_fulfilled')::numeric*2000000+(totals->>'demand')::numeric,2*nullif((totals->>'demand')::numeric,0))/1000000),
  ('ending_stock',stock),('ending_backlog',backlog),('ending_on_order',pipeline)) fields(k,v);
 return c||jsonb_build_object('ledger',ledger,'metrics',metrics,'review_schedule',schedule);
end; $$;
revoke all on function app.simulation_calendar_replay(jsonb,jsonb) from public,anon,authenticated,service_role,maqdar_worker;

create function app.simulation_calendar_output(input jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb; variants jsonb:='[]'; c jsonb; i integer:=0;
begin
 for c in select * from jsonb_array_elements(input#>'{options,configurations}') loop
  i:=i+1; result:=app.simulation_calendar_replay(input,c);
  if result ? 'failure' then
   return jsonb_build_object('method','periodic-calendars-v1','status',result#>>'{failure,status}',
    'variants','[]'::jsonb,'failure',(result->'failure')||jsonb_build_object('variant',i));
  end if;
  variants:=variants||jsonb_build_array(result||jsonb_build_object('name','alternative-'||i::text));
 end loop;
 return jsonb_build_object('method','periodic-calendars-v1','status','available','variants',variants,'failure',null);
end; $$;
revoke all on function app.simulation_calendar_output(jsonb) from public,anon,authenticated,service_role,maqdar_worker;

alter function app.simulation_output_valid(jsonb,jsonb) rename to simulation_output_valid_constraints_v1;
create function app.simulation_output_valid(input jsonb,output jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare source jsonb; field text;
begin
 if input->>'method' is distinct from 'periodic-calendars-v1' then
  return app.simulation_output_valid_constraints_v1(input,output);
 end if;
 source:=input#>'{source_comparison,evidence}';
 if source->>'method' is distinct from 'periodic-constraints-v1'
  or app.simulation_output_valid_constraints_v1(source,source->'output') is distinct from true
  or input#>>'{options,calendars_confirmed}' is distinct from 'true'
  or octet_length(output::text)>5000000 then return false; end if;
 foreach field in array array['policy','demand','from_date','to_date'] loop
  if input->field is distinct from source->field then return false; end if;
 end loop;
 foreach field in array array['opening_stock','history_confirmed','empty_start_confirmed','configurations'] loop
  if input->'options'->field is distinct from source->'options'->field then return false; end if;
 end loop;
 return output is not distinct from app.simulation_calendar_output(input);
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then return false;
end; $$;
revoke all on function app.simulation_output_valid(jsonb,jsonb) from public,anon,authenticated,service_role,maqdar_worker;
reset lock_timeout;
