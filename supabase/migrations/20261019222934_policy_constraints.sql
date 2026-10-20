-- Step 21d: additive configuration replay contracts; deploy workers before web.
-- Forward-only rollback: disable new queues, cancel pending comparisons, retain results.
set lock_timeout='5s';
create function app.simulation_constraints_canonical(configurations jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare c jsonb; result jsonb; field text;
begin
 if jsonb_typeof(configurations) is distinct from 'array' then return null; end if;
 if jsonb_array_length(configurations) not between 1 and 10 then return null; end if;
 for c in select * from jsonb_array_elements(configurations) loop
  if jsonb_typeof(c) is distinct from 'object' then return null; end if;
  if app.simulation_configurations_canonical(jsonb_build_array(c-array['moq','pack'])) is null then return null; end if;
  foreach field in array array['moq','pack'] loop
   if jsonb_typeof(c->field) is distinct from 'string' or (c->>field)!~'^[0-9]{1,15}(\.[0-9]{1,3})?$' then return null; end if;
  end loop;
  if (c->>'pack')::numeric<=0 then return null; end if;
 end loop;
 select jsonb_agg(jsonb_build_object('maximum',trim_scale(maximum)::text,'lead_time',lead,'review_interval',review,
  'moq',trim_scale(moq)::text,'pack',trim_scale(pack)::text) order by maximum,lead,review,moq,pack) into result
 from (select distinct (v->>'maximum')::numeric maximum,(v->>'lead_time')::integer lead,
  (v->>'review_interval')::integer review,(v->>'moq')::numeric moq,(v->>'pack')::numeric pack
  from jsonb_array_elements(configurations) v) canonical;
 if jsonb_array_length(result)<>jsonb_array_length(configurations) then return null; end if;
 return result;
end; $$;
revoke all on function app.simulation_constraints_canonical(jsonb) from public,anon,authenticated,service_role,maqdar_worker;

create function public.simulation_constraints_enqueue(p_organization_id uuid,p_source_run_id uuid,
 p_request_id uuid,p_configurations jsonb,p_reuse_confirmed boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare prior public.planning_runs; source public.policy_simulations; options jsonb; payload jsonb;
 configurations jsonb; run uuid; location_code text;
begin
 if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='configuration requires an editor';
 end if;
 configurations:=app.simulation_constraints_canonical(p_configurations);
 if p_source_run_id is null or p_request_id is null or p_reuse_confirmed is distinct from true or configurations is null then
  raise exception using errcode='MQ422',message='invalid configurations or confirmation';
 end if;
 options:=jsonb_build_object('method','periodic-constraints-v1','source_run_id',p_source_run_id,
  'configurations',configurations,'reuse_confirmed',true);
 perform pg_advisory_xact_lock(hashtextextended('maqdar.planning:'||p_organization_id::text,0));
 -- A request may have waited while membership or its active-organization scope changed.
 if not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='configuration requires an editor';
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
 select s.* into source from public.policy_simulations s join public.planning_runs r
  on r.organization_id=s.organization_id and r.id=s.run_id
  where s.organization_id=p_organization_id and s.run_id=p_source_run_id
   and r.kind='simulation' and r.status='succeeded' for share of s,r;
 if not found or (not(p_organization_id=any(array(select app.unscoped_organizations())))
   and not(source.location_id=any(array(select app.scoped_locations())))) then
  raise exception using errcode='MQ404',message='source simulation unavailable';
 end if;
 if source.evidence->>'method' is distinct from 'periodic-replay-v1'
  or source.evidence#>>'{policy,unit}' is distinct from source.unit
  or source.evidence#>>'{options,history_confirmed}' is distinct from 'true'
  or source.evidence#>>'{options,empty_start_confirmed}' is distinct from 'true'
  or app.simulation_output_valid(source.evidence,source.evidence->'output') is distinct from true then
  raise exception using errcode='MQ422',message='choose a completed original policy simulation';
 end if;
 select code into location_code from public.locations where organization_id=p_organization_id
  and id=source.location_id and is_active;
 if location_code is null then raise exception using errcode='MQ422',message='choose an active location'; end if;
 payload:=(source.evidence-'output')||jsonb_build_object('method','periodic-constraints-v1',
  'computed_at',statement_timestamp(),
  'options',((source.evidence->'options')-'alternative_maximum')||options,
  'source_simulation',jsonb_build_object('id',source.id,'run_id',source.run_id,'evidence',source.evidence));
 if octet_length(payload::text)>20000000 then raise exception using errcode='MQ422',message='configuration evidence too large'; end if;
 run:=app.planning_enqueue_kind(p_organization_id,location_code,(payload->>'from_date')::date,
  (payload->>'to_date')::date,p_request_id,'simulation',options);
 insert into planning.simulation_inputs(run_id,payload) values(run,payload);
 return run;
end; $$;
revoke all on function public.simulation_constraints_enqueue(uuid,uuid,uuid,jsonb,boolean) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.simulation_constraints_enqueue(uuid,uuid,uuid,jsonb,boolean) to authenticated;

-- Verify the precise receipt/review/rounding sequence, not only conservation.
create function app.simulation_constraints_ledger_valid(input jsonb,v jsonb,c jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare incoming jsonb:='{}'; row jsonb; i integer; day date; due date;
 stock numeric:=(input#>>'{options,opening_stock}')::numeric; backlog numeric:=0; pipeline numeric:=0;
 maximum numeric:=(c->>'maximum')::numeric; moq numeric:=(c->>'moq')::numeric; pack numeric:=(c->>'pack')::numeric;
 lead integer:=(c->>'lead_time')::integer; review integer:=(c->>'review_interval')::integer;
 receipts numeric; cleared numeric; immediate numeric; gap numeric; ordered numeric; sold numeric; extra numeric:=0;
begin
 for i in 0..jsonb_array_length(input->'demand')-1 loop
  row:=v->'ledger'->i; day:=(input->>'from_date')::date+i;
  receipts:=coalesce((incoming->>day::text)::numeric,0); incoming:=incoming-day::text;
  stock:=stock+receipts; pipeline:=pipeline-receipts;
  cleared:=least(stock,backlog); stock:=stock-cleared; backlog:=backlog-cleared;
  gap:=case when i % review=0 then greatest(maximum-(stock+pipeline-backlog),0) else 0 end;
  -- Milliquantity integer division avoids rounded numeric division at large ratios.
  ordered:=case when gap=0 then 0 else div(greatest(gap,moq)*1000+pack*1000-1,pack*1000)*pack end;
  due:=case when ordered>0 then day+lead else null end;
  if ordered>0 then
   if lead=0 then
    receipts:=receipts+ordered; stock:=stock+ordered;
    cleared:=cleared+least(stock,backlog); stock:=greatest(stock-backlog,0); backlog:=greatest(backlog-ordered,0);
   else
    incoming:=jsonb_set(incoming,array[due::text],to_jsonb(coalesce((incoming->>due::text)::numeric,0)+ordered));
    pipeline:=pipeline+ordered;
   end if;
  end if;
  sold:=(input->'demand'->i->>'quantity')::numeric;
  immediate:=least(stock,sold); stock:=stock-immediate; backlog:=backlog+sold-immediate;
  extra:=extra+ordered-gap;
  if jsonb_typeof(row->'order_gap') is distinct from 'string'
   or jsonb_typeof(row->'rounding_extra') is distinct from 'string'
   or row->>'order_gap' is distinct from trim_scale(gap)::text
   or row->>'rounding_extra' is distinct from trim_scale(ordered-gap)::text
   or (row->>'order_quantity')::numeric is distinct from ordered
   or (row->>'receipts')::numeric is distinct from receipts
   or (row->>'backlog_fulfilled')::numeric is distinct from cleared
   or (row->>'immediate_fulfilled')::numeric is distinct from immediate
   or (row->>'closing_stock')::numeric is distinct from stock
   or (row->>'closing_backlog')::numeric is distinct from backlog
   or (row->>'closing_on_order')::numeric is distinct from pipeline then return false; end if;
 end loop;
 return jsonb_typeof(v#>'{metrics,rounding_extra_quantity}') is not distinct from 'string'
  and v#>>'{metrics,rounding_extra_quantity}' is not distinct from trim_scale(extra)::text;
end; $$;
revoke all on function app.simulation_constraints_ledger_valid(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role,maqdar_worker;

-- Preserve all published methods and reuse the original per-pair ledger checks.
alter function app.simulation_output_valid(jsonb,jsonb) rename to simulation_output_valid_configurations_v1;
create function app.simulation_output_valid(input jsonb,output jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare original jsonb; configurations jsonb; baseline jsonb; alternative jsonb; c jsonb;
 pair_input jsonb; pair_output jsonb; i integer; field text;
begin
 if input->>'method' in ('periodic-replay-v1','periodic-sensitivity-v1','periodic-configurations-v1') then
  return app.simulation_output_valid_configurations_v1(input,output);
 end if;
 if input->>'method' is distinct from 'periodic-constraints-v1'
  or output->>'method' is distinct from 'periodic-constraints-v1'
  or jsonb_typeof(output->'variants') is distinct from 'array' or octet_length(output::text)>5000000
  or input#>>'{options,reuse_confirmed}' is distinct from 'true' then return false; end if;
 original:=input#>'{source_simulation,evidence}'; configurations:=input#>'{options,configurations}';
 if original->>'method' is distinct from 'periodic-replay-v1'
  or app.simulation_output_valid_v1(original,original->'output') is distinct from true
  or app.simulation_constraints_canonical(configurations) is null
  or app.simulation_constraints_canonical(configurations) is distinct from configurations then return false; end if;
 if jsonb_array_length(output->'variants')<>jsonb_array_length(configurations)+1 then return false; end if;
 foreach field in array array['policy','demand','from_date','to_date'] loop
  if input->field is distinct from original->field then return false; end if;
 end loop;
 foreach field in array array['opening_stock','history_confirmed','empty_start_confirmed'] loop
  if input->'options'->field is distinct from original->'options'->field then return false; end if;
 end loop;
 baseline:=output->'variants'->0;
 if baseline is distinct from ((original#>'{output,variants,0}')||jsonb_build_object(
  'lead_time',original#>'{policy,lead_time}','review_interval',original#>'{policy,review_interval}','moq',null,'pack',null)) then return false; end if;
 for i in 0..jsonb_array_length(configurations)-1 loop
  c:=configurations->i; alternative:=output->'variants'->(i+1);
  if alternative->>'name' is distinct from 'alternative-'||(i+1)::text
   or alternative->'maximum' is distinct from c->'maximum'
   or alternative->'lead_time' is distinct from c->'lead_time'
   or alternative->'review_interval' is distinct from c->'review_interval'
   or alternative->'moq' is distinct from c->'moq' or alternative->'pack' is distinct from c->'pack' then return false; end if;
  -- Only this validation pair uses what-if settings; the saved policy stays unchanged.
  pair_input:=jsonb_set(jsonb_set(original,'{options,alternative_maximum}',c->'maximum'),
   '{policy}',(original->'policy')||(c-array['moq','pack']));
  pair_output:=jsonb_build_object('method','periodic-replay-v1','variants',jsonb_build_array(
   (alternative-array['lead_time','review_interval','moq','pack'])||jsonb_build_object('name','baseline'),
   (alternative-array['lead_time','review_interval','moq','pack'])||jsonb_build_object('name','alternative')));
  if app.simulation_output_valid_v1(pair_input,pair_output) is distinct from true then return false; end if;
  if app.simulation_constraints_ledger_valid(input,alternative,c) is distinct from true then return false; end if;
 end loop;
 return true;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then return false;
end; $$;
revoke all on function app.simulation_output_valid(jsonb,jsonb) from public,anon,authenticated,service_role,maqdar_worker;
reset lock_timeout;
